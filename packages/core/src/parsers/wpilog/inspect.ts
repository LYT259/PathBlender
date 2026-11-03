/**
 * WPILOG inspection: entry catalog → schema set → pose candidates →
 * autonomous intervals. Everything here is derived from the log itself;
 * nothing hard-codes one team's entry names, and no array of three numbers
 * is treated as a pose without either a verified schema shape or an
 * explicit name hint plus user confirmation in the import dialog.
 */

import type { WpilogCatalog, WpilogEntry } from './container';
import { catalogWpilog, scanWpilogRecords } from './container';
import {
  buildStructSet,
  decodeStructValue,
  parseStructSchema,
  type ParsedSchema,
  type StructLayout,
  type StructValue,
} from './struct';
import {
  decodeProtoPayload,
  parseFileDescriptor,
  type ProtoValue,
} from './protobuf';

/* ------------------------------------------------------------------ */
/* Primitive payload decoding (the non-struct data types)              */
/* ------------------------------------------------------------------ */

export type PrimitiveValue = number | boolean | string | number[] | boolean[] | string[];

export function decodePrimitive(type: string, payload: Uint8Array): PrimitiveValue | null {
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  try {
    switch (type) {
      case 'boolean':
        return payload.length >= 1 ? payload[0] !== 0 : null;
      case 'int64':
        return payload.length >= 8 ? Number(view.getBigInt64(0, true)) : null;
      case 'float':
        return payload.length >= 4 ? view.getFloat32(0, true) : null;
      case 'double':
        return payload.length >= 8 ? view.getFloat64(0, true) : null;
      case 'string':
        return new TextDecoder('utf-8', { fatal: false }).decode(payload);
      case 'boolean[]': {
        const out: boolean[] = [];
        for (let i = 0; i < payload.length; i++) out.push(payload[i] !== 0);
        return out;
      }
      case 'int64[]': {
        if (payload.length % 8 !== 0) return null;
        const out: number[] = [];
        for (let i = 0; i + 8 <= payload.length; i += 8) out.push(Number(view.getBigInt64(i, true)));
        return out;
      }
      case 'float[]': {
        if (payload.length % 4 !== 0) return null;
        const out: number[] = [];
        for (let i = 0; i + 4 <= payload.length; i += 4) out.push(view.getFloat32(i, true));
        return out;
      }
      case 'double[]': {
        if (payload.length % 8 !== 0) return null;
        const out: number[] = [];
        for (let i = 0; i + 8 <= payload.length; i += 8) out.push(view.getFloat64(i, true));
        return out;
      }
      case 'string[]': {
        if (payload.length < 4) return null;
        const count = view.getUint32(0, true);
        let pos = 4;
        const out: string[] = [];
        const decoder = new TextDecoder('utf-8', { fatal: false });
        for (let i = 0; i < count; i++) {
          if (pos + 4 > payload.length) return null;
          const len = view.getUint32(pos, true);
          pos += 4;
          if (pos + len > payload.length) return null;
          out.push(decoder.decode(payload.subarray(pos, pos + len)));
          pos += len;
        }
        return out;
      }
      default:
        return null; // "raw", "json", vendor types, unknown types
    }
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Pose shape recognition                                             */
/* ------------------------------------------------------------------ */

export interface RecognizedPose {
  x: number;
  y: number;
  /** Heading in radians when the shape carried one; undefined otherwise. */
  headingRad?: number;
}

const ANGLE_KEYS = ['heading', 'theta', 'angle', 'rotation', 'rot', 'yaw', 'value'];
const POSITION_KEYS = ['translation', 'position', 'pos', 'location'];

function numeric(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * Recognize a pose inside a decoded struct/proto value: numeric x/y either
 * at the root or under a position-like child, plus an optional angle field
 * (numeric or a rotation object with a value). Deliberately narrow — a
 * {left, right} pair or a {voltage} blob does not match.
 */
export function recognizePose(value: StructValue | ProtoValue): RecognizedPose | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  let x: number | null = null;
  let y: number | null = null;
  let source: Record<string, unknown> | null = null;
  if (numeric(record['x']) !== null && numeric(record['y']) !== null) {
    x = numeric(record['x']);
    y = numeric(record['y']);
    source = record;
  } else {
    for (const key of POSITION_KEYS) {
      const child = record[key];
      if (typeof child === 'object' && child !== null && !Array.isArray(child)) {
        const childRecord = child as Record<string, unknown>;
        if (numeric(childRecord['x']) !== null && numeric(childRecord['y']) !== null) {
          x = numeric(childRecord['x']);
          y = numeric(childRecord['y']);
          source = childRecord;
          break;
        }
      }
    }
  }
  if (x === null || y === null || source === null) return null;
  let headingRad: number | undefined;
  // Angle fields may sit next to x/y (flat shapes) or on the root beside
  // the position child (WPILib Pose2d: rotation is a sibling of translation).
  for (const holder of [source, record]) {
    if (headingRad !== undefined) break;
    for (const key of ANGLE_KEYS) {
      const angle = holder[key];
      if (angle === undefined) continue;
      const direct = numeric(angle);
      if (direct !== null) {
        headingRad = direct;
        break;
      }
      if (typeof angle === 'object' && angle !== null && !Array.isArray(angle)) {
        const angleRecord = angle as Record<string, unknown>;
        for (const inner of ANGLE_KEYS) {
          const nested = numeric(angleRecord[inner]);
          if (nested !== null) {
            headingRad = nested;
            break;
          }
        }
        if (headingRad !== undefined) break;
      }
    }
  }
  return { x, y, headingRad };
}

const TARGET_HINT = /target|desired|goal|setpoint|command|reference|planned|trajectory|path/i;
const MEASURED_HINT = /pose|odometry|estimat|robot|drive|location|position/i;
const NUMERIC_POSE_NAME = /pose|odometry|location|position/i;

export type PoseCandidateKind = 'struct-pose' | 'struct-pose-array' | 'proto-pose' | 'numeric-array';

export interface PoseSamplePreview {
  tS: number;
  x: number;
  y: number;
  headingRad?: number;
}

export interface PoseCandidate {
  kind: PoseCandidateKind;
  entryId: number;
  /** Entry name as logged (shown verbatim in the picker). */
  entryName: string;
  type: string;
  /** For array kinds: elements per record (robot defaults to element 0). */
  elementCount: number;
  recordCount: number;
  spanS: number;
  /** Decoded preview poses (first / middle / last of the preview batch). */
  preview: PoseSamplePreview[];
  /** Name-based hint that this is a target/desired pose, not the robot. */
  likelyTarget: boolean;
  /** Unit declared in the entry metadata JSON ("unit" property), if any. */
  unitHint?: string;
  /** The shape decoded a heading; false when it carries x/y only. */
  hasHeading: boolean;
  /** Preview coordinates are far outside a field — probably wrong units/frame. */
  outOfFieldRange: boolean;
  /** Auto-selection score (higher = more likely the measured robot pose). */
  score: number;
}

/* ------------------------------------------------------------------ */
/* Schemas                                                             */
/* ------------------------------------------------------------------ */

const SCHEMA_PREFIX = '/.schema/';

export interface WpilogSchemaSet {
  /** Short struct name ("Pose2d") → parsed struct schema. */
  structs: Map<string, ParsedSchema>;
  /** Type string ("proto:Pose2d") → serialized FileDescriptorProto payload. */
  protos: Map<string, Uint8Array>;
  /** Resolved layouts keyed by short struct name. */
  layouts: Map<string, StructLayout>;
}

function collectSchemas(catalog: WpilogCatalog, bytes: Uint8Array): WpilogSchemaSet {
  const structs = new Map<string, ParsedSchema>();
  const protos = new Map<string, Uint8Array>();
  const wanted = new Map<number, WpilogEntry>();
  for (const entry of catalog.entries) {
    let name = entry.name;
    if (name.startsWith('NT:')) name = name.slice(3);
    if (!name.startsWith(SCHEMA_PREFIX)) continue;
    if (entry.type !== 'structschema' && !entry.type.startsWith('proto:')) continue;
    wanted.set(entry.id, entry);
  }
  if (wanted.size > 0) {
    scanWpilogRecords(bytes, catalog.header.firstRecordOffset, {
      onStart: () => undefined,
      onFinish: () => undefined,
      onMetadata: () => undefined,
      onData: (record) => {
        const entry = wanted.get(record.entryId);
        if (!entry) return;
        let name = entry.name;
        if (name.startsWith('NT:')) name = name.slice(3);
        const typeName = name.slice(SCHEMA_PREFIX.length);
        if (entry.type === 'structschema') {
          const shortName = typeName.startsWith('struct:') ? typeName.slice('struct:'.length) : typeName;
          if (!structs.has(shortName)) {
            const text = new TextDecoder('utf-8', { fatal: false }).decode(record.payload);
            const parsed = parseStructSchema(shortName, text);
            if (parsed) structs.set(shortName, parsed);
          }
        } else if (!protos.has(typeName)) {
          protos.set(typeName, record.payload.slice());
        }
      },
    });
  }
  const layouts = buildStructSet(structs.values());
  return { structs, protos, layouts };
}

/* ------------------------------------------------------------------ */
/* Autonomous intervals                                                */
/* ------------------------------------------------------------------ */

export interface WpilogAutoInterval {
  startUs: number;
  endUs: number;
  /** How the interval was detected, shown in the picker. */
  source: string;
}

interface StepSample<T> {
  timestampUs: number;
  value: T;
}

/**
 * Decode one small entry into timestamped values (sorted). Mode/enable
 * signals log on change, so a targeted second pass is cheap even in huge
 * logs and never allocates for the rest of the file.
 */
function collectSamples<T>(
  bytes: Uint8Array,
  catalog: WpilogCatalog,
  entryId: number,
  decode: (payload: Uint8Array) => T | null,
): StepSample<T>[] {
  const out: StepSample<T>[] = [];
  scanWpilogRecords(bytes, catalog.header.firstRecordOffset, {
    onStart: () => undefined,
    onFinish: () => undefined,
    onMetadata: () => undefined,
    onData: (record) => {
      if (record.entryId !== entryId) return;
      const value = decode(record.payload);
      if (value !== null) out.push({ timestampUs: record.timestampUs, value });
    },
  });
  out.sort((a, b) => a.timestampUs - b.timestampUs);
  return out;
}

function entryByName(catalog: WpilogCatalog, name: string): WpilogEntry | undefined {
  return catalog.entries.find((entry) => entry.name === name);
}

const AUTONOMOUS_TEXT = /auton/i;

function controlWordIntervals(
  bytes: Uint8Array,
  catalog: WpilogCatalog,
  schemas: WpilogSchemaSet,
  entryName: string,
): WpilogAutoInterval[] | null {
  const entry = entryByName(catalog, entryName);
  if (!entry || !entry.type.startsWith('struct:')) return null;
  const schemaName = entry.type.slice('struct:'.length);
  const layout = schemas.layouts.get(schemaName);
  if (!layout) return null;
  const samples = collectSamples(bytes, catalog, entry.id, (payload) => {
    if (payload.length < layout.sizeBytes) return null;
    const decoded = decodeStructValue(layout, payload, (name) => schemas.layouts.get(name));
    if (!decoded) return null;
    // Generic control-word shape: an `enabled` boolean plus a mode field
    // (numeric enum or string) — never hard-coded bit positions.
    const enabled = decoded['enabled'];
    const mode = decoded['robotMode'] ?? decoded['mode'] ?? decoded['opMode'];
    if (typeof enabled !== 'boolean') return null;
    const autonomous = typeof mode === 'number'
      ? mode === 1
      : typeof mode === 'string' ? AUTONOMOUS_TEXT.test(mode) : false;
    return { enabled, autonomous };
  });
  if (samples.length === 0) return null;
  const intervals = booleanIntervals(samples, `control word (${entry.name})`);
  return intervals.length > 0 ? intervals : null;
}

/** Intervals where enabled && autonomous from a merged step series. */
function booleanIntervals(
  samples: ReadonlyArray<StepSample<{ enabled: boolean; autonomous: boolean }>>,
  source: string,
): WpilogAutoInterval[] {
  const intervals: WpilogAutoInterval[] = [];
  let open: number | null = null;
  for (const sample of samples) {
    if (sample.value.enabled && sample.value.autonomous) {
      if (open === null) open = sample.timestampUs;
    } else if (open !== null) {
      intervals.push({ startUs: open, endUs: sample.timestampUs, source });
      open = null;
    }
  }
  if (open !== null && samples.length > 0) {
    intervals.push({
      startUs: open,
      endUs: samples[samples.length - 1]!.timestampUs,
      source,
    });
  }
  return intervals;
}

/**
 * Intervals from an enabled boolean + an autonomous signal (boolean or
 * mode string). Returns null when either series is absent/empty.
 */
function booleanPairIntervals(
  bytes: Uint8Array,
  catalog: WpilogCatalog,
  enabledName: string,
  autonomousName: string,
  modeName: string | undefined,
  source: string,
): WpilogAutoInterval[] | null {
  const enabled = entryByName(catalog, enabledName);
  if (!enabled || enabled.type !== 'boolean') return null;
  const enabledSamples = collectSamples(bytes, catalog, enabled.id, (payload) =>
    payload.length >= 1 ? payload[0] !== 0 : null);
  if (enabledSamples.length === 0) return null;
  let autonomousSamples: StepSample<boolean>[] | null = null;
  const autonomous = autonomousName ? entryByName(catalog, autonomousName) : undefined;
  if (autonomous && autonomous.type === 'boolean') {
    autonomousSamples = collectSamples(bytes, catalog, autonomous.id, (payload) =>
      payload.length >= 1 ? payload[0] !== 0 : null);
  } else if (modeName) {
    const robotMode = entryByName(catalog, modeName);
    if (robotMode && robotMode.type === 'string') {
      autonomousSamples = collectSamples(bytes, catalog, robotMode.id, (payload) =>
        AUTONOMOUS_TEXT.test(new TextDecoder('utf-8', { fatal: false }).decode(payload)));
    }
  }
  if (!autonomousSamples || autonomousSamples.length === 0) return null;
  // Merge the two step series on the time axis: at any instant the latest
  // sample of each series applies.
  const merged: StepSample<{ enabled: boolean; autonomous: boolean }>[] = [];
  let enabledState = enabledSamples[0]!.value;
  let autonomousState = autonomousSamples[0]!.value;
  let i = 0;
  let j = 0;
  while (i < enabledSamples.length || j < autonomousSamples.length) {
    const nextEnabled = enabledSamples[i];
    const nextAutonomous = autonomousSamples[j];
    if (nextEnabled && (!nextAutonomous || nextEnabled.timestampUs <= nextAutonomous.timestampUs)) {
      enabledState = nextEnabled.value;
      i++;
      merged.push({ timestampUs: nextEnabled.timestampUs, value: { enabled: enabledState, autonomous: autonomousState } });
    } else if (nextAutonomous) {
      autonomousState = nextAutonomous.value;
      j++;
      merged.push({ timestampUs: nextAutonomous.timestampUs, value: { enabled: enabledState, autonomous: autonomousState } });
    }
  }
  const intervals = booleanIntervals(merged, source);
  return intervals.length > 0 ? intervals : null;
}

/**
 * AdvantageKit DriverStation table (Enabled + Autonomous/RobotMode), also
 * covering the 2026 WPILib DS logger's flat `DS:enabled`/`DS:autonomous`
 * booleans. Replay logs duplicate everything under RealOutput/.
 */
function booleanSignalIntervals(bytes: Uint8Array, catalog: WpilogCatalog): WpilogAutoInterval[] | null {
  const sources: Array<{ enabled: string; autonomous: string; mode?: string; label: string }> = [
    { enabled: 'DriverStation/Enabled', autonomous: 'DriverStation/Autonomous', mode: 'DriverStation/RobotMode', label: 'DriverStation signals' },
    { enabled: 'RealOutput/DriverStation/Enabled', autonomous: 'RealOutput/DriverStation/Autonomous', mode: 'RealOutput/DriverStation/RobotMode', label: 'RealOutput/DriverStation signals' },
    { enabled: 'DS:enabled', autonomous: 'DS:autonomous', label: 'DS:enabled/DS:autonomous' },
  ];
  for (const source of sources) {
    const intervals = booleanPairIntervals(bytes, catalog, source.enabled, source.autonomous, source.mode, source.label);
    if (intervals) return intervals;
  }
  return null;
}

function ntOpModeIntervals(bytes: Uint8Array, catalog: WpilogCatalog): WpilogAutoInterval[] | null {
  for (const name of ['NT:/DriverStation/OpMode', 'DS:opMode']) {
    const entry = entryByName(catalog, name);
    if (!entry || entry.type !== 'string') continue;
    const samples = collectSamples(bytes, catalog, entry.id, (payload) =>
      new TextDecoder('utf-8', { fatal: false }).decode(payload));
    if (samples.length === 0) continue;
    // OpMode alone says autonomous, not enabled — these spans are the
    // honest fallback and the dialog labels the signal source.
    const intervals: WpilogAutoInterval[] = [];
    let open: number | null = null;
    for (const sample of samples) {
      if (AUTONOMOUS_TEXT.test(sample.value)) {
        if (open === null) open = sample.timestampUs;
      } else if (open !== null) {
        intervals.push({ startUs: open, endUs: sample.timestampUs, source: `${name} string` });
        open = null;
      }
    }
    if (open !== null) {
      intervals.push({ startUs: open, endUs: samples[samples.length - 1]!.timestampUs, source: `${name} string` });
    }
    if (intervals.length > 0) return intervals;
  }
  return null;
}

/**
 * Detect autonomous intervals from verified enable/mode signals, in
 * priority order. Never guesses "the first N seconds are auto" — when no
 * signal exists the caller offers a manual range.
 */
export function detectAutoIntervals(
  bytes: Uint8Array,
  catalog: WpilogCatalog,
  schemas: WpilogSchemaSet,
): WpilogAutoInterval[] {
  return (
    booleanSignalIntervals(bytes, catalog) ??
    controlWordIntervals(bytes, catalog, schemas, 'DS:controlWord') ??
    controlWordIntervals(bytes, catalog, schemas, 'NT:/DriverStation/ControlWord') ??
    ntOpModeIntervals(bytes, catalog) ??
    []
  );
}

/* ------------------------------------------------------------------ */
/* Inspection                                                          */
/* ------------------------------------------------------------------ */

export interface WpilogInspection {
  fileName: string;
  header: { version: number; extraHeader: string };
  /** AdvantageKit wrote this log (extra header marker). */
  advantageKit: boolean;
  catalog: WpilogCatalog;
  schemas: WpilogSchemaSet;
  candidates: PoseCandidate[];
  autoIntervals: WpilogAutoInterval[];
  /** Log-global time span (µs) of all data records. */
  firstTimestampUs: number;
  lastTimestampUs: number;
  warnings: string[];
}

/** How many decoded poses the preview collects before it stops caring. */
const PREVIEW_LIMIT = 96;

interface EntryProbe {
  preview: PoseSamplePreview[];
  decodedCount: number;
  payloadBytes: number;
}

/**
 * Decode the head of an entry's records through `decode`; reports the
 * first/middle/last decoded preview pose, how many decoded, and the first
 * payload length seen (array-shape validation).
 */
function probeEntry(
  bytes: Uint8Array,
  catalog: WpilogCatalog,
  entry: WpilogEntry,
  decode: (payload: Uint8Array) => RecognizedPose | null,
): EntryProbe {
  const stamps: Array<{ timestampUs: number; pose: RecognizedPose }> = [];
  let payloadBytes = 0;
  scanWpilogRecords(bytes, catalog.header.firstRecordOffset, {
    onStart: () => undefined,
    onFinish: () => undefined,
    onMetadata: () => undefined,
    onData: (record) => {
      if (record.entryId !== entry.id) return;
      if (payloadBytes === 0) payloadBytes = record.payload.length;
      if (stamps.length >= PREVIEW_LIMIT) return;
      const pose = decode(record.payload);
      if (pose) stamps.push({ timestampUs: record.timestampUs, pose });
    },
  });
  if (stamps.length === 0) return { preview: [], decodedCount: 0, payloadBytes };
  stamps.sort((a, b) => a.timestampUs - b.timestampUs);
  const picks = [stamps[0]!, stamps[Math.floor(stamps.length / 2)]!, stamps[stamps.length - 1]!];
  return {
    preview: picks.map((sample) => ({
      tS: sample.timestampUs / 1e6,
      x: sample.pose.x,
      y: sample.pose.y,
      headingRad: sample.pose.headingRad,
    })),
    decodedCount: stamps.length,
    payloadBytes,
  };
}

/**
 * Inspect a wpilog: schema set, pose candidates (with previews) and auto
 * intervals. Container damage surfaces as warnings; unrelated unknown
 * entries are ignored so a vendor blob never fails the whole log.
 */
export function inspectWpilog(bytes: Uint8Array, fileName: string): WpilogInspection {
  const catalog = catalogWpilog(bytes, fileName);
  const warnings: string[] = [];
  if (catalog.scan.stop === 'truncated') {
    warnings.push(`truncated tail: last ${catalog.scan.wastedBytes} bytes ignored`);
  } else if (catalog.scan.stop === 'bad-timestamp') {
    warnings.push(`corrupt timestamp at byte ${catalog.scan.stopOffset}: remaining records ignored`);
  }
  const schemas = collectSchemas(catalog, bytes);
  const candidates: PoseCandidate[] = [];
  const layoutFor = (typeName: string) => schemas.layouts.get(typeName);

  for (const entry of catalog.entries) {
    if (entry.recordCount === 0) continue;
    if (/^struct:.+\[\]$/.test(entry.type)) {
      // Struct arrays: Field2d-style. Element 0 previews; the picker offers
      // the element index (robot is conventionally first, but the user
      // confirms — a Pose2d[] is not assumed to be the robot).
      const elementTypeName = entry.type.slice('struct:'.length, -2);
      const layout = layoutFor(elementTypeName);
      if (!layout || layout.sizeBytes <= 0) continue;
      const decode = (payload: Uint8Array): RecognizedPose | null => {
        if (payload.length < layout.sizeBytes) return null;
        const decoded = decodeStructValue(
          layout, payload.subarray(0, layout.sizeBytes), (name) => schemas.layouts.get(name));
        return decoded ? recognizePose(decoded) : null;
      };
      const probe = probeEntry(bytes, catalog, entry, decode);
      if (probe.decodedCount === 0) continue;
      const elementCount = Math.max(1, Math.floor(probe.payloadBytes / layout.sizeBytes));
      pushCandidate(candidates, entry, 'struct-pose-array', probe, elementCount);
    } else if (entry.type.startsWith('struct:')) {
      const shortName = entry.type.slice('struct:'.length);
      const layout = layoutFor(shortName);
      if (!layout) continue;
      const decode = (payload: Uint8Array): RecognizedPose | null => {
        if (payload.length < layout.sizeBytes) return null;
        const decoded = decodeStructValue(layout, payload, (name) => schemas.layouts.get(name));
        return decoded ? recognizePose(decoded) : null;
      };
      const probe = probeEntry(bytes, catalog, entry, decode);
      if (probe.decodedCount === 0) continue;
      pushCandidate(candidates, entry, 'struct-pose', probe, 1);
    } else if (entry.type.startsWith('proto:')) {
      const descriptor = schemas.protos.get(entry.type);
      if (!descriptor) continue;
      const fd = parseFileDescriptor(descriptor);
      if (fd.length === 0) continue;
      const messageName = entry.type.slice('proto:'.length);
      const decode = (payload: Uint8Array): RecognizedPose | null => {
        const decoded = decodeProtoPayload(payload, fd, messageName);
        return decoded ? recognizePose(decoded) : null;
      };
      const probe = probeEntry(bytes, catalog, entry, decode);
      if (probe.decodedCount === 0) continue;
      pushCandidate(candidates, entry, 'proto-pose', probe, 1);
    } else if (entry.type === 'double[]' || entry.type === 'float[]') {
      // Numeric arrays qualify only with a pose-ish name — never treat an
      // anonymous three-element array as a pose (CTRE-style odometry
      // double arrays land here and still need the user's confirmation).
      const lastSegment = entry.name.split('/').pop() ?? entry.name;
      if (!NUMERIC_POSE_NAME.test(lastSegment)) continue;
      const decode = (payload: Uint8Array): RecognizedPose | null => {
        const values = decodePrimitive(entry.type, payload);
        if (!Array.isArray(values)) return null;
        const x = numeric(values[0]);
        const y = numeric(values[1]);
        if (x === null || y === null) return null;
        const heading = values.length >= 3 ? numeric(values[2]) : null;
        return { x, y, headingRad: heading ?? undefined };
      };
      const probe = probeEntry(bytes, catalog, entry, decode);
      if (probe.decodedCount === 0) continue;
      const elem = entry.type === 'double[]' ? 8 : 4;
      if (probe.payloadBytes === 0 || probe.payloadBytes % elem !== 0) continue;
      const elementCount = probe.payloadBytes / elem;
      if (elementCount < 2 || elementCount > 3) continue; // [x,y] / [x,y,θ] only
      pushCandidate(candidates, entry, 'numeric-array', probe, elementCount);
    }
  }

  for (const candidate of candidates) {
    const lastSegment = candidate.entryName.split('/').pop() ?? candidate.entryName;
    let score = candidate.recordCount >= 50 ? 2 : 0;
    score += candidate.spanS >= 10 ? 1 : 0;
    if (TARGET_HINT.test(lastSegment)) score -= 4;
    else if (MEASURED_HINT.test(lastSegment)) score += 2;
    if (candidate.kind === 'struct-pose' || candidate.kind === 'proto-pose') score += 1;
    if (candidate.hasHeading) score += 1;
    candidate.score = score;
  }
  candidates.sort((a, b) => b.score - a.score || a.entryName.localeCompare(b.entryName));

  const autoIntervals = detectAutoIntervals(bytes, catalog, schemas);
  let firstTimestampUs = Number.POSITIVE_INFINITY;
  let lastTimestampUs = 0;
  for (const entry of catalog.entries) {
    if (entry.recordCount === 0) continue;
    firstTimestampUs = Math.min(firstTimestampUs, entry.firstTimestampUs);
    lastTimestampUs = Math.max(lastTimestampUs, entry.lastTimestampUs);
  }
  if (!Number.isFinite(firstTimestampUs)) firstTimestampUs = 0;

  return {
    fileName,
    header: { version: catalog.header.version, extraHeader: catalog.header.extraHeader },
    advantageKit: catalog.header.extraHeader.includes('AdvantageKit'),
    catalog,
    schemas,
    candidates,
    autoIntervals,
    firstTimestampUs,
    lastTimestampUs,
    warnings,
  };
}

function pushCandidate(
  candidates: PoseCandidate[],
  entry: WpilogEntry,
  kind: PoseCandidateKind,
  probe: EntryProbe,
  elementCount: number,
): void {
  const lastSegment = entry.name.split('/').pop() ?? entry.name;
  const likelyTarget = TARGET_HINT.test(lastSegment);
  const outOfFieldRange = probe.preview.some((p) =>
    p.x < -30 || p.x > 50 || p.y < -30 || p.y > 50 ||
    (p.headingRad !== undefined && Math.abs(p.headingRad) > Math.PI * 4));
  let unitHint: string | undefined;
  if (entry.metadata.trim().startsWith('{')) {
    try {
      const metadata = JSON.parse(entry.metadata) as { unit?: unknown };
      if (typeof metadata.unit === 'string') unitHint = metadata.unit;
    } catch {
      // metadata is optional free text — ignore parse failures
    }
  }
  candidates.push({
    kind,
    entryId: entry.id,
    entryName: entry.name,
    type: entry.type,
    elementCount,
    recordCount: entry.recordCount,
    spanS: (entry.lastTimestampUs - entry.firstTimestampUs) / 1e6,
    preview: probe.preview,
    likelyTarget,
    unitHint,
    hasHeading: probe.preview.some((p) => p.headingRad !== undefined),
    outOfFieldRange,
    score: 0,
  });
}
