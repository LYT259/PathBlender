/**
 * WPILOG extraction: a user's selection (pose source + auto interval +
 * units) becomes one unified Trajectory.
 *
 * Time semantics: t=0 is the selected interval's start — never the file
 * start and never the first movement. Waits and pauses inside the interval
 * survive as real time. Data gaps and pose resets/jumps are marked as
 * `gaps` on the trajectory; nothing interpolates across them, and a gap
 * bracketed by identical poses collapses into a hold ("value unchanged so
 * nothing was logged" is data, not a dropout). Velocities are derived by
 * finite differences for display/wheel rendering only — they never retime
 * anything.
 */

import type { Trajectory, TrajectorySample } from '../../types';
import { DEFAULT_GEOMETRY } from '../../types';
import { teamNumberFromName } from '../../types';
import { ParseError } from '../parse-error';
import type { WpilogCatalog } from './container';
import { scanWpilogRecords } from './container';
import type { WpilogInspection } from './inspect';
import { decodePrimitive } from './inspect';

export type LengthUnit = 'm' | 'cm' | 'in' | 'ft';
export type HeadingUnit = 'rad' | 'deg';

export const LENGTH_TO_M: Record<LengthUnit, number> = {
  m: 1,
  cm: 0.01,
  in: 0.0254,
  ft: 0.3048,
};

export const HEADING_TO_RAD: Record<HeadingUnit, number> = {
  rad: 1,
  deg: Math.PI / 180,
};

/** Which entry provides the pose, and how to read it. */
export type WpilogPoseSelection =
  | {
      mode: 'candidate';
      /** From WpilogInspection.candidates[].entryId. */
      entryId: number;
      /** Element index inside array records (0 = first/robot slot). */
      elementIndex: number;
    }
  | {
      /** Custom field mapping: separate numeric entries for x/y/θ. */
      mode: 'fields';
      xEntryId: number;
      yEntryId: number;
      headingEntryId?: number;
    };

export interface WpilogExtractionSelection {
  pose: WpilogPoseSelection;
  /** Index into inspection.autoIntervals, or an explicit range. */
  interval: { mode: 'auto'; index: number } | { mode: 'manual'; startS: number; endS: number };
  /** Units for numeric-array / custom-mapping sources (schemas are m/rad). */
  lengthUnit: LengthUnit;
  headingUnit: HeadingUnit;
  /**
   * Frame the log recorded in. WPILib convention is the blue-origin field
   * frame regardless of alliance, so 'blue' (default) keeps samples as
   * recorded; 'red' flips each pose exactly once for loggers that wrote
   * red-origin coordinates. Alliance membership is NOT a frame.
   */
  frameOrigin?: 'blue' | 'red';
  /** Field dimensions for the red→blue flip; required when frameOrigin='red'. */
  field?: { lengthM: number; widthM: number };
  /** Robot identity from the dialog. */
  name: string;
}

export interface TrajectoryGap {
  /** Start/end on the trajectory's own clock (seconds). */
  startT: number;
  endT: number;
  kind: 'gap' | 'jump';
}

/** Pose reading pulled out of one record. */
interface RawPose {
  timestampUs: number;
  x: number;
  y: number;
  headingRad: number | null;
}

/** A pose record whose heading is missing entirely. */
const GAP_HOLD_POSITION_EPS_M = 0.005;
const GAP_HOLD_HEADING_EPS_RAD = 0.5 * Math.PI / 180;

