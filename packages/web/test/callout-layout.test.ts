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

  it('with stickySide, slides on the preferred side before ever mirroring', () => {
    // Same blocked preferred diagonal; the mirrored diagonal is free, but a
    // remembered card slides on its own side instead (above and below are
    // equidistant here; ties resolve to the upper slot).
    const blocked: LayoutRect = { x: 220, y: 146, w: 120, h: 44 };
    const p = placeLabel({ ...base, obstacles: [blocked], stickySide: true });
    expect(p.side).toBe(1);
    expect(p.x).toBe(232);
    expect(p.y).toBe(blocked.y - 4 - 24);
    expect(rectsIntersect({ ...p, w: 100, h: 24 }, blocked)).toBe(false);
    // Only when the whole preferred side is taken does it cross over.
    const wall: LayoutRect = { x: 232, y: 0, w: 168, h: 400 };
    const crossed = placeLabel({ ...base, obstacles: [wall], stickySide: true });
    expect(crossed.side).toBe(-1);
    expect(rectsIntersect({ ...crossed, w: 100, h: 24 }, wall)).toBe(false);
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

  it('slides sideways along the row when a short canvas leaves no vertical room', () => {
    // A 40 px tall strip: a 24 px label fits one row only (y 6 or 10, which
    // overlap). Two labels already occupy both diagonals of a shared anchor;
    // the third must step past them along the row rather than cover one
    // (2D walkthrough: an 84 px canvas with three bunched robots).
    const strip = { ...base, canvas: { w: 800, h: 40 }, anchor: { x: 400, y: 20 }, y0: -60 };
    const first = placeLabel({ ...strip, obstacles: [] });
    const second = placeLabel({ ...strip, obstacles: [{ ...first, w: 100, h: 24 }] });
    const third = placeLabel({ ...strip, obstacles: [{ ...first, w: 100, h: 24 }, { ...second, w: 100, h: 24 }] });
    expect(first).toEqual({ x: 432, y: 6, side: 1 });
    expect(second).toEqual({ x: 268, y: 6, side: -1 });
    expect(third.y).toBe(6);
    for (const taken of [first, second]) expect(rectsIntersect({ ...third, w: 100, h: 24 }, { ...taken, w: 100, h: 24 })).toBe(false);
    expect(third.x).toBe(432 + 100 + 4); // snug past the right-hand label
    expect(third.side).toBe(1);
  });
});
