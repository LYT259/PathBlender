/**
 * Unified internal trajectory model.
 *
 * Architecture invariant (AGENTS.md): every external format converts into
 * these types at the parse boundary; rendering and collision detection only
 * ever consume this model. No format-specific fields leak through.
 *
 * Units: meters, seconds, radians. World frame: WPILib blue-origin
 * convention — origin at the blue alliance corner, +x toward the red wall,
 * +y to the left when facing the red wall. Red-alliance files are flipped
 * into this frame at import time (see field.ts).
 */

export interface Pose2d {
  x: number;
  y: number;
  heading: number;
}

/** One time-sampled state of a trajectory. */
export interface TrajectorySample {
  /** Seconds since this robot starts moving (its own clock, t=0 at start). */
  t: number;
  x: number;
  y: number;
  /** Robot heading in world frame (for differential drives, path heading). */
  heading: number;
  /** Field-frame linear velocity; vy is always 0 for differential drives. */
  vx: number;
  vy: number;
  omega: number;
}

/** Bumper rectangle, the collision-relevant robot geometry. */
export interface RobotGeometry {
  /** Bumper length along the robot's +x (forward) axis. */
  lengthM: number;
  /** Bumper width along the robot's +y (left) axis. */
  widthM: number;
  /** Bumper-box center offset in the robot frame. */
  offsetX: number;
  offsetY: number;
}

export const DEFAULT_GEOMETRY: RobotGeometry = {
  // Placeholder baked by parsers when the file carries no size — the
  // 2025 rule-max profile (R104 120 in perimeter → 30 in square frame,
  // R403 4 in bumper → 38 in = 0.9652 m outer). The UI re-resolves
  // default-geometry robots per selected season at consumption time
  // (seasonRobotProfile/withSeasonGeometry in robot-geometry.ts); this
  // constant is only what a session file round-trips before that.
  lengthM: 0.9652,
  widthM: 0.9652,
  offsetX: 0,
  offsetY: 0,
};

export type Alliance = 'blue' | 'red';

export type TrajectorySource =
  | 'choreo-traj'
  | 'ghostauto'
  | 'pathplanner-path'
  | 'pathplanner-auto';

/** A named marker attached to a trajectory time (Choreo events etc.). */
export interface TrajectoryEvent {
  name: string;
  t: number;
}

export interface ModuleLocation {
  x: number;
  y: number;
}

/**
 * A parsed trajectory, already normalized into the blue world frame.
 * `alliance` records where the file came from (user-set at import);
 * samples are always blue-frame regardless of alliance.
 */
export interface Trajectory {
  id: string;
  name: string;
  teamName: string;
  /**
   * Team number for on-field annotation, e.g. "0001". Data-source layering
   * (report §7.3-5): carried by `.ghostauto` (extracted from teamName) >
   * empty for formats without it > user-editable on the robot card.
   */
  teamNumber: string;
  source: TrajectorySource;
  alliance: Alliance;
  samples: TrajectorySample[];
  /** Last sample time in seconds (0 when samples is empty). */
  durationS: number;
  geometry: RobotGeometry;
  geometrySource: 'file' | 'default';
  moduleLocations: ModuleLocation[];
  events: TrajectoryEvent[];
  /** Non-fatal parser warnings surfaced to the user. */
  warnings: string[];
  /**
   * Editable source data for conflict-mediation edits (report v1.4 §6.3);
   * undefined for formats without geometric waypoints (.ghostauto).
   */
  editable?: import('./editing').EditablePath;
  /** True once any meditation edit has been applied (derived copy). */
  edited?: boolean;
  /** Snapshot of the pre-edit state, taken on the first edit (reset source). */
  original?: {
    editable: import('./editing').EditablePath;
    samples: TrajectorySample[];
    events: TrajectoryEvent[];
    warnings: string[];
    durationS: number;
  };
}

/**
 * Extract an FRC team number from a free-form name or file stem, '' if none.
 *
 * Only digit runs of 3–5 digits count as a team number (report v1.17 §6.1,
 * user directive 2026-09-12): waypoint-style numbering used to win the guess
 * — `L1.traj`, `v3_swerve.traj`, `v11.traj` all returned a bogus team. The
 * cost, accepted in the same directive: 1–2 digit legacy teams (33, 67) are
 * no longer inferred and fall back to the manual field on the robot card.
 * A run longer than 5 digits (a timestamp, a version string) is not a team
 * number either, and the scan continues to the next run.
 */
export function teamNumberFromName(teamName: string): string {
  for (const run of teamName.trim().match(/\d+/g) ?? []) {
    if (run.length >= 3 && run.length <= 5) return run;
  }
  return '';
}

export function trajectoryDuration(samples: TrajectorySample[]): number {
  return samples.length === 0 ? 0 : (samples[samples.length - 1] as TrajectorySample).t;
}