function decodeCandidatePoses(
  bytes: Uint8Array,
  catalog: WpilogCatalog,
  inspection: WpilogInspection,
  entryId: number,
  elementIndex: number,
  lengthUnit: LengthUnit,
  headingUnit: HeadingUnit,
  warnings: string[],
): RawPose[] {
  const entry = catalog.byId.get(entryId);
  if (!entry) throw new ParseError('invalid-wpilog', inspection.fileName, `entry ${entryId} vanished`);
  const lengthFactor = LENGTH_TO_M[lengthUnit];
  const headingFactor = HEADING_TO_RAD[headingUnit];
  const raw: RawPose[] = [];
  const push = (timestampUs: number, x: number, y: number, heading: number | null) => {
    raw.push({
      timestampUs,
      x: x * lengthFactor,
      y: y * lengthFactor,
      headingRad: heading === null ? null : heading * headingFactor,
    });
  };

  if (/^struct:.+(\[\])?$/.test(entry.type)) {
    const isArray = entry.type.endsWith('[]');
    const shortName = isArray
      ? entry.type.slice('struct:'.length, -2)
      : entry.type.slice('struct:'.length);
    const layout = inspection.schemas.layouts.get(shortName);
    if (!layout || layout.sizeBytes <= 0) {
      throw new ParseError('invalid-wpilog', inspection.fileName, `no decodable schema for ${entry.type}`);
    }
    const offset = elementIndex * layout.sizeBytes;
    let skipped = 0;
    scanWpilogRecords(bytes, catalog.header.firstRecordOffset, {
      onStart: () => undefined,
      onFinish: () => undefined,
      onMetadata: () => undefined,
      onData: (record) => {
        if (record.entryId !== entryId) return;
        if (offset + layout.sizeBytes > record.payload.length) {
          skipped++;
          return;
        }
        const decoded = decodeStructForPose(inspection, shortName, record.payload.subarray(offset, offset + layout.sizeBytes));
        if (!decoded) {
          skipped++;
          return;
        }
        push(record.timestampUs, decoded.x, decoded.y, decoded.headingRad ?? null);
      },
    });
    if (skipped > 0) warnings.push(`${skipped} ${entry.name} records skipped (short or undecodable payload)`);
    return raw;
  }

  if (entry.type.startsWith('proto:')) {
    const descriptor = inspection.schemas.protos.get(entry.type);
    if (!descriptor) {
      throw new ParseError('invalid-wpilog', inspection.fileName, `no protobuf schema for ${entry.type}`);
    }
    const fd = parseFileDescriptor(descriptor);
    const messageName = entry.type.slice('proto:'.length);
    let skipped = 0;
    scanWpilogRecords(bytes, catalog.header.firstRecordOffset, {
      onStart: () => undefined,
      onFinish: () => undefined,
      onMetadata: () => undefined,
      onData: (record) => {
        if (record.entryId !== entryId) return;
        const decoded = decodeProtoPayload(record.payload, fd, messageName);
        const pose = decoded ? recognizePoseLoose(decoded) : null;
        if (!pose) {
          skipped++;
          return;
        }
        push(record.timestampUs, pose.x, pose.y, pose.headingRad ?? null);
      },
    });
    if (skipped > 0) warnings.push(`${skipped} ${entry.name} records skipped (undecodable payload)`);
    return raw;
  }

  if (entry.type === 'double[]' || entry.type === 'float[]') {
    const elem = entry.type === 'double[]' ? 8 : 4;
    let skipped = 0;
    scanWpilogRecords(bytes, catalog.header.firstRecordOffset, {
      onStart: () => undefined,
      onFinish: () => undefined,
      onMetadata: () => undefined,
      onData: (record) => {
        if (record.entryId !== entryId) return;
        if (record.payload.length < elem * 2 || record.payload.length % elem !== 0) {
          skipped++;
          return;
        }
        const values = decodePrimitive(entry.type, record.payload);
        if (!Array.isArray(values)) {
          skipped++;
          return;
        }
        const x = values[0];
        const y = values[1];
        const heading = values.length >= 3 && typeof values[2] === 'number' ? values[2] : null;
        if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) {
          skipped++;
          return;
        }
        push(record.timestampUs, x, y, heading !== null && Number.isFinite(heading) ? heading : null);
      },
    });
    if (skipped > 0) warnings.push(`${skipped} ${entry.name} records skipped (malformed array payload)`);
    return raw;
  }

  throw new ParseError('invalid-wpilog', inspection.fileName, `entry ${entry.name} is not a pose source`);
}

// Schema-shape decoding shared with the inspection pass.
import { decodeStructValue } from './struct';
import { decodeProtoPayload, parseFileDescriptor } from './protobuf';
import { recognizePose } from './inspect';

