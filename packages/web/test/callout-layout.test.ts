import { describe, expect, it } from 'vitest';
import { placeLabel, rectsIntersect, type LayoutRect } from '../src/callout-layout';

/** The exact clamp the badge placement used before collision layout —
 *  regression anchor: with nothing in the way nothing may move. */
function legacyClampX(anchorX: number, side: 1 | -1, offset: number, w: number, margin: number, canvasW: number) {
  return Math.max(margin, Math.min(
    anchorX + side * offset - (side < 0 ? w : 0),
    canvasW - margin - w,
  ));
}
function legacyClampY(y0: number, margin: number, canvasH: number, h: number) {
  return Math.max(margin, Math.min(y0, canvasH - margin - h));
}

const base = {
  anchor: { x: 200, y: 200 },
  offset: 32,
  size: { w: 100, h: 24 },
  prefer: 1 as const,
  y0: 156,
  canvas: { w: 400, h: 400 },
  margin: 6,
  gap: 4,
  obstacles: [] as LayoutRect[],
};

describe('placeLabel', () => {
  it('keeps the legacy diagonal when nothing is in the way', () => {
    const p = placeLabel(base);
    expect(p).toEqual({
      x: legacyClampX(200, 1, 32, 100, 6, 400),
      y: legacyClampY(156, 6, 400, 24),
      side: 1,
    });
    expect(p).toEqual({ x: 232, y: 156, side: 1 });
  });

  it('keeps the legacy canvas clamps near edges', () => {
    const p = placeLabel({ ...base, anchor: { x: 390, y: 4 } });
    expect(p.x).toBe(legacyClampX(390, 1, 32, 100, 6, 400));
    expect(p.y).toBe(legacyClampY(156, 6, 400, 24));
  });

  it('mirrors onto the other diagonal when the preferred side is blocked', () => {
    const blocked: LayoutRect = { x: 220, y: 146, w: 120, h: 44 };
    const p = placeLabel({ ...base, obstacles: [blocked] });
    expect(p.side).toBe(-1);
    expect(p.x).toBe(legacyClampX(200, -1, 32, 100, 6, 400));
    expect(rectsIntersect({ ...p, w: 100, h: 24 }, blocked)).toBe(false);
  });

  it('slides below the obstacle when both diagonals are blocked', () => {
    // One wide obstacle covering both diagonals at the desired height.
    const blocked: LayoutRect = { x: 0, y: 130, w: 400, h: 50 };
    const p = placeLabel({ ...base, obstacles: [blocked] });
    expect(p.y).toBe(blocked.y + blocked.h + 4);
    expect(rectsIntersect({ ...p, w: 100, h: 24 }, blocked)).toBe(false);
  });

  it('slides above when the space below is off-canvas', () => {
    // Obstacle reaching the bottom edge: only the room above is free.
    const blocked: LayoutRect = { x: 0, y: 60, w: 400, h: 334 };
    const p = placeLabel({ ...base, obstacles: [blocked] });
    expect(p.y).toBe(blocked.y - 4 - 24);
    expect(rectsIntersect({ ...p, w: 100, h: 24 }, blocked)).toBe(false);
  });

  it('falls back to minimal overlap when no spot is free, staying on-canvas', () => {
    // Full-width obstacle leaving a free strip thinner than the label:
    // every placement is covered; the least-covered one wins.
    const blocked: LayoutRect = { x: 0, y: 0, w: 400, h: 380 };
    const p = placeLabel({ ...base, obstacles: [blocked] });
    // Clamp ceiling is 400 - 6 - 24 = 370; the label covers 370..394,
    // the obstacle ends at 380 → 10 px of overlap, the minimum possible.
    expect(p.y).toBe(370);
    expect(p.x).toBeGreaterThanOrEqual(6);
    expect(p.x).toBeLessThanOrEqual(400 - 6 - 100);
  });

  it('prefers the preferred side on an exact tie in the fallback', () => {
    // Two full-width obstacles leaving a 16 px gap at the desired height —
    // too narrow for the 24 px label, so every candidate is covered. The
    // straddling spot overlaps least; between its mirrored twins the
    // preferred side wins the tie.
    const obstacles: LayoutRect[] = [
      { x: 0, y: 0, w: 400, h: 160 },
      { x: 0, y: 176, w: 400, h: 224 },
    ];
    const p = placeLabel({ ...base, prefer: -1, obstacles });
    expect(p.side).toBe(-1);
    expect(p.y).toBe(156);
  });

  it('moves as little as possible when sliding', () => {
    // A small obstacle sits just under the desired spot; the nearest
    // clear candidate is snugging its top edge above the obstacle.
    const blocked: LayoutRect = { x: 220, y: 182, w: 120, h: 40 };
    const p = placeLabel({ ...base, obstacles: [blocked] });
    // Desired y 156..180 already clears the obstacle (starts at 182) —
    // the diagonal itself is free, no movement at all.
    expect(p).toEqual({ x: 232, y: 156, side: 1 });
  });
});
