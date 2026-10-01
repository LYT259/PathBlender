/**
 * Construction-variant field artwork (2025 Reefscape):
 *
 * 1. `fieldImageFor` resolves the artwork per variant — 2025 swaps between
 *    the official welded/AndyMark pair (AdvantageScopeAssets, BSD-3), every
 *    other season has a single artwork that both variants share.
 * 2. The shipped PNGs match the calibrations in `@pathblender/core`
 *    (IHDR dimensions) — a guard against silent asset replacement.
 * 3. Registration check, in the spirit of `field3d-model.test.ts`: the
 *    artwork draws all 22 AprilTag decals, and the calibration must place
 *    the official tag layout on them. Expected positions are computed from
 *    the WPILib layout constants through the production calibration only;
 *    the decal centres are read from the shipped PNGs themselves (largest
 *    dark blob around each prediction). Residual budget: median |offset|
 *     ≤ 2 px (no systematic bias — the calibration itself), per-tag scatter
 *     ≤ 28 px (≈ 16 cm — the artwork's structure looseness: the reef tag
 *    ring is drawn ~8 cm large in radius, barge posts ±21 px, DS walls
 *    ~17 px inset, station tags tilt ~22 px into the field).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { CUSTOM_FIELD_ID, fieldById, withFieldVariant } from '@pathblender/core';
import { FIELD_IMAGES, fieldImageFor } from '../src/field-images';

const asset = (name: string) => resolve(__dirname, `../../../assets/fields/${name}`);

interface Png {
  width: number;
  height: number;
  /** R+G+B per pixel (dark-blob detection input). */
  sum: Int32Array;
}

/** Minimal PNG decoder: 8-bit RGBA, non-interlaced (what our assets are). */
function decodePng(file: string): Png {
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
      expect(data[8]).toBe(8); // bit depth
      // The welded sheet is RGB, the AndyMark sheet RGBA — both supported.
      expect(data[9] === 2 || data[9] === 6).toBe(true);
      colourType = data[9]!;
      expect(data[12]).toBe(0); // no interlace
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
  return { width, height, sum };
}

/** Centre of the largest dark (sum < 300) 4-connected blob in the patch. */
function decalCentre(
  png: Png,
  col: number,
  row: number,
  half = 28,
): { x: number; y: number } | null {
  const x0 = Math.max(0, Math.round(col) - half);
  const y0 = Math.max(0, Math.round(row) - half);
  const x1 = Math.min(png.width, Math.round(col) + half);
  const y1 = Math.min(png.height, Math.round(row) + half);
  const w = x1 - x0;
  const h = y1 - y0;
  const dark = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      dark[y * w + x] = png.sum[(y0 + y) * png.width + (x0 + x)]! < 300 ? 1 : 0;
    }
  }
  const seen = new Uint8Array(w * h);
  let best: number[] = [];
  for (let i = 0; i < dark.length; i++) {
    if (!dark[i] || seen[i]) continue;
    const comp: number[] = [];
    const stack = [i];
    seen[i] = 1;
    while (stack.length) {
      const p = stack.pop()!;
      comp.push(p);
      const px = p % w;
      const py = (p / w) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const qx = px + dx;
        const qy = py + dy;
        if (qx < 0 || qx >= w || qy < 0 || qy >= h) continue;
        const q = qy * w + qx;
        if (dark[q] && !seen[q]) {
          seen[q] = 1;
          stack.push(q);
        }
      }
    }
    if (comp.length > best.length) best = comp;
  }
  if (!best.length) return null;
  let sx = 0;
  let sy = 0;
  for (const p of best) {
    sx += p % w;
    sy += (p / w) | 0;
  }
  return { x: x0 + sx / best.length, y: y0 + sy / best.length };
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

describe('fieldImageFor (variant-aware artwork registry)', () => {
  it('2025 swaps artwork with the construction variant', () => {
    const welded = fieldImageFor('reefscape-2025', 'welded', undefined);
    const andymark = fieldImageFor('reefscape-2025', 'andymark', undefined);
    expect(welded).toBeDefined();
    expect(andymark).toBeDefined();
    expect(welded).not.toBe(andymark);
    // The variant-less key keeps pointing at the welded sheet.
    expect(welded).toBe(FIELD_IMAGES['reefscape-2025']);
  });

  it('single-artwork seasons keep one URL across variants', () => {
    expect(fieldImageFor('rebuilt-2026', 'welded', undefined))
      .toBe(fieldImageFor('rebuilt-2026', 'andymark', undefined));
    expect(fieldImageFor('crescendo-2024', 'welded', undefined))
      .toBe(fieldImageFor('crescendo-2024', 'andymark', undefined));
  });

  it('custom fields fall through to the user image', () => {
    expect(fieldImageFor(CUSTOM_FIELD_ID, 'welded', 'blob:x')).toBe('blob:x');
  });

  it('the two 2025 sheets are different files with matching dimensions', () => {
    const base = fieldById('reefscape-2025');
    const wFile = asset('reefscape2025-welded.png');
    const aFile = asset('reefscape2025-andymark.png');
    expect(readFileSync(wFile).equals(readFileSync(aFile))).toBe(false);
    expect(decodePng(wFile).width).toBe(base.image!.pixelWidth);
    expect(decodePng(wFile).height).toBe(base.image!.pixelHeight);
    expect(decodePng(aFile).width).toBe(base.imageAndyMark!.pixelWidth);
    expect(decodePng(aFile).height).toBe(base.imageAndyMark!.pixelHeight);
  });
});

describe('2025 artwork ↔ official tag layout registration', () => {
  for (const variant of ['welded', 'andymark'] as const) {
    it(`${variant}: all 22 decals found, median offset ≤ 2 px, scatter ≤ 28 px`, () => {
      const field = withFieldVariant(fieldById('reefscape-2025'), variant);
      const file =
        variant === 'andymark' ? asset('reefscape2025-andymark.png') : asset('reefscape2025-welded.png');
      const png = decodePng(file);
      const img = field.image!;
      const dxs: number[] = [];
      const dys: number[] = [];
      for (const tag of field.aprilTags!) {
        const col = img.originPx!.x + tag.x * img.ppm;
        const row = img.pixelHeight - (img.originPx!.y + tag.y * (img.ppmY ?? img.ppm));
        const decal = decalCentre(png, col, row);
        expect(decal, `tag ${tag.id} decal missing`).not.toBeNull();
        const dx = decal!.x - col;
        const dy = decal!.y - row;
        dxs.push(dx);
        dys.push(dy);
        expect(Math.abs(dx), `tag ${tag.id} dx`).toBeLessThanOrEqual(28);
        expect(Math.abs(dy), `tag ${tag.id} dy`).toBeLessThanOrEqual(28);
      }
      // The calibration itself must carry no systematic bias — only the
      // artwork's structure looseness may remain in the per-tag scatter.
      expect(Math.abs(median(dxs))).toBeLessThanOrEqual(2);
      expect(Math.abs(median(dys))).toBeLessThanOrEqual(2);
    });
  }
});