function decodeStructForPose(
  inspection: WpilogInspection,
  shortName: string,
  payload: Uint8Array,
): { x: number; y: number; headingRad?: number } | null {
  const layout = inspection.schemas.layouts.get(shortName);
  if (!layout) return null;
  const decoded = decodeStructValue(layout, payload, (name) => inspection.schemas.layouts.get(name));
  return decoded ? recognizePose(decoded) : null;
}

function recognizePoseLoose(value: unknown): { x: number; y: number; headingRad?: number } | null {
  return recognizePose(value as never);
}

/* ------------------------------------------------------------------ */
/* Custom field mapping                                                */
/* ------------------------------------------------------------------ */

function numericSeries(
  bytes: Uint8Array,
  catalog: WpilogCatalog,
  entryId: number,
): Array<{ tS: number; value: number }> {
  const entry = catalog.byId.get(entryId);
  if (!entry) return [];
  const out: Array<{ tS: number; value: number }> = [];
  scanWpilogRecords(bytes, catalog.header.firstRecordOffset, {
    onStart: () => undefined,
    onFinish: () => undefined,
    onMetadata: () => undefined,
    onData: (record) => {
      if (record.entryId !== entryId) return;
      const value = decodePrimitive(entry.type, record.payload);
      if (typeof value === 'number' && Number.isFinite(value)) {
        out.push({ tS: record.timestampUs / 1e6, value });
      } else if (typeof value === 'boolean') {
        out.push({ tS: record.timestampUs / 1e6, value: value ? 1 : 0 });
      }
    },
  });
  out.sort((a, b) => a.tS - b.tS);
  return out;
}

/**
 * Angular interpolation of a heading series at time t: the segment delta
 * takes the shortest arc, so 179°→−179° crosses ±180° instead of passing
 * through 0° (the acceptance report caught the plain-linear join). The
 * series is in SOURCE units — the wrap period is 360 for degrees and 2π
 * for radians, so a radians-based wrap on degree values would misfold.
 */
function seriesAngleAt(
  series: ReadonlyArray<{ tS: number; value: number }>,
  tS: number,
  period: number,
): number | null {
  const direct = seriesAt(series, tS);
  if (direct === null || series.length < 2) return direct;
  if (tS <= series[0]!.tS || tS >= series[series.length - 1]!.tS) return direct;
  let low = 1;
  let high = series.length - 1;
  while (low !== high) {
    const mid = Math.floor((low + high) / 2);
    if ((series[mid] as { tS: number }).tS < tS) low = mid + 1;
    else high = mid;
  }
  const b = series[low]!;
  const a = series[low - 1]!;
  const dt = b.tS - a.tS;
  if (dt <= 0) return b.value;
  let delta = (b.value - a.value) % period;
  if (delta > period / 2) delta -= period;
  if (delta < -period / 2) delta += period;
  const fraction = (tS - a.tS) / dt;
  return a.value + delta * fraction;
}

/** Linear interpolation of a step series at time t (clamped at the ends). */
function seriesAt(series: ReadonlyArray<{ tS: number; value: number }>, tS: number): number | null {
  if (series.length === 0) return null;
  if (tS <= series[0]!.tS) return series[0]!.value;
  const last = series[series.length - 1]!;
  if (tS >= last.tS) return last.value;
  let low = 1;
  let high = series.length - 1;
  while (low !== high) {
    const mid = Math.floor((low + high) / 2);
    if ((series[mid] as { tS: number }).tS < tS) low = mid + 1;
    else high = mid;
  }
  const b = series[low]!;
  const a = series[low - 1]!;
  const dt = b.tS - a.tS;
  if (dt <= 0) return b.value;
  return a.value + (b.value - a.value) * ((tS - a.tS) / dt);
}

/* ------------------------------------------------------------------ */
/* Series hygiene: sort, dedupe, gaps, jumps                          */
/* ------------------------------------------------------------------ */

export interface HygieneResult {
  samples: TrajectorySample[];
  gaps: TrajectoryGap[];
  warnings: string[];
}

/**
 * Convert windowed raw poses (relative seconds) into samples with gap
 * marks and derived velocities. A gap bracketed by an unchanged pose
 * collapses (a hold, not a dropout); a discontinuity too fast to be real
 * motion splits as a jump — the robot holds its last known pose across it.
 */
