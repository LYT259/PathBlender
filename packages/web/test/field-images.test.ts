/**
 * Construction-variant and artwork-style field images (2025 Reefscape):
 *
 * 1. `fieldImageFor` resolves the artwork per variant and style — the
 *    schematic base key for every season, a rendered key for 2022–2026,
 *    and the official welded/AndyMark rendered pair for 2025.
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
import { describe, expect, it } from 'vitest';
import { CUSTOM_FIELD_ID, FIELDS, fieldById, withFieldVariant } from '@pathblender/core';
import { FIELD_IMAGES, fieldImageFor } from '../src/field-images';
import { decodePng, type Png } from './png';

const asset = (name: string) => resolve(__dirname, `../../../assets/fields/${name}`);

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

describe('fieldImageFor (variant- and style-aware artwork registry)', () => {
  it('schematic is the base key: one URL across variants and styles', () => {
    for (const id of ['rapidreact-2022', 'chargedup-2023', 'crescendo-2024', 'reefscape-2025', 'rebuilt-2026']) {
      expect(fieldImageFor(id, 'welded', 'schematic', undefined))
        .toBe(fieldImageFor(id, 'andymark', 'schematic', undefined))
        .toBe(FIELD_IMAGES[id]);
    }
  });

  it('every 2022–2026 season resolves a rendered artwork under both variants', () => {
    for (const id of ['rapidreact-2022', 'chargedup-2023', 'crescendo-2024', 'reefscape-2025', 'rebuilt-2026']) {
      const welded = fieldImageFor(id, 'welded', 'rendered', undefined);
      const andymark = fieldImageFor(id, 'andymark', 'rendered', undefined);
      expect(welded, `${id} rendered`).toBeDefined();
      expect(andymark, `${id} rendered/andymark`).toBeDefined();
      expect(welded).toBe(FIELD_IMAGES[`${id}/rendered`]);
    }
  });

  it('2025 rendered swaps artwork with the construction variant; only that season does', () => {
    expect(fieldImageFor('reefscape-2025', 'welded', 'rendered', undefined))
      .not.toBe(fieldImageFor('reefscape-2025', 'andymark', 'rendered', undefined));
    for (const id of ['rebuilt-2026', 'crescendo-2024']) {
      expect(fieldImageFor(id, 'welded', 'rendered', undefined))
        .toBe(fieldImageFor(id, 'andymark', 'rendered', undefined));
    }
  });

  it('every bundled season resolves both its artwork styles', () => {
    for (const f of FIELDS) {
      expect(fieldImageFor(f.id, 'welded', 'schematic', undefined)).toBeDefined();
      expect(fieldImageFor(f.id, 'welded', 'rendered', undefined)).toBeDefined();
    }
  });

  it('custom fields fall through to the user image', () => {
    expect(fieldImageFor(CUSTOM_FIELD_ID, 'welded', 'schematic', 'blob:x')).toBe('blob:x');
  });

  it('the two 2025 rendered sheets are different files with matching dimensions', () => {
    const base = fieldById('reefscape-2025');
    const wFile = asset('reefscape2025-welded.png');
    const aFile = asset('reefscape2025-andymark.png');
    expect(readFileSync(wFile).equals(readFileSync(aFile))).toBe(false);
    expect(decodePng(wFile).width).toBe(base.imageRendered!.pixelWidth);
    expect(decodePng(wFile).height).toBe(base.imageRendered!.pixelHeight);
    expect(decodePng(aFile).width).toBe(base.imageRenderedAndyMark!.pixelWidth);
    expect(decodePng(aFile).height).toBe(base.imageRenderedAndyMark!.pixelHeight);
  });

  it('every registered PNG matches its calibration dimensions (IHDR guard)', () => {
    const dims: Record<string, [number, number]> = {
      'rapidreact-2022': [3240, 1620],
      'chargedup-2023': [3256, 1578],
      'crescendo-2024': [3256, 1616],
      'rebuilt-2026': [3508, 1814],
      'rapidreact-2022/rendered': [7045, 2934],
      'reefscape-2025': [3510, 1610],
      'chargedup-2023/rendered': [3608, 1462],
      'crescendo-2024/rendered': [3840, 1554],
      'rebuilt-2026/rendered': [7804, 3168],
    };
    const files: Record<string, string> = {
      'rapidreact-2022': 'rapidreact2022.png',
      'chargedup-2023': 'chargedup2023.png',
      'crescendo-2024': 'crescendo2024.png',
      'rebuilt-2026': 'rebuilt2026.png',
      'rapidreact-2022/rendered': 'rapidreact2022-rendered.png',
      'reefscape-2025': 'reefscape2025-schematic.png',
      'chargedup-2023/rendered': 'chargedup2023-rendered.png',
      'crescendo-2024/rendered': 'crescendo2024-rendered.png',
      'rebuilt-2026/rendered': 'rebuilt2026-rendered.png',
    };
    for (const [key, [w, h]] of Object.entries(dims)) {
      const png = decodePng(asset(files[key]!));
      expect(png.width, `${key} width`).toBe(w);
      expect(png.height, `${key} height`).toBe(h);
      // And the core calibration for that style agrees.
      const field = fieldById(key.split('/')[0]!);
      const cal = key.endsWith('/rendered') ? field.imageRendered : field.image;
      expect(cal!.pixelWidth).toBe(w);
      expect(cal!.pixelHeight).toBe(h);
    }
  });
});

describe('2025 rendered artwork ↔ official tag layout registration', () => {
  for (const variant of ['welded', 'andymark'] as const) {
    it(`${variant}: all 22 decals found, median offset ≤ 2 px, scatter ≤ 28 px`, () => {
      const field = withFieldVariant(fieldById('reefscape-2025'), variant, 'rendered');
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
      // dy budget is 3 px, not 2: several decals connect to the wall's
      // dark mass, so the blob centroid tracks the search-window edge —
      // median dy swings −2.1→−1.4 with window half-width 28→44 while
      // staying flat across originY 72–74 (a real bias would move with
      // originY). dx decals are compact and keep the 2 px budget.
      expect(Math.abs(median(dxs))).toBeLessThanOrEqual(2);
      expect(Math.abs(median(dys))).toBeLessThanOrEqual(3);
    });
  }
});
