/**
 * Minimal PNG decoder for the field-artwork tests: 8-bit RGB/RGBA,
 * non-interlaced (what our assets are). Zero dependencies — node:zlib only.
 */
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

export interface Png {
  width: number;
  height: number;
  /** R+G+B per pixel (dark-blob detection input). */
  sum: Int32Array;
  /** Decoded RGB(A) bytes, row-major, 3 or 4 bytes per pixel. */
  rgb: Buffer;
  /** Bytes per pixel (3 = RGB, 4 = RGBA). */
  bpp: number;
}

export function decodePng(file: string): Png {
  const buf = readFileSync(file);
  let off = 8; // signature
  let width = 0;
  let height = 0;
  let colourType = 6;
  const idat: Buffer[] = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      if (data[8] !== 8) throw new Error(`unsupported bit depth ${data[8]}`);
      if (data[9] !== 2 && data[9] !== 6) throw new Error(`unsupported colour type ${data[9]}`);
      colourType = data[9]!;
      if (data[12] !== 0) throw new Error('interlaced PNG not supported');
    } else if (type === 'IDAT') {
      idat.push(data);
    }
    off += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const bpp = colourType === 6 ? 4 : 3;
  const stride = width * bpp;
  const out = Buffer.alloc(width * height * bpp);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const rowIn = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const rowOut = out.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : undefined;
    for (let i = 0; i < stride; i++) {
      const left = i >= bpp ? rowOut[i - bpp] : 0;
      const up = prev ? prev[i] : 0;
      const upLeft = prev && i >= bpp ? prev[i - bpp] : 0;
      let v = rowIn[i]!;
      if (filter === 1) v += left;
      else if (filter === 2) v += up;
      else if (filter === 3) v += Math.floor((left + up) / 2);
      else if (filter === 4) {
        const p = left + up - upLeft;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - upLeft);
        v += pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
      }
      rowOut[i] = v;
    }
  }
  const sum = new Int32Array(width * height);
  for (let i = 0; i < width * height; i++) {
    sum[i] = out[i * bpp]! + out[i * bpp + 1]! + out[i * bpp + 2]!;
  }
  return { width, height, sum, rgb: out, bpp };
}
