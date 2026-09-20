/** Recursive drop collection: folders walked, rel paths preserved. */
import { describe, expect, it, vi } from 'vitest';
import { filesFromDataTransfer, toIncoming } from '../src/dropped-files';

function fakeFileEntry(name: string) {
  return {
    isFile: true,
    isDirectory: false,
    name,
    fullPath: name,
    file: (success: (f: File) => void) => success(new File(['{}'], name, { type: 'application/json' })),
  };
}

function fakeDirEntry(name: string, children: ReturnType<typeof fakeFileEntry>[]) {
  return {
    isFile: false,
    isDirectory: true,
    name,
    fullPath: name,
    createReader: () => ({
      // First call returns half, second the rest, third empty — exercising
      // the readEntries paging loop.
      readEntries: vi.fn()
        .mockImplementationOnce((success: (e: unknown[]) => void) => success(children.slice(0, 1)))
        .mockImplementationOnce((success: (e: unknown[]) => void) => success(children.slice(1)))
        .mockImplementationOnce((success: (e: unknown[]) => void) => success([])),
    }),
  };
}

function itemFor(entry: unknown) {
  return { kind: 'file', type: 'application/json', webkitGetAsEntry: () => entry };
}

describe('filesFromDataTransfer', () => {
  it('walks nested directories and keeps drop-relative paths', async () => {
    const root = fakeDirEntry('254', [
      fakeFileEntry('L1.traj'),
      fakeDirEntry('deploy', [fakeFileEntry('settings.json')]),
    ]);
    const files = await filesFromDataTransfer([itemFor(root)] as unknown as DataTransferItemList);
    expect(files).toEqual([
      { relPath: '254/L1.traj', file: expect.any(File) },
      { relPath: '254/deploy/settings.json', file: expect.any(File) },
    ]);
  });

  it('returns null when the platform exposes no entries', async () => {
    expect(await filesFromDataTransfer([] as unknown as DataTransferItemList)).toBeNull();
  });
});

describe('toIncoming', () => {
  it('uses webkitRelativePath when present, file name otherwise', () => {
    const folder = new File(['{}'], 'L1.traj');
    Object.defineProperty(folder, 'webkitRelativePath', { value: '254/autos/L1.traj' });
    const bare = new File(['{}'], 'solo.ghostauto');
    expect(toIncoming([folder, bare])).toEqual([
      { file: folder, relPath: '254/autos/L1.traj' },
      { file: bare, relPath: 'solo.ghostauto' },
    ]);
  });

  it('passes IncomingFile entries through untouched', () => {
    const entry = { file: new File(['{}'], 'x.path'), relPath: 'a/b/x.path' };
    expect(toIncoming([entry])).toEqual([entry]);
  });
});
