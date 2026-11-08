/**
 * Robot OBB vs field-obstacle convex hull (red book §6.2: robot OBB vs
 * field elements). SAT overlap depth along the minimum translation vector.
 */

import type { HullPoint } from '../field-obstacles';
import type { Obb } from './obb';

/** Projection of an OBB onto a unit axis (exact — sum of |extents| terms). */
function projectObb(b: Obb, axX: number, axY: number): { min: number; max: number } {
  const c = b.cx * axX + b.cy * axY;
  const r =
    Math.abs(axX * Math.cos(b.angle) + axY * Math.sin(b.angle)) * b.hl +
    Math.abs(-axX * Math.sin(b.angle) + axY * Math.cos(b.angle)) * b.hw;
  return { min: c - r, max: c + r };
}

/** Projection of a convex hull onto a unit axis. */
function projectHull(hull: readonly HullPoint[], axX: number, axY: number): { min: number; max: number } {
  let min = Infinity;
  let max = -Infinity;
  for (const p of hull) {
    const d = p.x * axX + p.y * axY;
    if (d < min) min = d;
    if (d > max) max = d;
  }
  return { min, max };
}

/**
 * SAT overlap depth between an OBB and a CCW convex hull, meters.
 * 0 when separated; otherwise the minimum overlap over all candidate axes
 * (the OBB's two edge normals + every hull edge normal) — the depth along
 * the minimum translation vector.
 */
export function obbVsConvexPolygonDepth(obb: Obb, hull: readonly HullPoint[]): number {
  const axes: Array<[number, number]> = [
    [Math.cos(obb.angle), Math.sin(obb.angle)],
    [-Math.sin(obb.angle), Math.cos(obb.angle)],
  ];
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i]!;
    const b = hull[(i + 1) % hull.length]!;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len > 0) axes.push([(b.y - a.y) / len, -(b.x - a.x) / len]);
  }

  let depth = Infinity;
  for (const [axX, axY] of axes) {
    const pa = projectObb(obb, axX, axY);
    const pb = projectHull(hull, axX, axY);
    if (pa.max < pb.min || pb.max < pa.min) return 0; // separating axis
    const overlap = Math.min(pa.max, pb.max) - Math.max(pa.min, pb.min);
    if (overlap < depth) depth = overlap;
  }
  return depth;
}
