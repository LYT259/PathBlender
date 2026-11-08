/**
 * Robot OBB vs field-obstacle convex hull (red book §6.2: robot OBB vs
 * field elements). SAT overlap depth along the minimum translation vector,
 * plus the sampled interval detector reusing the field-bounds semantics.
 */

import type { FieldObstacle, HullPoint } from '../field-obstacles';
import type { Pose2d } from '../types';
import { activeEndT, activeStartT, samplePoseAt } from '../session';
import type { SessionTrajectory } from '../session';
import { BOUNDS_TOLERANCE_M } from './field-bounds';
import type { Obb } from './obb';
import { poseToObb } from './obb';

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

export interface ObstacleCollisionInterval {
  robotId: string;
  obstacleId: string;
  startT: number;
  endT: number;
  /** Deepest in-tolerance penetration (raw SAT depth at the worst sample), meters. */
  maxPenetrationM: number;
  /** Pose at the deepest penetration. */
  worstPose: Pose2d;
}

export interface ObstacleDetectOptions {
  stepS?: number;
}

/**
 * Sampled robot-vs-obstacle collision intervals, mirroring detectFieldBounds:
 * 0.05 s default step, the 3 in BOUNDS_TOLERANCE_M forgiveness (≥ counts,
 * same "equal already reports" user rule), and the 1.5×step gap-merge rule.
 */
export function detectObstacleCollisions(
  robots: readonly SessionTrajectory[],
  obstacles: readonly FieldObstacle[],
  opts: ObstacleDetectOptions = {},
): ObstacleCollisionInterval[] {
  const step = opts.stepS ?? 0.05;
  const results: ObstacleCollisionInterval[] = [];

  for (const robot of robots) {
    const from = activeStartT(robot);
    const to = activeEndT(robot);
    const open = new Map<string, ObstacleCollisionInterval>();

    for (let t = from; t <= to + 1e-9; t += step) {
      const pose = samplePoseAt(robot, t);
      const obb = poseToObb(pose, robot.trajectory.geometry);
      for (const o of obstacles) {
        const depth = obbVsConvexPolygonDepth(obb, o.hull);
        if (depth >= BOUNDS_TOLERANCE_M) {
          const hit = open.get(o.id);
          if (hit) {
            hit.endT = t;
            if (depth > hit.maxPenetrationM) {
              hit.maxPenetrationM = depth;
              hit.worstPose = pose;
            }
          } else {
            open.set(o.id, {
              robotId: robot.trajectory.id,
              obstacleId: o.id,
              startT: t,
              endT: t,
              maxPenetrationM: depth,
              worstPose: pose,
            });
          }
        } else {
          const hit = open.get(o.id);
          if (hit && t - hit.endT > 1.5 * step) {
            results.push(hit);
            open.delete(o.id);
          }
        }
      }
    }
    for (const hit of open.values()) results.push(hit);
  }
  return results.sort((a, b) => a.startT - b.startT);
}
