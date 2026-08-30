/**
 * Geometry helpers ported from PathPlanner (MIT) lib/util/geometry_util.dart
 * plus the rotation interpolation used by its trajectory generation.
 */

import { wrapAngle } from '../math';

export interface Vec2 {
  x: number;
  y: number;
}

export function lerpVec(a: Vec2, b: Vec2, t: number): Vec2 {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

export function dist(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function angleOf(v: Vec2): number {
  return Math.atan2(v.y, v.x);
}

/** De Casteljau quadratic. */
export function quadraticLerp(a: Vec2, b: Vec2, c: Vec2, t: number): Vec2 {
  const ab = lerpVec(a, b, t);
  const bc = lerpVec(b, c, t);
  return lerpVec(ab, bc, t);
}

/** Cubic bezier via two quadratics (as the PathPlanner GUI does). */
export function cubicLerp(a: Vec2, b: Vec2, c: Vec2, d: Vec2, t: number): Vec2 {
  const abc = quadraticLerp(a, b, c, t);
  const bcd = quadraticLerp(b, c, d, t);
  return lerpVec(abc, bcd, t);
}

/**
 * Signed circumradius through three points (Inf when collinear).
 * Ported 1:1 from GeometryUtil.calculateRadius.
 */
export function calculateRadius(a: Vec2, b: Vec2, c: Vec2): number {
  const vba = { x: a.x - b.x, y: a.y - b.y };
  const vbc = { x: c.x - b.x, y: c.y - b.y };
  const crossZ = vba.x * vbc.y - vba.y * vbc.x;
  const sign = crossZ < 0 ? 1 : -1;
  const ab = dist(a, b);
  const bc = dist(b, c);
  const ac = dist(a, c);
  const p = (ab + bc + ac) / 2;
  const area = Math.sqrt(Math.abs(p * (p - ab) * (p - bc) * (p - ac)));
  if (area < 1e-12) return Number.POSITIVE_INFINITY;
  return (sign * ab * bc * ac) / (4 * area);
}

/** Shortest-arc angle interpolation. */
export function interpolateAngle(a: number, b: number, t: number): number {
  return a + wrapAngle(b - a) * t;
}

/** Cosine-eased angle interpolation (used for holonomic rotation). */
export function cosineInterpolateAngle(a: number, b: number, t: number): number {
  const t2 = (1.0 - Math.cos(t * Math.PI)) / 2.0;
  return interpolateAngle(a, b, t2);
}
