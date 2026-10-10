/**
 * Minimal ZIP archive writer for the solution package (2026-10-06).
 * Zero dependencies: entries are deflate-raw compressed through the
 * platform CompressionStream when available (Chrome 80+, Safari 16.4+,
 * Firefox 113+, Node 18+ for tests) and fall back to the STORE method
 * (bytes identical) where it is not. CRC-32, local headers, central
 * directory and the UTF-8 name flag are written by hand per APPNOTE.TXT.
 */

/** IEEE CRC-32, table-driven. */
export function crc32(data: Uint8Array): number {
  let c = ~0;
  for (let i = 0; i < data.length; i++) {
    c = CRC_TABLE[(c ^ data[i]!) & 0xff]! ^ (c >>> 8);
  }
  return ~c >>> 0;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

async function deflateRaw(data: Uint8Array): Promise<Uint8Array | null> {
  try {
    const stream = new CompressionStream('deflate-raw');
    const writer = stream.writable.getWriter();
    // Cast: the DOM lib's BufferSource rejects the SharedArrayBuffer
    // variant of Uint8Array, but every caller hands ArrayBuffer-backed data.
    void writer.write(data as Uint8Array<ArrayBuffer>);
    void writer.close();
    const chunks: Uint8Array[] = [];
    const reader = stream.readable.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) chunks.push(value);
    }
    const total = chunks.reduce((n, c) => n + c.length, 0);
    const out = new Uint8Array(total);
    let at = 0;
    for (const c of chunks) { out.set(c, at); at += c.length; }
    return out;
  } catch {
    return null;
  }
}

export interface ZipEntry {
  /** Path inside the archive; '/' separators, UTF-8. */
  name: string;
  data: Uint8Array;
}

interface CentralRecord {
  name: Uint8Array;
  crc: number;
  compressedSize: number;
  uncompressedSize: number;
  method: number;
  offset: number;
}

/** DOS timestamp (2-second resolution) from a JS date. */
function dosDateTime(at: Date): { date: number; time: number } {
  const year = Math.max(1980, at.getFullYear());
  const date = ((year - 1980) << 9) | ((at.getMonth() + 1) << 5) | at.getDate();
  const time = (at.getHours() << 11) | (at.getMinutes() << 5) | Math.floor(at.getSeconds() / 2);
  return { date, time };
}

export async function buildZip(entries: ZipEntry[], now = new Date()): Promise<Uint8Array> {
  const { date, time } = dosDateTime(now);
  const encoder = new TextEncoder();
  const locals: Uint8Array[] = [];
  const central: CentralRecord[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const crc = crc32(entry.data);
    const compressed = await deflateRaw(entry.data);
    const method = compressed && compressed.length < entry.data.length ? 8 : 0;
    const payload = method === 8 ? compressed! : entry.data;
    const local = new Uint8Array(30 + name.length + payload.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true); // version needed
    lv.setUint16(6, 0x0800, true); // UTF-8 names
    lv.setUint16(8, method, true);
    lv.setUint16(10, time, true);
    lv.setUint16(12, date, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, payload.length, true);
    lv.setUint32(22, entry.data.length, true);
    lv.setUint16(26, name.length, true);
    local.set(name, 30);
    local.set(payload, 30 + name.length);
    locals.push(local);
    central.push({ name, crc, compressedSize: payload.length, uncompressedSize: entry.data.length, method, offset });
    offset += local.length;
  }

  const centralStart = offset;
  let centralSize = 0;
  const centralParts: Uint8Array[] = [];
  for (const rec of central) {
    const recBytes = new Uint8Array(46 + rec.name.length);
    const cv = new DataView(recBytes.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true); // version made by
    cv.setUint16(6, 20, true); // version needed
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, rec.method, true);
    cv.setUint16(12, time, true);
    cv.setUint16(14, date, true);
    cv.setUint32(16, rec.crc, true);
    cv.setUint32(20, rec.compressedSize, true);
    cv.setUint32(24, rec.uncompressedSize, true);
    cv.setUint16(28, rec.name.length, true);
    cv.setUint32(42, rec.offset, true);
    recBytes.set(rec.name, 46);
    centralParts.push(recBytes);
    centralSize += recBytes.length;
  }

  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, central.length, true);
  ev.setUint16(10, central.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, centralStart, true);

  const total = centralStart + centralSize + eocd.length;
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of [...locals, ...centralParts, eocd]) { out.set(part, at); at += part.length; }
  return out;
}

/** Parse enough of an archive to assert on it in tests (names, sizes, methods). */
export function readZipDirectory(bytes: Uint8Array): Array<{
  name: string;
  method: number;
  crc: number;
  compressedSize: number;
  uncompressedSize: number;
  data: Uint8Array;
}> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // Locate the EOCD from the tail (no ZIP64 support — the package stays < 4 GB).
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65536); i--) {
    if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('not a zip');
  const count = view.getUint16(eocd + 10, true);
  let at = view.getUint32(eocd + 16, true);
  const decoder = new TextDecoder();
  const out: ReturnType<typeof readZipDirectory> = [];
  for (let i = 0; i < count; i++) {
    if (view.getUint32(at, true) !== 0x02014b50) throw new Error('bad central directory');
    const method = view.getUint16(at + 10, true);
    const crc = view.getUint32(at + 16, true);
    const compressedSize = view.getUint32(at + 20, true);
    const uncompressedSize = view.getUint32(at + 24, true);
    const nameLen = view.getUint16(at + 28, true);
    const extraLen = view.getUint16(at + 30, true);
    const commentLen = view.getUint16(at + 32, true);
    const localOffset = view.getUint32(at + 42, true);
    const name = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLen));
    // Local header: skip fixed 30 bytes + name + extra to reach the payload.
    const localNameLen = view.getUint16(localOffset + 26, true);
    const localExtraLen = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    out.push({
      name,
      method,
      crc,
      compressedSize,
      uncompressedSize,
      data: bytes.subarray(dataStart, dataStart + compressedSize),
    });
    at += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

/** Inflate a stored-or-deflated entry back to its original bytes (tests). */
export async function inflateEntry(entry: { method: number; data: Uint8Array }): Promise<Uint8Array> {
  if (entry.method === 0) return entry.data;
  const stream = new DecompressionStream('deflate-raw');
  const writer = stream.writable.getWriter();
  void writer.write(entry.data as Uint8Array<ArrayBuffer>);
  void writer.close();
  const chunks: Uint8Array[] = [];
  const reader = stream.readable.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.length; }
  return out;
}
