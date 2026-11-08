import { describe, expect, it } from 'vitest';
import { obbVsConvexPolygonDepth, poseToObb } from '../src';
import type { HullPoint } from '../src';

// Axis-aligned unit square obstacle, CCW.
const SQ: readonly HullPoint[] = [
  { x: 2, y: 0 },
  { x: 3, y: 0 },
  { x: 3, y: 1 },
  { x: 2, y: 1 },
];
// 0.9 m square robot geometry (half-extent 0.45), centered on the pose.
const G = { lengthM: 0.9, widthM: 0.9, offsetX: 0, offsetY: 0 };

describe('obbVsConvexPolygonDepth', () => {
  it('reports exact overlap for a face-to-face square-on-square hit', () => {
    // 0.5-square robot centered at (2.5, 0.5) inside the 1-square obstacle.
    const obb = poseToObb({ x: 2.5, y: 0.5, heading: 0 }, { lengthM: 0.5, widthM: 0.5, offsetX: 0, offsetY: 0 });
    expect(obbVsConvexPolygonDepth(obb, SQ)).toBeCloseTo(0.5, 9); // fully inside: depth = robot width
  });

  it('separated boxes give 0', () => {
    const obb = poseToObb({ x: 5, y: 5, heading: 0 }, G);
    expect(obbVsConvexPolygonDepth(obb, SQ)).toBe(0);
  });

  it('45°-rotated robot detects a corner clip with depth in (0, half-diagonal]', () => {
    const obb = poseToObb({ x: 3.2, y: 0.5, heading: Math.PI / 4 }, G);
    const d = obbVsConvexPolygonDepth(obb, SQ);
    expect(d).toBeGreaterThan(0);
    expect(d).toBeLessThanOrEqual(Math.hypot(0.45, 0.45));
  });

  it('depth equals the face overlap for a partial edge crossing', () => {
    // Robot half-overlapping the obstacle's right edge x=3.
    const obb = poseToObb({ x: 3.2, y: 0.5, heading: 0 }, G); // half-extent 0.45 → spans x[2.75, 3.65], y[0.05, 0.95]
    // Projections on +x: obstacle [2,3], robot [2.75, 3.65] → overlap 3 − 2.75 = 0.25.
    // On +y: obstacle [0,1], robot [0.05, 0.95] → overlap 0.90. Hull edges here are
    // axis-aligned, so the axis set is {+x, +y} and the depth (min overlap) is 0.25.
    expect(obbVsConvexPolygonDepth(obb, SQ)).toBeCloseTo(0.25, 9);
  });
});
