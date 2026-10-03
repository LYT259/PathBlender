/**
 * Session layer: trajectories on the unified autonomous clock.
 * Global t=0 is the start of the autonomous period; each robot may carry a
 * start delay (what-if adjustment that never mutates the parsed file).
 */

import type { Pose2d, RobotGeometry, Trajectory, TrajectorySample } from './types';
import { sampleTrajectory } from './math';
import { makeCustomField } from './field';

export interface SessionTrajectory {
  trajectory: Trajectory;
  /** Seconds after auto start when this robot begins moving. */
  startDelayS: number;
  /** UI display color; persisted in session files. */
  color: string;
  visible: boolean;
  /**
   * Route-library id of the trajectory this robot currently shows, when it
   * came from (or was switched to) an imported library route. Session-layer
   * concern only — survives undo/redo with the robot, inert when the library
   * it points at is gone (restored sessions start with an empty library).
   */
  routeId?: string;
}

/** Palette mirroring the 103 fork's ghost colors (community-familiar). */
export const SESSION_COLORS = [
  '#FF6EC7', '#00E5FF', '#AAFF00', '#FF9100', '#E040FB',
  '#00E676', '#FF5252', '#40C4FF', '#FFD740', '#7C4DFF',
];

export function makeSession(traj: Trajectory, colorIndex = 0): SessionTrajectory {
  return {
    trajectory: traj,
    startDelayS: 0,
    color: SESSION_COLORS[colorIndex % SESSION_COLORS.length] as string,
    visible: true,
  };
}

/**
 * Robot pose on the global clock: parked at the first state before its
 * start delay, clamped to the last state after the trajectory ends.
 */
export function samplePoseAt(st: SessionTrajectory, globalT: number): Pose2d {
  const localT = globalT - st.startDelayS;
  const s = sampleTrajectory(st.trajectory.samples, localT);
  if (!s) return { x: 0, y: 0, heading: 0 };
  return { x: s.x, y: s.y, heading: s.heading };
}

/**
 * Full interpolated state (pose + velocities) on the global clock —
 * same clamping semantics as samplePoseAt. The MK5i wheel-steering
 * rendering needs each robot's vx/vy/ω, not just the pose. Returns
 * undefined for trajectories with no samples.
 */
export function sampleStateAt(st: SessionTrajectory, globalT: number): TrajectorySample | undefined {
  return sampleTrajectory(st.trajectory.samples, globalT - st.startDelayS);
}

export function activeStartT(st: SessionTrajectory): number {
  return st.startDelayS;
}

export function activeEndT(st: SessionTrajectory): number {
  return st.startDelayS + st.trajectory.durationS;
}

export function sessionDuration(sts: readonly SessionTrajectory[]): number {
  return sts.reduce((m, st) => Math.max(m, activeEndT(st)), 0);
}

export function sessionGeometry(st: SessionTrajectory): RobotGeometry {
  return st.trajectory.geometry;
}

/* ------------------------------------------------------------------ */
/* Session file (v1): self-contained — stores unified samples so the   */
/* file restores without the original path files.                      */
/* ------------------------------------------------------------------ */

/** Marker written into every new session file. */
const APP_MARKER = 'pathblender';
/**
 * Marker of sessions saved before the 2026-10-03 rename; still accepted on
 * read so files already on disk keep opening (naming-is-contract).
 */
const LEGACY_APP_MARKER = 'ghpathblender';

