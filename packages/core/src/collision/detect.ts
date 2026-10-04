/**
 * Multi-robot collision scan on the unified session clock.
 *
 * Samples every robot pair at a fixed step over the union of their active
 * windows, merges adjacent hits into intervals, and reports the closest
 * approach (center distance) inside each interval. Default step 0.02 s is
 * 5× finer than the 103 fork's 0.1 s (study §6.2).
 *
 * Timing tolerance (red book §6.5-①, landed 2026-10-04): with toleranceS >
 * 0 each robot's start may slip ±toleranceS seconds on the real field, so
 * the scan repeats per pair at relative start shifts {-2δ, -δ, 0, +δ, +2δ}
 * (both robots slipping ±δ → worst relative shift ±2δ). Intervals found
 * only at non-zero shift are tagged 'tolerance' — the paper plan looked
 * safe, the field may not be.
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
  /**
   * 'planned' = overlaps on the paper timeline; 'tolerance' = overlaps only
   * when a start slips within the ±δ window. Always 'planned' when the scan
   * ran without tolerance.
   */
  kind: 'planned' | 'tolerance';
  /** Relative start shift of b vs a (seconds) that produced the closest approach. */
  offsetS: number;
  /** The tolerance the scan ran with, when tolerance-aware. */
  toleranceS?: number;
}

export interface DetectOptions {
  stepS?: number;
  /** ±δ start-execution window; 0 (default) = paper timeline only. */
  toleranceS?: number;
}

/** Relative start shifts scanned for a ±δ per-robot window (worst case ±2δ). */
function toleranceOffsets(delta: number): number[] {
  return [-2 * delta, -delta, 0, delta, 2 * delta];
}

interface RawInterval {
  startT: number;
  endT: number;
  minCenterDistanceM: number;
  closestT: number;
  closestA: Pose2d;
  closestB: Pose2d;
  offsetS: number;
  nominal: boolean;
}

function scanPair(
  a: SessionTrajectory,
  b: SessionTrajectory,
  step: number,
  offset: number,
  from: number,
  to: number,
): RawInterval[] {
  const results: RawInterval[] = [];
  let open: RawInterval | undefined;
  for (let t = from; t <= to + 1e-9; t += step) {
    const pa = samplePoseAt(a, t);
    // offset > 0 = b starts later: its local clock trails by offset.
    const pb = samplePoseAt(b, t - offset);
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
          startT: t,
          endT: t,
          minCenterDistanceM: d,
          closestT: t,
          closestA: pa,
          closestB: pb,
          offsetS: offset,
          nominal: offset === 0,
        };
      }
    } else if (open && t - open.endT > 1.5 * step) {
      results.push(open);
      open = undefined;
    }
  }
  if (open) results.push(open);
  return results;
}

export function detectCollisions(
  robots: readonly SessionTrajectory[],
  opts: DetectOptions = {},
): CollisionInterval[] {
  const step = opts.stepS ?? 0.02;
  const delta = opts.toleranceS ?? 0;
  const results: CollisionInterval[] = [];

  for (let i = 0; i < robots.length; i++) {
    for (let j = i + 1; j < robots.length; j++) {
      const a = robots[i] as SessionTrajectory;
      const b = robots[j] as SessionTrajectory;
      const from = Math.min(activeStartT(a), activeStartT(b)) - (delta > 0 ? 2 * delta : 0);
      const to = Math.max(activeEndT(a), activeEndT(b)) + (delta > 0 ? 2 * delta : 0);
      const offsets = delta > 0 ? toleranceOffsets(delta) : [0];

      const raw: RawInterval[] = [];
      for (const offset of offsets) raw.push(...scanPair(a, b, step, offset, from, to));
      if (raw.length === 0) continue;

      // Merge windows that touch across shifts; a merged interval is
      // 'planned' when the nominal shift contributed, and reports the
      // closest approach found at any shift (worst case over the window).
      raw.sort((x, y) => x.startT - y.startT);
      let cur: RawInterval | undefined;
      for (const interval of raw) {
        if (cur && interval.startT <= cur.endT + 1.5 * step) {
          cur.endT = Math.max(cur.endT, interval.endT);
          cur.nominal = cur.nominal || interval.nominal;
          if (interval.minCenterDistanceM < cur.minCenterDistanceM) {
            cur.minCenterDistanceM = interval.minCenterDistanceM;
            cur.closestT = interval.closestT;
            cur.closestA = interval.closestA;
            cur.closestB = interval.closestB;
            cur.offsetS = interval.offsetS;
          }
        } else {
          if (cur) results.push(toCollision(cur, delta, a.trajectory.id, b.trajectory.id));
          cur = { ...interval };
        }
      }
      if (cur) results.push(toCollision(cur, delta, a.trajectory.id, b.trajectory.id));
    }
  }
  return results.sort((x, y) => x.startT - y.startT);
}

function toCollision(raw: RawInterval, delta: number, aId: string, bId: string): CollisionInterval {
  return {
    aId,
    bId,
    startT: raw.startT,
    endT: raw.endT,
    minCenterDistanceM: raw.minCenterDistanceM,
    closestT: raw.closestT,
    closestA: raw.closestA,
    closestB: raw.closestB,
    kind: raw.nominal ? 'planned' : 'tolerance',
    offsetS: raw.offsetS,
    toleranceS: delta > 0 ? delta : undefined,
  };
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
