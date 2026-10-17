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
import { startsInAllianceZone, type FieldPackage, type StartZoneRect } from './field';

export interface AutoSequenceSegment {
  id: string;
  /** Route-library id; resolved through the robot's own routeOptions. */
  routeId: string;
  /** Wait before this segment starts — seconds after the previous segment ends. */
  waitBeforeS: number;
  /**
   * Movement seconds actually played from the route (user 2026-10-08):
   * a leg dropped where less auto time remained than the route needs runs
   * "as far as it can" — the first `playS` seconds — and the robot then
   * parks at that mid-route state. Absent or ≥ the route duration means
   * the whole route plays. Optional, so existing sessions and files
   * (which always play routes whole) read unchanged.
   */
  playS?: number;
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
 * Effective movement seconds for a segment: `playS` when it genuinely
 * truncates the route (finite, > 0, shorter than the route), else the whole
 * route duration. Single source for both the resolver and the editor's
 * presentation arithmetic, so the timeline and the sampler can't disagree.
 */
export function segmentDurationS(segment: { playS?: number }, trajectory: Trajectory): number {
  return segment.playS !== undefined && Number.isFinite(segment.playS) && segment.playS > 0
    ? Math.min(segment.playS, trajectory.durationS)
    : trajectory.durationS;
}

/**
 * The first `playS` seconds of a trajectory as a standalone view: samples
 * up to the cut (an exact interpolated boundary sample appended so the cut
 * pose/velocity is bit-honest), events that happen within it, and a matching
 * duration. Sampling, seam grading and parked poses downstream all read the
 * truncated view — nothing invents motion past the cut.
 */
function truncateTrajectory(trajectory: Trajectory, playS: number): Trajectory {
  const within = trajectory.samples.filter((sample) => sample.t <= playS);
  const boundary = sampleTrajectory(trajectory.samples, playS);
  const samples = boundary && (!within.length || within.at(-1)!.t < playS)
    ? [...within, { ...boundary, t: playS }]
    : within;
  return {
    ...trajectory,
    samples,
    durationS: playS,
    events: trajectory.events.filter((event) => event.t <= playS),
  };
}

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
  if (!sequence) return undefined;
  const options = st.routeOptions ?? [];
  let endS = 0;
  const resolved: ResolvedSequenceSegment[] = [];
  for (const segment of sequence.segments) {
    const wait = Number.isFinite(segment.waitBeforeS) ? Math.max(0, segment.waitBeforeS) : 0;
    const startS = endS + wait;
    const option = options.find((candidate) => candidate.id === segment.routeId);
    const whole = option?.trajectory ?? st.trajectory;
    const playS = segmentDurationS(segment, whole);
    // A truncated segment resolves to the first `playS` seconds as its own
    // trajectory, so every consumer (sampler, seam grading, parked pose,
    // event mapping) sees the same honest cut without re-implementing it.
    const trajectory = playS < whole.durationS ? truncateTrajectory(whole, playS) : whole;
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
  if (resolved.length === 0) return parked(poseOrOrigin(st.trajectory, false));
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

export interface RouteContinuity {
  /** Whether `next` may follow `prev`: both pose gaps within the join tolerances. */
  connects: boolean;
  /** Measured start-to-end pose gap, meters. */
  positionGapM: number;
  /** Measured start-to-end heading gap, degrees. */
  headingGapDeg: number;
}

/**
 * Library gating answers "can the robot physically drive there", not "is the
 * seam flawless" — the seam badges grade that separately at the strict
 * SEQUENCE_JOIN_TOLERANCES. Real Choreo hand-chained legs leave cm-scale
 * gaps: across both bundled example libraries every genuinely chained pair
 * measures 0.003–0.077 m at ≤1°, while different-spot starts begin at
 * 0.164 m (L14→L3) / 11.3° (L13→M2) — and an 18-in same-heading pair
 * (L2→L12, 0.459 m at 0.2°) would slip through a 0.5 m gate. 6 in / 5°
 * (user decision 2026-10-08) admits every measured chain with ~2× headroom
 * and refuses every measured different-spot pair on at least one axis.
 */
export const LIBRARY_CHAIN_TOLERANCES = {
  positionTolM: 0.1524,
  headingTolDeg: 5,
} as const;

/**
 * Pose continuity for the composer's route library: can `next` physically
 * follow `prev` — does its first sample sit where `prev`'s last sample left
 * the robot? Callers gate the library with LIBRARY_CHAIN_TOLERANCES (drive-
 * able, above) and grade the seam itself at SEQUENCE_JOIN_TOLERANCES
 * (flawless); a route the library accepts may still seam with a reported
 * gap. The speed jump is deliberately NOT part of the verdict: a wait parks
 * the robot at zero velocity, so a speed difference is honest to report on
 * the seam but not a reason to refuse the route. Trajectories without
 * samples carry no measurable pose and are never gated.
 */
export function routeConnectsAfter(
  prev: Trajectory,
  next: Trajectory,
  opts: SequenceJoinOptions = {},
): RouteContinuity {
  const endState = lastSample(prev);
  const startState = firstSample(next);
  if (!endState || !startState) return { connects: true, positionGapM: 0, headingGapDeg: 0 };
  const positionGapM = Math.hypot(startState.x - endState.x, startState.y - endState.y);
  const headingGapDeg = Math.abs(wrapAngle(startState.heading - endState.heading)) * RAD_TO_DEG;
  return {
    connects: positionGapM <= (opts.positionTolM ?? SEQUENCE_JOIN_TOLERANCES.positionM)
      && headingGapDeg <= (opts.headingTolDeg ?? SEQUENCE_JOIN_TOLERANCES.headingDeg),
    positionGapM,
    headingGapDeg,
  };
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
  if (!resolved || resolved.length === 0) return undefined;
  const finishS = resolved[resolved.length - 1]!.endS;
  return finishS > autoPeriodS + 1e-6 ? { finishS, autoPeriodS } : undefined;
}

/**
 * Whether the robot's driven path STARTS inside the season's legal starting
 * region — the field-view twin of the composer's first-leg gate (user
 * 2026-10-09: a path that starts outside the zone renders gray on the
 * field). For a composed robot only the FIRST segment's first sample
 * decides: later legs start wherever the previous one ended, which is
 * continuation, not an illegal start. A legacy robot is its single route.
 * Undefined zone = the season has no established starting region → ungated.
 */
export function sessionStartsInZone(
  st: SessionTrajectory,
  zone: readonly StartZoneRect[] | undefined,
  field?: Pick<FieldPackage, 'lengthM' | 'widthM'>,
): boolean {
  if (!zone) return true;
  const first = resolveSequence(st)?.[0]?.trajectory ?? st.trajectory;
  return startsInAllianceZone(first, zone, field);
}
