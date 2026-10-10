/**
 * Drag-and-drop folder support: DataTransfer entries walked recursively so
 * dropping a whole deploy directory behaves like picking it with the
 * folder input. Everything stays local (the app never uploads) — this only collects
 * File handles with their in-drop relative paths for the import pipeline.
 */

export interface IncomingFile {
  file: File;
  /** Path inside the drop (or the file name for bare files). */
  relPath: string;
}

interface FileSystemEntryLike {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
  fullPath: string;
  file?: (success: (file: File) => void, failure?: (e: unknown) => void) => void;
  createReader?: () => { readEntries: (success: (entries: FileSystemEntryLike[]) => void, failure?: (e: unknown) => void) => void };
}

/** Normalize any input source (input list, drop, AI attachment) to rel paths. */
export function toIncoming(list: FileList | File[] | IncomingFile[]): IncomingFile[] {
  const out: IncomingFile[] = [];
  for (let i = 0; i < list.length; i++) {
    const item = list[i] as File | IncomingFile;
    if (item instanceof File) {
      out.push({ file: item, relPath: item.webkitRelativePath || item.name });
    } else {
      out.push(item);
    }
  }
  return out;
}

/**
 * Collect files from a drop, descending into directories. Returns null when
 * the platform gives no entries (older WebViews) so the caller can fall
 * back to dataTransfer.files.
 */
export function filesFromDataTransfer(items: DataTransferItemList): Promise<IncomingFile[] | null> {
  const entries: FileSystemEntryLike[] = [];
  for (const item of Array.from(items)) {
    if (item.kind !== 'file') continue;
    const entry = (item as DataTransferItem & {
      webkitGetAsEntry?: () => FileSystemEntryLike | null;
    }).webkitGetAsEntry?.();
    if (entry) entries.push(entry);
  }
  if (entries.length === 0) return Promise.resolve(null);
  return Promise.all(entries.map((entry) => walkEntry(entry, '')))
    .then((batches) => batches.flat());
}

async function walkEntry(entry: FileSystemEntryLike, parent: string): Promise<IncomingFile[]> {
  const path = parent === '' ? entry.name : `${parent}/${entry.name}`;
  if (entry.isFile && entry.file) {
    const file = await new Promise<File | null>((resolve) => {
      entry.file!(resolve, () => resolve(null));
    });
    return file ? [{ file, relPath: path }] : [];
  }
  if (entry.isDirectory && entry.createReader) {
    const reader = entry.createReader();
    const children: FileSystemEntryLike[] = [];
    // readEntries returns at most ~100 entries per call; loop to exhaustion.
    for (;;) {
      const batch = await new Promise<FileSystemEntryLike[]>((resolve) => {
        reader.readEntries(resolve, () => resolve([]));
      });
      if (batch.length === 0) break;
      children.push(...batch);
    }
    const nested = await Promise.all(children.map((child) => walkEntry(child, path)));
    return nested.flat();
  }
  return [];
}
