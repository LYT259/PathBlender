import { describe, expect, it } from 'vitest';
import { buildZip, crc32, inflateEntry, readZipDirectory, type ZipEntry } from '../src/zip';

const bytesOf = (s: string): Uint8Array => new TextEncoder().encode(s);

describe('crc32', () => {
  it('matches the canonical check vector', () => {
    expect(crc32(bytesOf('123456789'))).toBe(0xcbf43926);
  });
});

describe('buildZip / readZipDirectory', () => {
  const entries: ZipEntry[] = [
    { name: 'README.md', data: bytesOf('# hello\nworld\n') },
    { name: '完整方案.pb', data: bytesOf('{"app":"pathblender"}') },
    { name: '原始导入文件/8814/deep/nested.traj', data: bytesOf('x'.repeat(4096)) },
  ];

  it('round-trips names, sizes and content', async () => {
    const zip = await buildZip(entries);
    const dir = readZipDirectory(zip);
    expect(dir.map((e) => e.name)).toEqual([
      'README.md',
      '完整方案.pb',
      '原始导入文件/8814/deep/nested.traj',
    ]);
    for (let i = 0; i < entries.length; i++) {
      const record = dir[i]!;
      expect(record.uncompressedSize).toBe(entries[i]!.data.length);
      expect(record.crc).toBe(crc32(entries[i]!.data));
      expect([0, 8]).toContain(record.method);
      const back = await inflateEntry(record);
      expect(Array.from(back)).toEqual(Array.from(entries[i]!.data));
    }
  });

  it('deflate actually compresses the repetitive entry (or falls back to store)', async () => {
    const zip = await buildZip(entries);
    const nested = readZipDirectory(zip)[2]!;
    if (nested.method === 8) {
      expect(nested.compressedSize).toBeLessThan(nested.uncompressedSize);
    } else {
      expect(nested.compressedSize).toBe(nested.uncompressedSize);
    }
  });

  it('writes a central directory the EOCD points at', async () => {
    const zip = await buildZip(entries);
    const view = new DataView(zip.buffer);
    let eocd = -1;
    for (let i = zip.length - 22; i >= 0; i--) {
      if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    expect(eocd).toBeGreaterThanOrEqual(0);
    expect(view.getUint16(eocd! + 10, true)).toBe(entries.length);
  });

  it('rejects non-archives in the reader', () => {
    expect(() => readZipDirectory(bytesOf('definitely not a zip'))).toThrow();
  });
});