export function buildSamples(
  poses: ReadonlyArray<{ tS: number; x: number; y: number; headingRad: number | null }>,
  headingDefaultRad: number,
): HygieneResult {
  const warnings: string[] = [];
  // Sort by time (stable for equal stamps) and drop duplicate timestamps,
  // keeping the LAST written value — a later record is a correction.
  const sorted = [...poses].sort((a, b) => a.tS - b.tS);
  const cleaned: typeof sorted = [];
  let headingMissing = false;
  for (const pose of sorted) {
    if (cleaned.length > 0 && cleaned[cleaned.length - 1]!.tS === pose.tS) {
      cleaned[cleaned.length - 1] = pose;
    } else {
      cleaned.push(pose);
    }
    if (pose.headingRad === null) headingMissing = true;
  }
  if (headingMissing) {
    warnings.push('heading missing in some or all records — rendered as 0 until the first heading sample');
  }
  if (cleaned.length === 0) return { samples: [], gaps: [], warnings };

  // Gap threshold from the data: 20× the fastest real interval, clamped to
  // [0.25 s, 10 s]. The minimum (not the median) reflects the logging rate
  // even when the window holds just a handful of samples — a 3-sample
  // window's median would sit ON the gap and hide it.
  const dts: number[] = [];
  for (let i = 1; i < cleaned.length; i++) {
    const dt = cleaned[i]!.tS - cleaned[i - 1]!.tS;
    if (dt > 1e-9) dts.push(dt);
  }
  // Loop, not Math.min(...dts): the spread form throws RangeError once a
  // window holds ~125k samples — exactly the full-match 250 Hz pose logs
  // this import exists for.
  let fastest = 1;
  for (const dt of dts) if (dt < fastest) fastest = dt;
  const gapThresholdS = Math.min(10, Math.max(0.25, fastest * 20));
  const JUMP_DISTANCE_M = 0.75;
  const JUMP_SPEED_MPS = 12;

  type Built = { sample: TrajectorySample; nextGapKind?: 'gap' | 'jump' };
  const built: Built[] = [];
  const gaps: TrajectoryGap[] = [];
  let lastHeading = cleaned[0]!.headingRad ?? headingDefaultRad;
  for (let i = 0; i < cleaned.length; i++) {
    const pose = cleaned[i]!;
    const heading = pose.headingRad ?? lastHeading;
    lastHeading = heading;
    built.push({ sample: { t: pose.tS, x: pose.x, y: pose.y, heading, vx: 0, vy: 0, omega: 0 } });
    if (i === cleaned.length - 1) break;
    const next = cleaned[i + 1]!;
    const dt = next.tS - pose.tS;
    if (dt <= 0) continue;
    const distance = Math.hypot(next.x - pose.x, next.y - pose.y);
    const nextHeading = next.headingRad ?? lastHeading;
    const headingDelta = Math.abs(nextHeading - heading) > Math.PI
      ? Math.abs(nextHeading - heading) - 2 * Math.PI
      : nextHeading - heading;
    const held = distance <= GAP_HOLD_POSITION_EPS_M &&
      Math.abs(headingDelta) <= GAP_HOLD_HEADING_EPS_RAD;
    if (dt > gapThresholdS && !held) {
      gaps.push({ startT: pose.tS, endT: next.tS, kind: 'gap' });
      built[i]!.nextGapKind = 'gap';
    } else if (distance > JUMP_DISTANCE_M && distance / dt > JUMP_SPEED_MPS) {
      gaps.push({ startT: pose.tS, endT: next.tS, kind: 'jump' });
      built[i]!.nextGapKind = 'jump';
    }
  }

  // Centered finite differences within non-gapped neighborhoods; a sample
  // adjacent to a gap gets a one-sided difference, gap edges get zero.
  const samples = built.map((item) => item.sample);
  for (let i = 0; i < samples.length; i++) {
    const prevGap = i > 0 && built[i - 1]!.nextGapKind !== undefined;
    const nextGap = built[i]!.nextGapKind !== undefined;
    if (prevGap || nextGap) {
      const side = prevGap && i + 1 < samples.length && !nextGap ? i + 1 : i - 1;
      if (side >= 0 && side < samples.length) {
        oneSidedVelocity(samples, i, side);
      }
      continue;
    }
    if (i === 0 || i === samples.length - 1) {
      const side = i === 0 ? Math.min(1, samples.length - 1) : Math.max(0, samples.length - 2);
      oneSidedVelocity(samples, i, side);
      continue;
    }
    const a = samples[i - 1]!;
    const b = samples[i + 1]!;
    const dt = b.t - a.t;
    if (dt <= 1e-9) continue;
    const s = samples[i]!;
    s.vx = (b.x - a.x) / dt;
    s.vy = (b.y - a.y) / dt;
    const dh = shortestAngleDelta(a.heading, b.heading);
    s.omega = dh / dt;
  }
  return { samples, gaps, warnings };
}

