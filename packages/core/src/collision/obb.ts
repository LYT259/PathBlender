/**
 * Oriented bounding box (bumper rectangle) overlap via the Separating Axis
 * Theorem. Two rectangles are disjoint iff some axis (each box's edge
 * normals — 4 candidates total) separates their projections.
 *
 * More precise than the 103 fork's bounding circles for near-square FRC
 * chassis, which circle tests would over-report.
 */

import type { Pose2d, RobotGeometry } from '../types';

export interface Obb {
  cx: number;
  cy: number;
  /** Half-length along the box's local +x. */
  hl: number;
  /** Half-width along the box's local +y. */
  hw: number;
  angle: number;
}

export function poseToObb(pose: Pose2d, g: RobotGeometry): Obb {
  // Bumper center = pose + R(heading) · offset.
  const c = Math.cos(pose.heading);
  const s = Math.sin(pose.heading);
  return {
    cx: pose.x + c * g.offsetX - s * g.offsetY,
    cy: pose.y + s * g.offsetX + c * g.offsetY,
    hl: g.lengthM / 2,
    hw: g.widthM / 2,
    angle: pose.heading,
  };
}

function project(b: Obb, axX: number, axY: number): { min: number; max: number } {
  const c = b.cx * axX + b.cy * axY;
  const r =
    Math.abs(axX * Math.cos(b.angle) + axY * Math.sin(b.angle)) * b.hl +
    Math.abs(-axX * Math.sin(b.angle) + axY * Math.cos(b.angle)) * b.hw;
  return { min: c - r, max: c + r };
}

/** True when the two oriented rectangles overlap. */
export function obbOverlap(a: Obb, b: Obb): boolean {
  const axes: Array<[number, number]> = [
    [Math.cos(a.angle), Math.sin(a.angle)],
    [-Math.sin(a.angle), Math.cos(a.angle)],
    [Math.cos(b.angle), Math.sin(b.angle)],
    [-Math.sin(b.angle), Math.cos(b.angle)],
  ];
  for (const [ax, ay] of axes) {
    const pa = project(a, ax, ay);
    const pb = project(b, ax, ay);
    if (pa.max < pb.min || pb.max < pa.min) return false; // separating axis
  }
  return true;
}

/** Center-to-center distance between two poses. */
export function centerDistance(a: Pose2d, b: Pose2d): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
