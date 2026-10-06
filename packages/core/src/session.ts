/**
 * Session layer: trajectories on the unified autonomous clock.
 * Global t=0 is the start of the autonomous period; each robot may carry a
 * start delay (what-if adjustment that never mutates the parsed file).
 */

import type { Pose2d, RobotGeometry, Trajectory, TrajectorySample } from './types';
import { sampleTrajectory } from './math';
import { makeCustomField } from './field';
import type { RobotProfile } from './parsers/robot-profile';
import { resolveSequence, sampleSequenceState, type AutoSequence } from './auto-sequence';

export interface SessionRouteOption {
  id: string;
  relPath: string;
  trajectory: Trajectory;
}

export interface SessionProfileOption {
  id: string;
  relPath: string;
  profile: RobotProfile;
}

export interface SessionTrajectory {
  trajectory: Trajectory;
  /** Seconds after auto start when this robot begins moving. */
  startDelayS: number;
  /** UI display color; persisted in session files. */
  color: string;
  visible: boolean;
  /** Selected route inside this team's alternatives; older sessions may lack them. */
  routeId?: string;
  /**
   * This team's route/sequence is mirrored between the left/right trench
   * sides (user-approved per-team mirror, 2026-10-05). Stored on the slot,
   * applied in the alliance view derivation — the imported samples stay
   * untouched and the flag is an involution. New routes added to the team
   * inherit it because every view path reads the slot flag.
   */
  mirrored?: boolean;
  /** Alternatives belong to this team slot, including after save/restore. */
  routeOptions?: SessionRouteOption[];
  profileOptions?: SessionProfileOption[];
  /** Explicitly applied configuration, retained when switching routes. */
  profileId?: string;
  /**
   * Multi-segment composition (red book v1.38): the robot plays these routes
   * in order, with the first segment's wait acting as the start delay.
   * Absent = legacy single-route behavior with `startDelayS`. When present,
   * `startDelayS` mirrors the first segment's wait (kept in sync on write,
   * re-synced on session load) so consumers can keep reading either field.
   */
  sequence?: AutoSequence;
}

/** Muted gold, violet, and sage for the first three team slots; later slots retain the legacy ghost palette. */
export const SESSION_COLORS = [
  '#C5A16A', '#A28CBA', '#8FA482', '#FF9100', '#E040FB',
  '#00E676', '#FF5252', '#40C4FF', '#FFD740', '#7C4DFF',
];

/**
 * First three defaults before the muted palette (2026-10-05), remapped on
 * session read: restored sessions then match freshly assigned colors, and
 * the colorblind remap recognizes them again (the old values left the
 * default palette, so it passed them through untouched). Matching is by
 * value, not slot — a robot that joined as slot 3 keeps its slot-3 hue. A
 * custom color that happened to equal a former default is remapped too:
 * session files cannot distinguish the two (the same limitation the
 * colorblind remap already documents). Matching tolerates case — the
 * serializer always writes uppercase, hand-edited files may not.
 */
const LEGACY_DEFAULT_COLORS: Record<string, string> = {
  '#FF6EC7': '#C5A16A',
  '#00E5FF': '#A28CBA',
  '#AAFF00': '#8FA482',
};

/**
 * Colorblind-safe palette (Okabe-Ito, the canonical CVD-safe set) for the
 * settings toggle (§7.3-3 trigger track, landed 2026-10-04). Eight colors;
 * palette indices ≥8 wrap onto 0–1, so a 9–10 robot session shares two
 * colors while enabled — toggling back restores the wrapped slots to the
 * slot they wrapped onto (documented lossy round trip, harmless in the
 * 6-robot match case the toggle targets). Remap only touches default-
 * palette colors: custom/user colors pass through untouched.
 */
export const COLORBLIND_COLORS = [
  '#0072B2', '#E69F00', '#009E73', '#CC79A7',
  '#56B4E9', '#D55E00', '#F0E442', '#882255',
];

export function remapColorblind(color: string, enabled: boolean): string {
  const from = enabled ? SESSION_COLORS : COLORBLIND_COLORS;
  const to = enabled ? COLORBLIND_COLORS : SESSION_COLORS;
  const i = from.indexOf(color);
  return i >= 0 ? (to[i % to.length] as string) : color;
}

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
 * start delay, clamped to the last state after the trajectory ends. A
 * composed robot samples through its sequence — parked (zero velocity) at
 * the previous segment's end during waits, never interpolated across a
 * gap between segments.
 */
export function samplePoseAt(st: SessionTrajectory, globalT: number): Pose2d {
  if (st.sequence) {
    const s = sampleSequenceState(st, globalT);
    if (s) return { x: s.x, y: s.y, heading: s.heading };
  }
  const localT = globalT - st.startDelayS;
  const s = sampleTrajectory(st.trajectory.samples, localT);
  if (!s) return { x: 0, y: 0, heading: 0 };
  return { x: s.x, y: s.y, heading: s.heading };
}

