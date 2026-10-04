/**
 * Multi-segment auto composition (red book v1.38, landed 2026-10-04):
 * one robot slot plays several of its own team's routes back-to-back on the
 * unified auto clock. Each segment keeps its route's original geometry and
 * in-route timing; the only timing the user arranges is a start delay before
 * the first segment and a wait between consecutive segments. Nothing here
 * interpolates between segments — a discontinuous join stays discontinuous:
 * during a wait the robot is parked at the previous segment's end state with
 * zero velocity, and the join checks report the measured mismatch instead of
 * inventing a connecting route (the red book explicitly rules out link
 * generation for the current viewer-only product).
 */

import type { Pose2d, Trajectory, TrajectorySample } from './types';
import { sampleTrajectory, wrapAngle } from './math';
import type { SessionTrajectory } from './session';

export interface AutoSequenceSegment {
  id: string;
  /** Route-library id; resolved through the robot's own routeOptions. */
  routeId: string;
  /** Wait before this segment starts — seconds after the previous segment ends. */
  waitBeforeS: number;
}

/** Present on a SessionTrajectory once the user arranges a composition. */
export interface AutoSequence {
  segments: AutoSequenceSegment[];
}

/** A segment with its route resolved and its place on the global clock. */
export interface ResolvedSequenceSegment {
  id: string;
  routeId: string;
  waitBeforeS: number;
  trajectory: Trajectory;
  /** Global-clock start/end of this segment's movement. */
  startS: number;
  endS: number;
}

const RAD_TO_DEG = 180 / Math.PI;

/**
 * Join-grading tolerances. These grade the DISPLAY of a seam ("continuous"
 * vs "mismatch of X") — they are not an executability verdict, which the
 * red book forbids us from passing on unverified numbers. The check always
 * reports the measured deltas, and the UI tells the user to fix the route in
 * PathPlanner or Choreo. Defaults chosen conservatively: 1 cm / 1° /
 * 0.05 m·s⁻¹ sits above the discretization noise of two independently
 * generated paths that share a waypoint and below a jump the drive would
 * visibly have to make. Overridable via options; no sample-based calibration
 * exists yet.
 */
export const SEQUENCE_JOIN_TOLERANCES = {
  positionM: 0.01,
  headingDeg: 1,
  speedJumpMps: 0.05,
} as const;

export interface SequenceJoinOptions {
  positionTolM?: number;
  headingTolDeg?: number;
  speedJumpTolMps?: number;
}

/**
 * Resolve a robot's composition onto the global clock. Returns undefined
 * when the robot has no composition (legacy single-route behavior). Waits
 * are clamped to ≥ 0 — the editor already rejects negative input, this is
 * the defensive layer for hand-edited session files. A segment whose routeId
 * no longer resolves (edited/deleted library) falls back to the slot's
 * current trajectory so playback always has a route to show.
 */
export function resolveSequence(st: SessionTrajectory): ResolvedSequenceSegment[] | undefined {
  const sequence = st.sequence;
  if (!sequence || sequence.segments.length === 0) return undefined;
  const options = st.routeOptions ?? [];
  let endS = 0;
  const resolved: ResolvedSequenceSegment[] = [];
  for (const segment of sequence.segments) {
    const wait = Number.isFinite(segment.waitBeforeS) ? Math.max(0, segment.waitBeforeS) : 0;
    const startS = endS + wait;
    const option = options.find((candidate) => candidate.id === segment.routeId);
    const trajectory = option?.trajectory ?? st.trajectory;
    endS = startS + trajectory.durationS;
    resolved.push({ ...segment, waitBeforeS: wait, trajectory, startS, endS });
  }
  return resolved;
}

function poseOrOrigin(trajectory: Trajectory, last: boolean): Pose2d {
  const sample = last ? trajectory.samples[trajectory.samples.length - 1] : trajectory.samples[0];
  return sample ? { x: sample.x, y: sample.y, heading: sample.heading } : { x: 0, y: 0, heading: 0 };
}

/**
 * Full state on the global clock for a composed robot: moving inside a
 * segment (interpolated like any route), parked with zero velocity before
 * the first segment, during waits and after the last segment. Parked means
 * the robot physically stays where the previous segment left it — the
 * honest reading of a gap we must not bridge with fake motion. Returns
 * undefined only when the robot has no composition; callers then fall back
 * to legacy sampling.
 */
