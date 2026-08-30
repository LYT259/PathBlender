/**
 * Sampling helpers: binary-search + linear interpolation over
 * time-parameterized states, with shortest-arc heading interpolation
 * (matches the 103 fork's sampleLinear approach for .ghostauto).
 */

import type { Pose2d, TrajectorySample } from './types';

/** Wrap an angle into (-π, π]. */
export function wrapAngle(a: number): number {
  const twoPi = Math.PI * 2;
  let r = a % twoPi;
  if (r > Math.PI) r -= twoPi;
  if (r <= -Math.PI) r += twoPi;
  return r;
}

/** Shortest-arc interpolation between two headings. */
export function lerpAngle(a: number, b: number, t: number): number {
  return a + wrapAngle(b - a) * t;
}

/**
 * Sample the trajectory at time t. Before the first sample returns the
 * first state; after the last returns the last state (clamped).
 */
export function sampleTrajectory(
  samples: TrajectorySample[],
  t: number,
): TrajectorySample | undefined {
  if (samples.length === 0) return undefined;
  const first = samples[0] as TrajectorySample;
  const last = samples[samples.length - 1] as TrajectorySample;
  if (t <= first.t) return first;
  if (t >= last.t) return last;

  // Binary search for the lowest index whose t exceeds the query.
  let low = 1;
  let high = samples.length - 1;
  while (low !== high) {
    const mid = Math.floor((low + high) / 2);
    if ((samples[mid] as TrajectorySample).t < t) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }
  const end = samples[low] as TrajectorySample;
  const start = samples[low - 1] as TrajectorySample;
  const dt = end.t - start.t;
  if (Math.abs(dt) < 1e-9) return end;
  const f = (t - start.t) / dt;
  return {
    t,
    x: start.x + (end.x - start.x) * f,
    y: start.y + (end.y - start.y) * f,
    heading: lerpAngle(start.heading, end.heading, f),
    vx: start.vx + (end.vx - start.vx) * f,
    vy: start.vy + (end.vy - start.vy) * f,
    omega: start.omega + (end.omega - start.omega) * f,
  };
}

export function poseOf(s: TrajectorySample): Pose2d {
  return { x: s.x, y: s.y, heading: s.heading };
}