/**
 * Full interpolated state (pose + velocities) on the global clock —
 * same clamping semantics as samplePoseAt. The MK5i wheel-steering
 * rendering needs each robot's vx/vy/ω, not just the pose. Returns
 * undefined for legacy trajectories with no samples. Waiting/parked states of a composed
 * robot report zero velocity.
 */
export function sampleStateAt(st: SessionTrajectory, globalT: number): TrajectorySample | undefined {
  if (st.sequence) {
    return sampleSequenceState(st, globalT)
      ?? sampleTrajectory(st.trajectory.samples, globalT - st.startDelayS);
  }
  return sampleTrajectory(st.trajectory.samples, globalT - st.startDelayS);
}

export function activeStartT(st: SessionTrajectory): number {
  const resolved = resolveSequence(st);
  if (resolved) return resolved[0]?.startS ?? 0;
  return st.startDelayS;
}

export function activeEndT(st: SessionTrajectory): number {
  const resolved = resolveSequence(st);
  if (resolved) return resolved[resolved.length - 1]?.endS ?? 0;
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
    /** Stable trajectory id, kept across save/load (v1.6+); older files lack it. */
    id?: string;
    name: string;
    teamName: string;
    /** Optional since v1.4; older session files simply lack it. */
    teamNumber?: string;
    displayName?: string;
    source: Trajectory['source'];
    alliance: Trajectory['alliance'];
    startDelayS: number;
    color: string;
    visible: boolean;
    /** Route-library id when the robot's current route came from the library. */
    routeId?: string;
    /** Per-team left/right mirror (optional since 2026-10-05; absent = off). */
    mirrored?: boolean;
    routeOptions?: SessionRouteOption[];
    profileOptions?: SessionProfileOption[];
    profileId?: string;
    geometry: RobotGeometry;
    geometrySource: Trajectory['geometrySource'];
    moduleLocations: Trajectory['moduleLocations'];
    events: Trajectory['events'];
    samples: Trajectory['samples'];
    /** Robot mass when known from a profile/file; optional since v1.7 files. */
    massKG?: Trajectory['massKG'];
    /** Drive mode when known from a profile; optional since v1.7 files. */
    holonomic?: Trajectory['holonomic'];
    /** Editable source data (v1.4 §6.3); absent when not editable. */
    editable?: Trajectory['editable'];
    edited?: boolean;
    original?: Trajectory['original'];
    /**
     * Multi-segment composition (added 2026-10-04, still v1: optional so
     * every session file saved before it keeps opening unchanged).
     */
    sequence?: AutoSequence;
  }>;
}

/**
 * Output shaping for `serializeSession`. Both options default to what the
 * shareable `.pb` file has always been, so existing callers are unchanged.
 */
export interface SessionSerializeOptions {
  /** Two-space indent (the shipped-file shape) or compact text. */
  pretty?: boolean;
  /** Leave a robot's route library out — the autosave slot uses this for
   * libraries the restore path regenerates anyway, and as a quota fallback. */
  omitRouteOptions?: (st: SessionTrajectory) => boolean;
}

