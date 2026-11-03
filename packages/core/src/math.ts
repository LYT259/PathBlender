/**
 * Sampling helpers: binary-search + linear interpolation over
 * time-parameterized states, with shortest-arc heading interpolation
 * (matches the 103 fork's sampleLinear approach for .ghostauto).
 */

import type { Pose2d, TrajectoryGap, TrajectorySample } from './types';

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
 * The state at the start of the gap covering `t`, with zero velocity —
 * the honest pose for a dropout: the robot is held at its last known
 * state and no motion is invented across the uncovered span.
 */
function holdAtGapStart(gaps: readonly TrajectoryGap[], samples: TrajectorySample[], t: number): TrajectorySample | undefined {
  for (const gap of gaps) {
    if (t >= gap.startT && t < gap.endT) {
      // The sample at (or just before) the gap start holds.
      let low = 0;
      let high = samples.length - 1;
      while (low !== high) {
        const mid = Math.ceil((low + high) / 2);
        if ((samples[mid] as TrajectorySample).t <= gap.startT) low = mid;
        else high = mid - 1;
      }
      const held = samples[low] as TrajectorySample;
      return { ...held, t, vx: 0, vy: 0, omega: 0 };
    }
  }
  return undefined;
}

/**
 * Sample the trajectory at time t. Before the first sample returns the
 * first state; after the last returns the last state (clamped). A query
 * inside a wpilog gap (trajectory.gaps) holds the last known state with
 * zero velocity — never interpolated across the uncovered span.
 */
export function sampleTrajectory(
  samples: TrajectorySample[],
  t: number,
  gaps?: readonly TrajectoryGap[],
): TrajectorySample | undefined {
  if (samples.length === 0) return undefined;
  const first = samples[0] as TrajectorySample;
  const last = samples[samples.length - 1] as TrajectorySample;
  if (t <= first.t) return first;
  if (t >= last.t) return last;
  if (gaps && gaps.length > 0) {
    const held = holdAtGapStart(gaps, samples, t);
    if (held) return held;
  }

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