function oneSidedVelocity(samples: TrajectorySample[], i: number, j: number): void {
  const a = samples[i]!;
  const b = samples[j]!;
  const dt = b.t - a.t;
  if (dt <= 1e-9) return;
  a.vx = (b.x - a.x) / dt;
  a.vy = (b.y - a.y) / dt;
  a.omega = shortestAngleDelta(a.heading, b.heading) / dt;
}

function shortestAngleDelta(from: number, to: number): number {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/* ------------------------------------------------------------------ */
/* Public extraction                                                   */
/* ------------------------------------------------------------------ */

function mapEntryPoses(
  bytes: Uint8Array,
  catalog: WpilogCatalog,
  xEntryId: number,
  yEntryId: number,
  headingEntryId: number | undefined,
  lengthUnit: LengthUnit,
  headingUnit: HeadingUnit,
  warnings: string[],
): RawPose[] {
  const xSeries = numericSeries(bytes, catalog, xEntryId);
  const ySeries = numericSeries(bytes, catalog, yEntryId);
  const hSeries = headingEntryId !== undefined ? numericSeries(bytes, catalog, headingEntryId) : [];
  if (xSeries.length === 0 || ySeries.length === 0) {
    warnings.push('custom mapping produced no samples — check the selected entries');
    return [];
  }
  warnings.push('custom field mapping aligns series by linear interpolation on the x entry timestamps');
  const lengthFactor = LENGTH_TO_M[lengthUnit];
  const headingFactor = HEADING_TO_RAD[headingUnit];
  // Sample on the denser of x/y; heading joins wherever it exists.
  const base = xSeries.length >= ySeries.length ? xSeries : ySeries;
  const out: RawPose[] = [];
  let lastHeading: number | null = null;
  for (const point of base) {
    const x = seriesAt(xSeries, point.tS);
    const y = seriesAt(ySeries, point.tS);
    if (x === null || y === null) continue;
    let heading: number | null = null;
    const h = hSeries.length > 0
      ? seriesAngleAt(hSeries, point.tS, headingUnit === 'deg' ? 360 : Math.PI * 2)
      : null;
    if (h !== null) {
      heading = h * headingFactor;
      lastHeading = heading;
    } else if (lastHeading !== null) {
      heading = lastHeading;
    }
    out.push({ timestampUs: point.tS * 1e6, x: x * lengthFactor, y: y * lengthFactor, headingRad: heading });
  }
  return out;
}

/**
 * Extract the trajectory a user selected from an inspection. The window
 * comes from a detected auto interval or a manual range; t=0 is the window
 * start. Gaps/jumps ride on the trajectory so no consumer can interpolate
 * across unknown motion.
 */
export function extractWpilogTrajectory(
  bytes: Uint8Array,
  inspection: WpilogInspection,
  selection: WpilogExtractionSelection,
): Trajectory {
  const catalog = inspection.catalog;
  const warnings = [...inspection.warnings];
  let startUs: number;
  let endUs: number;
  let intervalSource = 'manual range';
  if (selection.interval.mode === 'auto') {
    const interval = inspection.autoIntervals[selection.interval.index];
    if (!interval) {
      throw new ParseError('invalid-wpilog', inspection.fileName, `interval ${selection.interval.index} not found`);
    }
    startUs = interval.startUs;
    endUs = interval.endUs;
    intervalSource = interval.source;
  } else {
    startUs = inspection.firstTimestampUs + selection.interval.startS * 1e6;
    endUs = inspection.firstTimestampUs + selection.interval.endS * 1e6;
  }
  if (endUs <= startUs) {
    throw new ParseError('invalid-wpilog', inspection.fileName, 'selected interval is empty');
  }

  // Loop appends throughout: spread-of-array (`push(...items)`) throws
  // RangeError around 125k elements — full-match 250 Hz pose logs reach
  // that, and this import exists for real logs.
  const rawPoses: RawPose[] = [];
  if (selection.pose.mode === 'candidate') {
    for (const pose of decodeCandidatePoses(
      bytes, catalog, inspection, selection.pose.entryId, selection.pose.elementIndex,
      selection.lengthUnit, selection.headingUnit, warnings)) {
      rawPoses.push(pose);
    }
  } else {
    for (const pose of mapEntryPoses(
      bytes, catalog, selection.pose.xEntryId, selection.pose.yEntryId, selection.pose.headingEntryId,
      selection.lengthUnit, selection.headingUnit, warnings)) {
      rawPoses.push(pose);
    }
  }

  // Window + rebase to the interval clock.
  const windowed = rawPoses
    .filter((pose) => pose.timestampUs >= startUs && pose.timestampUs <= endUs)
    .map((pose) => ({ ...pose, tS: (pose.timestampUs - startUs) / 1e6 }));
  if (windowed.length === 0) {
    throw new ParseError(
      'invalid-wpilog',
      inspection.fileName,
      `no pose samples inside the ${intervalSource} window`,
    );
  }
  const firstKeptT = windowed[0]!.tS;
  if (firstKeptT > 0.1) {
    warnings.push(`first ${(firstKeptT).toFixed(2)} s of the interval have no pose coverage (held at the first known pose)`);
  }
  const lastKeptT = windowed[windowed.length - 1]!.tS;
  const intervalS = (endUs - startUs) / 1e6;
  if (lastKeptT < intervalS - 0.1) {
    warnings.push(`last ${(intervalS - lastKeptT).toFixed(2)} s of the interval have no pose coverage`);
  }

  const { samples, gaps, warnings: hygieneWarnings } = buildSamples(windowed, 0);
  warnings.push(...hygieneWarnings);
  let finalSamples = samples;
  if (selection.frameOrigin === 'red') {
    const field = selection.field;
    if (!field) {
      throw new ParseError('invalid-wpilog', inspection.fileName, 'red-frame flip requires field dimensions');
    }
    // One explicit flip into the blue frame: x→L−x, y→W−y, heading+π,
    // velocities negated — the same transform file formats get at import.
    finalSamples = samples.map((sample) => ({
      ...sample,
      x: field.lengthM - sample.x,
      y: field.widthM - sample.y,
      heading: sample.heading + Math.PI,
      vx: -sample.vx,
      vy: -sample.vy,
    }));
    warnings.push('log was recorded in a red-origin frame — poses flipped once into the blue frame');
  }
  for (const gap of gaps) {
    warnings.push(`${gap.kind === 'gap' ? 'data gap' : 'pose jump/reset'} ${(gap.endT - gap.startT).toFixed(2)} s at t=${gap.startT.toFixed(2)} s (robot held at last known pose)`);
  }

  const candidate = inspection.candidates.find((c) => c.entryId === (selection.pose.mode === 'candidate' ? selection.pose.entryId : -1));
  if (candidate?.likelyTarget) {
    warnings.push('entry name suggests a target/desired pose, not the measured robot pose');
  }

  const teamNumber = teamNumberFromName(selection.name);
  return {
    id: crypto.randomUUID(),
    name: selection.name,
    teamName: selection.name,
    teamNumber,
    source: 'wpilog',
    alliance: 'blue',
    samples: finalSamples,
    durationS: finalSamples.length === 0 ? 0 : finalSamples[finalSamples.length - 1]!.t,
    geometry: { ...DEFAULT_GEOMETRY },
    geometrySource: 'default',
    moduleLocations: [],
    events: gaps.map((gap) => ({
      name: gap.kind === 'gap' ? 'log gap' : 'pose jump',
      t: gap.startT,
    })),
    gaps: gaps.length > 0 ? gaps : undefined,
    warnings,
    timingSource: 'logged',
  };
}