export function serializeSession(
  sts: readonly SessionTrajectory[],
  fieldId: string,
  field?: import('./field').FieldPackage,
  options: SessionSerializeOptions = {},
): string {
  const pretty = options.pretty !== false;
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
      id: st.trajectory.id,
      name: st.trajectory.name,
      teamName: st.trajectory.teamName,
      teamNumber: st.trajectory.teamNumber,
      displayName: st.trajectory.displayName,
      source: st.trajectory.source,
      alliance: st.trajectory.alliance,
      // The sequence's first wait is the start delay; write both so files
      // stay self-consistent even if a consumer only ever reads one field.
      startDelayS: st.sequence && st.sequence.segments.length > 0
        ? Math.max(0, st.sequence.segments[0]!.waitBeforeS)
        : st.startDelayS,
      color: st.color,
      visible: st.visible,
      routeId: st.routeId,
      mirrored: st.mirrored === true ? true : undefined,
      // `undefined` drops the key from the JSON entirely.
      routeOptions: options.omitRouteOptions?.(st) ? undefined : st.routeOptions,
      profileOptions: st.profileOptions,
      profileId: st.profileId,
      sequence: st.sequence,
      geometry: st.trajectory.geometry,
      geometrySource: st.trajectory.geometrySource,
      moduleLocations: st.trajectory.moduleLocations,
      events: st.trajectory.events,
      samples: st.trajectory.samples,
      massKG: st.trajectory.massKG,
      holonomic: st.trajectory.holonomic,
      editable: st.trajectory.editable,
      edited: st.trajectory.edited,
      original: st.trajectory.original,
    })),
  };
  return JSON.stringify(file, null, pretty ? 2 : 0);
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
    const sequence = readSequence(r.sequence);
    const traj: Trajectory = {
      id: r.id ?? crypto.randomUUID(),
      name: r.name,
      teamName: r.teamName,
      teamNumber: r.teamNumber ?? '',
      displayName: typeof r.displayName === 'string' ? r.displayName : undefined,
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
      massKG: typeof r.massKG === 'number' && Number.isFinite(r.massKG) ? r.massKG : undefined,
      holonomic: typeof r.holonomic === 'boolean' ? r.holonomic : undefined,
      editable: r.editable,
      edited: r.edited,
      original: r.original,
    };
    return {
      trajectory: traj,
      startDelayS: sequence ? Math.max(0, sequence.segments[0]?.waitBeforeS ?? 0) : r.startDelayS,
      color: typeof r.color === 'string' ? (LEGACY_DEFAULT_COLORS[r.color.toUpperCase()] ?? r.color) : r.color,
      visible: r.visible,
      routeId: r.routeId,
      mirrored: r.mirrored === true ? true : undefined,
      routeOptions: readRouteOptions(r.routeOptions),
      profileOptions: readProfileOptions(r.profileOptions),
      profileId: typeof r.profileId === 'string' ? r.profileId : undefined,
      sequence,
    } satisfies SessionTrajectory;
  });
  return { fieldId: v.fieldId, field: customField, robots };
}

function validGeometry(value: RobotGeometry | undefined): boolean {
  return !!value && Number.isFinite(value.lengthM) && value.lengthM > 0 &&
    Number.isFinite(value.widthM) && value.widthM > 0 &&
    Number.isFinite(value.offsetX) && Number.isFinite(value.offsetY);
}

function readSequence(value: AutoSequence | undefined): AutoSequence | undefined {
  if (value === undefined) return undefined;
  const segments = value?.segments;
  if (!Array.isArray(segments)) return undefined;
  if (segments.some((segment) => !segment || typeof segment.id !== 'string' || typeof segment.routeId !== 'string')) {
    throw new Error('invalid auto sequence');
  }
  // Numeric damage self-heals: non-finite or negative waits clamp to zero
  // instead of bricking the whole session file.
  return {
    segments: segments.map((segment) => ({
      ...segment,
      waitBeforeS: Number.isFinite(segment.waitBeforeS) ? Math.max(0, segment.waitBeforeS) : 0,
    })),
  };
}

function readRouteOptions(value: SessionRouteOption[] | undefined): SessionRouteOption[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((option) => {
    const t = option?.trajectory;
    return typeof option?.id !== 'string' || typeof option.relPath !== 'string' ||
      !t || !['id', 'name', 'teamName', 'teamNumber'].every((key) => typeof t[key as keyof Trajectory] === 'string') ||
      !['choreo-traj', 'ghostauto', 'pathplanner-path', 'pathplanner-auto'].includes(t.source) ||
      !['blue', 'red'].includes(t.alliance) || !['file', 'default'].includes(t.geometrySource) ||
      !validGeometry(t.geometry) || !Array.isArray(t.moduleLocations) || t.moduleLocations.some((m) =>
        !m || !Number.isFinite(m.x) || !Number.isFinite(m.y)) ||
      !Array.isArray(t.events) || t.events.some((e) => !e || typeof e.name !== 'string' || !Number.isFinite(e.t)) ||
      !Array.isArray(t.warnings) || t.warnings.some((w) => typeof w !== 'string') ||
      !Number.isFinite(t.durationS) || t.durationS < 0 || !Array.isArray(t.samples) ||
      t.samples.length === 0 || t.samples.some((sample, index) => !sample ||
        !['t', 'x', 'y', 'heading', 'vx', 'vy', 'omega'].every((key) => Number.isFinite(sample[key as keyof typeof sample])) ||
        (index > 0 && sample.t < t.samples[index - 1]!.t));
  })) throw new Error('invalid team route options');
  return value;
}

function readProfileOptions(value: SessionProfileOption[] | undefined): SessionProfileOption[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((option) => typeof option?.id !== 'string' ||
    typeof option.relPath !== 'string' || !option.profile || typeof option.profile.name !== 'string' || !validGeometry(option.profile.geometry) ||
    !Array.isArray(option.profile.moduleLocations) || option.profile.moduleLocations.some((m) =>
      !m || !Number.isFinite(m.x) || !Number.isFinite(m.y)))) throw new Error('invalid team profile options');
  return value;
}
