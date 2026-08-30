/**
 * Multi-robot collision scan on the unified session clock.
 *
 * Samples every robot pair at a fixed step over the union of their active
 * windows, merges adjacent hits into intervals, and reports the closest
 * approach (center distance) inside each interval. Default step 0.02 s is
 * 5× finer than the 103 fork's 0.1 s (study §6.2).
 */

import type { Pose2d } from '../types';
import { activeEndT, activeStartT, samplePoseAt } from '../session';
import type { SessionTrajectory } from '../session';
import { centerDistance, obbOverlap, poseToObb } from './obb';

export interface CollisionInterval {
  aId: string;
  bId: string;
  /** Global-clock window of overlap, seconds. */
  startT: number;
  endT: number;
  /** Minimum center distance within the interval, meters. */
  minCenterDistanceM: number;
  /** Closest approach on the global clock, seconds. */
  closestT: number;
  closestA: Pose2d;
  closestB: Pose2d;
}

export interface DetectOptions {
  stepS?: number;
}

export function detectCollisions(
  robots: readonly SessionTrajectory[],
  opts: DetectOptions = {},
): CollisionInterval[] {
  const step = opts.stepS ?? 0.02;
  const results: CollisionInterval[] = [];

  for (let i = 0; i < robots.length; i++) {
    for (let j = i + 1; j < robots.length; j++) {
      const a = robots[i] as SessionTrajectory;
      const b = robots[j] as SessionTrajectory;
      const from = Math.min(activeStartT(a), activeStartT(b));
      const to = Math.max(activeEndT(a), activeEndT(b));

      let open: CollisionInterval | undefined;
      for (let t = from; t <= to + 1e-9; t += step) {
        const pa = samplePoseAt(a, t);
        const pb = samplePoseAt(b, t);
        const hit = obbOverlap(
          poseToObb(pa, a.trajectory.geometry),
          poseToObb(pb, b.trajectory.geometry),
        );
        if (hit) {
          const d = centerDistance(pa, pb);
          if (open) {
            open.endT = t;
            if (d < open.minCenterDistanceM) {
              open.minCenterDistanceM = d;
              open.closestT = t;
              open.closestA = pa;
              open.closestB = pb;
            }
          } else {
            open = {
              aId: a.trajectory.id,
              bId: b.trajectory.id,
              startT: t,
              endT: t,
              minCenterDistanceM: d,
              closestT: t,
              closestA: pa,
              closestB: pb,
            };
          }
        } else if (open) {
          if (t - open.endT > 1.5 * step) {
            results.push(open);
            open = undefined;
          }
        }
      }
      if (open) results.push(open);
    }
  }
  return results.sort((x, y) => x.startT - y.startT);
}

/** Minimum pairwise center distance over the whole timeline (early-warning metric, P1). */
export function minimumSeparation(
  robots: readonly SessionTrajectory[],
  opts: DetectOptions = {},
): { aId: string; bId: string; distanceM: number; t: number } | undefined {
  const step = opts.stepS ?? 0.05;
  let best: { aId: string; bId: string; distanceM: number; t: number } | undefined;
  for (let i = 0; i < robots.length; i++) {
    for (let j = i + 1; j < robots.length; j++) {
      const a = robots[i] as SessionTrajectory;
      const b = robots[j] as SessionTrajectory;
      const from = Math.min(activeStartT(a), activeStartT(b));
      const to = Math.max(activeEndT(a), activeEndT(b));
      for (let t = from; t <= to + 1e-9; t += step) {
        const d = centerDistance(samplePoseAt(a, t), samplePoseAt(b, t));
        if (!best || d < best.distanceM) {
          best = { aId: a.trajectory.id, bId: b.trajectory.id, distanceM: d, t };
        }
      }
    }
  }
  return best;
}
