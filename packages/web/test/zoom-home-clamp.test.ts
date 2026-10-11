import { describe, expect, it } from 'vitest';
import { clampZoomView, fitViewFor, type RenderView } from '../src/canvas2d-render';
import type { FieldPackage } from '@pathblender/core';

// 10 m × 5 m test field on a 440×240 canvas: fit scale is exactly 40 px/m
// and the home centre is the field centre (same shape as field-canvas.test).
const field: FieldPackage = { id: 'test', name: 'Test field', year: 2026, lengthM: 10, widthM: 5 };
const W = 440;
const H = 240;
const HOME = { homeCx: field.lengthM / 2, homeCy: field.widthM / 2 }; // (5, 2.5)
const FIT = fitViewFor(field, W, H);
const FLOOR = FIT.scale; // 40
const MAX = 6000;
const OPTS = { minScale: FLOOR, maxScale: MAX, ...HOME };

describe('clampZoomView (zoom-out floor re-homes onto the fit view)', () => {
  it('lands EXACTLY on home when a zoom-out crosses the floor from off-centre', () => {
    // Cursor-anchored zoom-in pushes the centre away from the field centre;
    // clamping the scale alone left it stuck there with margins showing.
    const offCentre: RenderView = { scale: FLOOR / 1.06, cx: 5.113, cy: 2.553 };
    const v = clampZoomView(offCentre, OPTS);
    expect(v.scale).toBe(FLOOR);
    expect(v.cx).toBe(HOME.homeCx);
    expect(v.cy).toBe(HOME.homeCy);
  });

  it('keeps cursor anchoring when zooming IN from the floor (no snap home)', () => {
    // One mouse notch in (×1.06) anchored at screen (300, 120) — 70% across
    // the canvas, world point (7, 2.5) under the cursor.
    const atFloor: RenderView = { scale: FLOOR, cx: HOME.homeCx, cy: HOME.homeCy };
    const factor = 1.06;
    const next = clampZoomView({ scale: atFloor.scale * factor, cx: atFloor.cx, cy: atFloor.cy }, OPTS);
    // Above the floor: scale grows and cx/cy pass through untouched, so the
    // caller's anchor formula runs (reproduced here — the component's math).
    expect(next.scale).toBe(FLOOR * factor);
    expect(next.cx).toBe(atFloor.cx);
    expect(next.cy).toBe(atFloor.cy);
    const sx = 300;
    const sy = 120;
    const wx = atFloor.cx + (sx - W / 2) / atFloor.scale;
    const wy = atFloor.cy - (sy - H / 2) / atFloor.scale;
    const anchored: RenderView = {
      scale: next.scale,
      cx: wx - (sx - W / 2) / next.scale,
      cy: wy + (sy - H / 2) / next.scale,
    };
    expect(anchored.cx).not.toBe(HOME.homeCx); // centre follows the cursor
    expect(anchored.cx).toBeCloseTo(7 - 80 / (FLOOR * factor), 12);
    expect(anchored.cy).toBe(2.5);
  });

  it('snaps a floor-scale view with off-centre cx/cy back home', () => {
    const v = clampZoomView({ scale: FLOOR, cx: 2, cy: 0.5 }, OPTS);
    expect(v).toEqual({ scale: FLOOR, cx: HOME.homeCx, cy: HOME.homeCy });
    // The relative epsilon (1e-9): a hair above the floor still snaps…
    expect(clampZoomView({ scale: FLOOR * (1 + 5e-10), cx: 2, cy: 0.5 }, OPTS)).toEqual({
      scale: FLOOR, cx: HOME.homeCx, cy: HOME.homeCy,
    });
    // …but a visible step above it does not.
    const above = clampZoomView({ scale: FLOOR * (1 + 1e-8), cx: 2, cy: 0.5 }, OPTS);
    expect(above.scale).toBe(FLOOR * (1 + 1e-8));
    expect(above.cx).toBe(2);
    expect(above.cy).toBe(0.5);
  });

  it('leaves cx/cy untouched for a view strictly between floor and MAX', () => {
    const mid: RenderView = { scale: 200, cx: 3.25, cy: 1.75 };
    const v = clampZoomView(mid, OPTS);
    expect(v.scale).toBe(200);
    expect(v.cx).toBe(3.25);
    expect(v.cy).toBe(1.75);
  });

  it('still clamps at MAX_SCALE without touching cx/cy', () => {
    const v = clampZoomView({ scale: 7000, cx: 3.25, cy: 1.75 }, OPTS);
    expect(v).toEqual({ scale: MAX, cx: 3.25, cy: 1.75 });
    // A view already at the cap stays as-is.
    expect(clampZoomView({ scale: MAX, cx: 1, cy: 4 }, OPTS)).toEqual({ scale: MAX, cx: 1, cy: 4 });
  });
});