export function sampleSequenceState(
  st: SessionTrajectory,
  globalT: number,
): TrajectorySample | undefined {
  const resolved = resolveSequence(st);
  if (!resolved) return undefined;
  const parked = (pose: Pose2d): TrajectorySample => ({
    t: globalT,
    x: pose.x,
    y: pose.y,
    heading: pose.heading,
    vx: 0,
    vy: 0,
    omega: 0,
  });
  const first = resolved[0]!;
  if (globalT < first.startS) return parked(poseOrOrigin(first.trajectory, false));
  // Last segment starting at or before globalT (compositions are short;
  // a backwards scan keeps the 0-wait handoff exact at shared boundaries).
  let active: ResolvedSequenceSegment | undefined;
  for (let i = resolved.length - 1; i >= 0; i--) {
    if (resolved[i]!.startS <= globalT) {
      active = resolved[i]!;
      break;
    }
  }
  if (!active) return parked(poseOrOrigin(first.trajectory, false));
  if (globalT <= active.endS) {
    const local = sampleTrajectory(active.trajectory.samples, globalT - active.startS);
    return local ?? parked({ x: 0, y: 0, heading: 0 });
  }
  // Past the active segment: a wait or the end of the auto — parked at the
  // segment's final state. No interpolation toward the next route.
  return parked(poseOrOrigin(active.trajectory, true));
}

/**
 * Events (game pieces, scoring moments) mapped onto the global clock.
 * Falls back to the legacy single-route mapping when there is no sequence.
 */
export function sequenceEventTimes(st: SessionTrajectory): { name: string; t: number }[] {
  const resolved = resolveSequence(st);
  if (!resolved) {
    return st.trajectory.events.map((event) => ({ name: event.name, t: event.t + st.startDelayS }));
  }
  return resolved.flatMap((segment) =>
    segment.trajectory.events.map((event) => ({ name: event.name, t: segment.startS + event.t })),
  );
}

export interface SequenceJoinIssue {
  /** 0-based index of the segment before the seam. */
  fromIndex: number;
  /** Global-clock time of the seam (end of the earlier segment). */
  seamT: number;
  kind: 'position' | 'heading' | 'velocity';
  /** Measured delta, always reported: meters, degrees, m·s⁻¹. */
  delta: number;
}

function firstSample(trajectory: Trajectory): TrajectorySample | undefined {
  return trajectory.samples[0];
}
function lastSample(trajectory: Trajectory): TrajectorySample | undefined {
  return trajectory.samples[trajectory.samples.length - 1];
}

/**
 * Seam continuity between consecutive segments: position gap, heading gap
 * and speed jump are measured and reported whenever they exceed the grading
 * tolerances. A seam that matches on all three (including two routes that
 * genuinely continue mid-motion) produces no issues. Grading only — the
 * measured values, not an "executable" verdict, are what the user sees.
 */
export function checkSequenceJoins(
  st: SessionTrajectory,
  opts: SequenceJoinOptions = {},
): SequenceJoinIssue[] {
  const resolved = resolveSequence(st);
  if (!resolved || resolved.length < 2) return [];
  const positionTol = opts.positionTolM ?? SEQUENCE_JOIN_TOLERANCES.positionM;
  const headingTol = opts.headingTolDeg ?? SEQUENCE_JOIN_TOLERANCES.headingDeg;
  const speedTol = opts.speedJumpTolMps ?? SEQUENCE_JOIN_TOLERANCES.speedJumpMps;
  const issues: SequenceJoinIssue[] = [];
  for (let i = 0; i + 1 < resolved.length; i++) {
    const endState = lastSample(resolved[i]!.trajectory);
    const startState = firstSample(resolved[i + 1]!.trajectory);
    if (!endState || !startState) continue;
    const gapM = Math.hypot(startState.x - endState.x, startState.y - endState.y);
    const gapDeg = Math.abs(wrapAngle(startState.heading - endState.heading)) * RAD_TO_DEG;
    const speedJump = Math.abs(
      Math.hypot(startState.vx, startState.vy) - Math.hypot(endState.vx, endState.vy),
    );
    const seamT = resolved[i]!.endS;
    if (gapM > positionTol) issues.push({ fromIndex: i, seamT, kind: 'position', delta: gapM });
    if (gapDeg > headingTol) issues.push({ fromIndex: i, seamT, kind: 'heading', delta: gapDeg });
    if (speedJump > speedTol) issues.push({ fromIndex: i, seamT, kind: 'velocity', delta: speedJump });
  }
  return issues;
}

export interface SequenceTimingIssue {
  finishS: number;
  autoPeriodS: number;
}

/**
 * Waiting feasibility: the composition's finish time has to fit the season's
 * Autonomous Period (FieldPackage.autoPeriodS) — a plan that ends after the
 * auto has ended cannot run as arranged. Report-only; the user re-times the
 * waits or goes back to the source tools.
 */
export function checkSequenceTiming(
  st: SessionTrajectory,
  autoPeriodS: number,
): SequenceTimingIssue | undefined {
  const resolved = resolveSequence(st);
  if (!resolved) return undefined;
  const finishS = resolved[resolved.length - 1]!.endS;
  return finishS > autoPeriodS + 1e-6 ? { finishS, autoPeriodS } : undefined;
}