export interface SessionFileV1 {
  app: typeof APP_MARKER;
  version: 1;
  fieldId: string;
  /** Custom-field calibration, present only for user-imported fields. */
  field?: {
    name?: string;
    lengthM: number;
    widthM: number;
    ppm: number;
    marginM: number;
    pixelWidth: number;
    pixelHeight: number;
    aprilTags?: import('./april-tags').AprilTag[];
  };
  savedAt: string;
  robots: Array<{
    name: string;
    teamName: string;
    /** Optional since v1.4; older session files simply lack it. */
    teamNumber?: string;
    source: Trajectory['source'];
    alliance: Trajectory['alliance'];
    startDelayS: number;
    color: string;
    visible: boolean;
    /** Route-library id when the robot's current route came from the library. */
    routeId?: string;
    geometry: RobotGeometry;
    geometrySource: Trajectory['geometrySource'];
    moduleLocations: Trajectory['moduleLocations'];
    events: Trajectory['events'];
    samples: Trajectory['samples'];
    /** Editable source data (v1.4 §6.3); absent when not editable. */
    editable?: Trajectory['editable'];
    edited?: boolean;
    original?: Trajectory['original'];
  }>;
}

export function serializeSession(
  sts: readonly SessionTrajectory[],
  fieldId: string,
  field?: import('./field').FieldPackage,
): string {
  const file: SessionFileV1 = {
    app: APP_MARKER,
    version: 1,
    fieldId,
    field:
      field && field.image
        ? {
            name: field.name,
            lengthM: field.lengthM,
            widthM: field.widthM,
            ppm: field.image.ppm,
            marginM: field.image.marginM,
            pixelWidth: field.image.pixelWidth,
            pixelHeight: field.image.pixelHeight,
            aprilTags: field.aprilTags,
          }
        : undefined,
    savedAt: new Date().toISOString(),
    robots: sts.map((st) => ({
      name: st.trajectory.name,
      teamName: st.trajectory.teamName,
      teamNumber: st.trajectory.teamNumber,
      source: st.trajectory.source,
      alliance: st.trajectory.alliance,
      startDelayS: st.startDelayS,
      color: st.color,
      visible: st.visible,
      routeId: st.routeId,
      geometry: st.trajectory.geometry,
      geometrySource: st.trajectory.geometrySource,
      moduleLocations: st.trajectory.moduleLocations,
      events: st.trajectory.events,
      samples: st.trajectory.samples,
      editable: st.trajectory.editable,
      edited: st.trajectory.edited,
      original: st.trajectory.original,
    })),
  };
  return JSON.stringify(file, null, 2);
}

export function deserializeSession(text: string): {
  fieldId: string;
  field?: import('./field').FieldPackage;
  robots: SessionTrajectory[];
} {
  const root = JSON.parse(text) as Record<string, unknown>;
  if ((root.app !== APP_MARKER && root.app !== LEGACY_APP_MARKER) || root.version !== 1) {
    throw new Error('not a PathBlender session file');
  }
  const v = root as unknown as SessionFileV1;
  const customField = v.field
    ? makeCustomField({
        name: v.field.name,
        lengthM: v.field.lengthM,
        widthM: v.field.widthM,
        ppm: v.field.ppm,
        marginM: v.field.marginM,
        pixelWidth: v.field.pixelWidth,
        pixelHeight: v.field.pixelHeight,
        aprilTags: v.field.aprilTags,
      })
    : undefined;
  const robots = v.robots.map((r) => {
    const traj: Trajectory = {
      id: crypto.randomUUID(),
      name: r.name,
      teamName: r.teamName,
      teamNumber: r.teamNumber ?? '',
      source: r.source,
      alliance: r.alliance,
      samples: r.samples,
      durationS:
        r.samples.length === 0
          ? 0
          : (r.samples[r.samples.length - 1] as Trajectory['samples'][number]).t,
      geometry: r.geometry,
      geometrySource: r.geometrySource,
      moduleLocations: r.moduleLocations,
      events: r.events,
      warnings: [],
      editable: r.editable,
      edited: r.edited,
      original: r.original,
    };
    return {
      trajectory: traj,
      startDelayS: r.startDelayS,
      color: r.color,
      visible: r.visible,
      routeId: r.routeId,
    } satisfies SessionTrajectory;
  });
  return { fieldId: v.fieldId, field: customField, robots };
}
