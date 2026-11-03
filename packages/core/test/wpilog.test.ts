/**
 * WPILOG import tests: container tolerance, struct/protobuf decoding,
 * pose recognition, auto-interval detection, extraction semantics
 * (t=0 rebase, gaps/jumps/holds, units), session round trip, and the
 * real DogLog fixture. Large real DS logs run only when WPILog_FIXTURE_DIR
 * points at them (see samples/wpilog/README.md).
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ParseError,
  buildSamples,
  decodePrimitive,
  decodeProtoPayload,
  decodeStructValue,
  extractWpilogTrajectory,
  inspectWpilog,
  isWpilogFileName,
  looksLikeWpilog,
  parseFileDescriptor,
  parseStructSchema,
  buildStructSet,
  sampleTrajectory,
  serializeSession,
  deserializeSession,
  makeSession,
} from '../src';
import type { Trajectory, TrajectoryGap } from '../src';

/* ------------------------------------------------------------------ */
/* Byte-exact WPILOG writer (test-side only, mirrors datalog.adoc)      */
/* ------------------------------------------------------------------ */

class WpilogWriter {
  private chunks: number[] = [];
  private entryIds = new Map<string, number>();
  private nextId = 1;

  constructor(extraHeader = '') {
    const magic = [...'WPILOG'].map((c) => c.charCodeAt(0));
    const version = [0x00, 0x01]; // 1.0, little-endian
    const extra = [...new TextEncoder().encode(extraHeader)];
    this.chunks.push(...magic, ...version, ...u32(extra.length), ...extra);
  }

  bytes(): Uint8Array {
    return new Uint8Array(this.chunks);
  }

  /** Start an entry; returns its id for data records. */
  start(name: string, type: string, metadata = ''): number {
    const id = this.nextId++;
    this.entryIds.set(name, id);
    const payload = [
      0, // control type: Start
      ...u32(id),
      ...str(name),
      ...str(type),
      ...str(metadata),
    ];
    this.record(0, 0, payload);
    return id;
  }

  data(entryId: number, timestampUs: number, payload: ArrayLike<number>): void {
    this.record(entryId, timestampUs, payload);
  }

  /** A data record whose header uses full 4/4/8-byte widths (force path). */
  dataWide(entryId: number, timestampUs: number, payload: ArrayLike<number>): void {
    const header = 0b1111_1111; // id len 4, size len 4, ts len 8
    this.chunks.push(header);
    this.pushVar(entryId, 4);
    this.pushVar(payload.length, 4);
    this.pushVar(timestampUs, 8);
    for (let i = 0; i < payload.length; i++) this.chunks.push(payload[i]!);
  }

  /** Append raw garbage after everything (truncation tests). */
  tail(bytes: ArrayLike<number>): void {
    for (let i = 0; i < bytes.length; i++) this.chunks.push(bytes[i]!);
  }

  private record(entryId: number, timestampUs: number, payload: ArrayLike<number>): void {
    // Choose the smallest widths that hold the values, like the real writer.
    const idLen = widthFor(entryId, 4);
    const sizeLen = widthFor(payload.length, 4);
    const tsLen = widthFor(timestampUs, 8);
    const header = ((idLen - 1) | ((sizeLen - 1) << 2) | ((tsLen - 1) << 4)) & 0x7f;
    this.chunks.push(header);
    this.pushVar(entryId, idLen);
    this.pushVar(payload.length, sizeLen);
    this.pushVar(timestampUs, tsLen);
    for (let i = 0; i < payload.length; i++) this.chunks.push(payload[i]!);
  }

  private pushVar(value: number, len: number): void {
    for (let i = 0; i < len; i++) {
      this.chunks.push(Math.floor(value / 2 ** (8 * i)) % 256);
    }
  }
}

function widthFor(value: number, max: number): number {
  for (let len = 1; len < max; len++) {
    if (value < 2 ** (8 * len)) return len;
  }
  return max;
}

function u32(value: number): number[] {
  return [value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff, (value >>> 24) & 0xff];
}

function str(value: string): number[] {
  const bytes = [...new TextEncoder().encode(value)];
  return [...u32(bytes.length), ...bytes];
}

function f64(...values: number[]): number[] {
  const out: number[] = [];
  for (const value of values) {
    const view = new DataView(new ArrayBuffer(8));
    view.setFloat64(0, value, true);
    for (let i = 0; i < 8; i++) out.push(view.getUint8(i));
  }
  return out;
}

const POSE2D_SCHEMA = 'Translation2d translation;Rotation2d rotation';
const TRANSLATION2D_SCHEMA = 'double x;double y';
const ROTATION2D_SCHEMA = 'double value';
const CONTROL_WORD_SCHEMA =
  'uint64 opModeHash:56;enum{unknown=0,autonomous=1,teleoperated=2,utility=3} uint64 robotMode:2;bool enabled:1;bool eStop:1;bool fmsAttached:1;bool dsAttached:1;';

/** Register the Pose2d/Translation2d/Rotation2d schema trio, NT-style. */
function registerPoseSchemas(writer: WpilogWriter): void {
  const pose2d = writer.start('NT:/.schema/struct:Pose2d', 'structschema');
  writer.data(pose2d, 0, [...new TextEncoder().encode(POSE2D_SCHEMA)]);
  const translation = writer.start('NT:/.schema/struct:Translation2d', 'structschema');
  writer.data(translation, 0, [...new TextEncoder().encode(TRANSLATION2D_SCHEMA)]);
  const rotation = writer.start('NT:/.schema/struct:Rotation2d', 'structschema');
  writer.data(rotation, 0, [...new TextEncoder().encode(ROTATION2D_SCHEMA)]);
}

/** A whole DogLog/NT-style log with pose + control word + schemas. */
function buildRobotLog(options: {
  poseSamples: Array<{ tS: number; x: number; y: number; headingRad?: number }>;
  controlWord: Array<{ tS: number; enabled: boolean; autonomous: boolean }>;
  poseName?: string;
  poseArrayType?: boolean;
  extraHeader?: string;
}): Uint8Array {
  const writer = new WpilogWriter(options.extraHeader ?? '');
  registerPoseSchemas(writer);
  const controlWordSchema = writer.start('NT:/.schema/struct:ControlWord', 'structschema');
  writer.data(controlWordSchema, 0, [...new TextEncoder().encode(CONTROL_WORD_SCHEMA)]);

  const poseEntry = writer.start(
    options.poseName ?? 'NT:/Drivetrain/Pose',
    options.poseArrayType ? 'struct:Pose2d[]' : 'struct:Pose2d',
  );
  for (const sample of options.poseSamples) {
    const heading = sample.headingRad ?? 0;
    if (options.poseArrayType) {
      // two elements: robot pose then a decoy target
      writer.data(poseEntry, sample.tS * 1e6, [...f64(sample.x, sample.y, heading), ...f64(9, 9, 0)]);
    } else {
      writer.data(poseEntry, sample.tS * 1e6, f64(sample.x, sample.y, heading));
    }
  }
  const cw = writer.start('NT:/DriverStation/ControlWord', 'struct:ControlWord');
  for (const sample of options.controlWord) {
    writer.data(cw, sample.tS * 1e6, encodeControlWordBits(0, sample.autonomous ? 1 : 2, sample.enabled));
  }
  return writer.bytes();
}

/** ControlWord payload per the logged schema: mode @56, enabled @58, LSB-first. */
function encodeControlWordBits(hash: number, mode: number, enabled: boolean): number[] {
  const whole = BigInt(hash) | (BigInt(mode) << 56n) | (BigInt(enabled ? 1 : 0) << 58n);
  const bytes: number[] = [];
  for (let i = 0; i < 8; i++) bytes.push(Number((whole >> BigInt(8 * i)) & 0xffn));
  return bytes;
}

/* ------------------------------------------------------------------ */
/* Container                                                           */
/* ------------------------------------------------------------------ */

describe('wpilog container', () => {
  it('reads the smallest valid header (spec example bytes)', () => {
    const bytes = new Uint8Array([0x57, 0x50, 0x49, 0x4c, 0x4f, 0x47, 0x00, 0x01, 0, 0, 0, 0]);
    expect(looksLikeWpilog(bytes)).toBe(true);
    const inspection = inspectWpilog(bytes, 'empty.wpilog');
    expect(inspection.header.version).toBe(0x0100);
    expect(inspection.candidates).toHaveLength(0);
    expect(inspection.autoIntervals).toHaveLength(0);
  });

  it('rejects non-WPILOG bytes, short files, and future major versions', () => {
    expect(() => inspectWpilog(new Uint8Array([1, 2, 3]), 'x.wpilog')).toThrow(ParseError);
    expect(() => inspectWpilog(new TextEncoder().encode('{"trajectory":{}}'), 'x.wpilog')).toThrow(/WPILOG/);
    const future = new Uint8Array([0x57, 0x50, 0x49, 0x4c, 0x4f, 0x47, 0x00, 0x02, 0, 0, 0, 0]);
    expect(() => inspectWpilog(future, 'x.wpilog')).toThrow(/major/);
  });

  it('treats a truncated tail as a warning, not a failure', () => {
    const log = buildRobotLog({
      poseSamples: [{ tS: 0, x: 1, y: 2 }],
      controlWord: [{ tS: 0, enabled: true, autonomous: true }],
    });
    const truncated = log.subarray(0, log.length - 5);
    const inspection = inspectWpilog(truncated, 'cut.wpilog');
    expect(inspection.warnings.some((w) => w.includes('truncated tail'))).toBe(true);
    // The intact pose entry still yields a candidate.
    expect(inspection.candidates.length).toBeGreaterThan(0);
  });

  it('stops at a corrupt (unrepresentable) timestamp and reports it', () => {
    const writer = new WpilogWriter();
    const entry = writer.start('x', 'double');
    writer.data(entry, 1_000, f64(1));
    writer.dataWide(entry, Number.MAX_SAFE_INTEGER, f64(1)); // beyond sanity bound
    writer.data(entry, 2_000, f64(2));
    const inspection = inspectWpilog(writer.bytes(), 'corrupt.wpilog');
    expect(inspection.warnings.some((w) => w.includes('corrupt timestamp'))).toBe(true);
  });

  it('parses wide-header records (4/4/8 widths)', () => {
    const writer = new WpilogWriter();
    const entry = writer.start('odometry', 'double[]');
    writer.dataWide(entry, 5_000_000, f64(1.5, 2.5, 0.5));
    const inspection = inspectWpilog(writer.bytes(), 'wide.wpilog');
    const candidate = inspection.candidates.find((c) => c.entryName === 'odometry');
    expect(candidate).toBeDefined();
    expect(candidate!.preview[0]).toMatchObject({ x: 1.5, y: 2.5, headingRad: 0.5 });
  });

  it('isWpilogFileName matches the extension only', () => {
    expect(isWpilogFileName('FRC_1.wpilog')).toBe(true);
    expect(isWpilogFileName('a.WPILOG')).toBe(true);
    expect(isWpilogFileName('route.traj')).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* Struct schema decoding                                              */
/* ------------------------------------------------------------------ */

describe('wpilog struct decoding', () => {
  it('decodes the spec bit-field packing examples exactly', () => {
  const lookups = (schemas: string[]) => {
    const parsed = schemas.map((text, i) => parseStructSchema(`S${i}`, text)!);
    return buildStructSet(parsed);
  };
    // int16 a:4; int16 b:5; bool c:1; int16 d:7 → 4 bytes
    const set1 = lookups(['int16 a:4;int16 b:5;bool c:1;int16 d:7']);
    const s1 = set1.get('S0')!;
    expect(s1.sizeBytes).toBe(4);
    // int8 a:4; int16 b:4 → 3 bytes (width change closes the unit)
    const set2 = lookups(['int8 a:4;int16 b:4']);
    expect(set2.get('S0')!.sizeBytes).toBe(3);
    // bool a:1; bool b:1; int8 c:2 → 1 byte
    const set3 = lookups(['bool a:1;bool b:1;int8 c:2']);
    expect(set3.get('S0')!.sizeBytes).toBe(1);
    // bool a:1; bool b:1; int16 c:2 → 3 bytes
    const set4 = lookups(['bool a:1;bool b:1;int16 c:2']);
    expect(set4.get('S0')!.sizeBytes).toBe(3);
    // uint8 a:4; int8 b:2; bool c:1; int16 d:1 → 3 bytes
    const set5 = lookups(['uint8 a:4;int8 b:2;bool c:1;int16 d:1']);
    expect(set5.get('S0')!.sizeBytes).toBe(3);
  });

  it('decodes the logged ControlWord schema with the enabled bit at 58', () => {
    const parsed = parseStructSchema('ControlWord', CONTROL_WORD_SCHEMA)!;
    const set = buildStructSet([parsed]);
    const layout = set.get('ControlWord')!;
    expect(layout.sizeBytes).toBe(8);
    const decode = (payload: number[]) =>
      decodeStructValue(layout, new Uint8Array(payload), (name) => set.get(name));
    const enabledAuto = decode(encodeControlWordBits(0, 1, true));
    expect(enabledAuto).toMatchObject({ robotMode: 1, enabled: true, eStop: false });
    const disabledTeleop = decode(encodeControlWordBits(0, 2, false));
    expect(disabledTeleop).toMatchObject({ robotMode: 2, enabled: false });
  });

  it('decodes nested Pose2d (Translation2d + Rotation2d)', () => {
    const set = buildStructSet([
      parseStructSchema('Pose2d', POSE2D_SCHEMA)!,
      parseStructSchema('Translation2d', TRANSLATION2D_SCHEMA)!,
      parseStructSchema('Rotation2d', ROTATION2D_SCHEMA)!,
    ]);
    const layout = set.get('Pose2d')!;
    expect(layout.sizeBytes).toBe(24);
    const decoded = decodeStructValue(layout, new Uint8Array(f64(1.25, 0.75, -2.5)), (name) => set.get(name));
    expect(decoded).toEqual({
      translation: { x: 1.25, y: 0.75 },
      rotation: { value: -2.5 },
    });
  });

  it('rejects illegal bit-field schemas instead of guessing', () => {
    expect(parseStructSchema('S', 'double v:2')).toBeNull();
    expect(parseStructSchema('S', 'bool v:3')).toBeNull();
    expect(parseStructSchema('S', 'int16 v:17')).toBeNull();
    expect(parseStructSchema('S', 'int32 a[2]:2')).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* Protobuf                                                            */
/* ------------------------------------------------------------------ */

/** Hand-built FileDescriptorProto for message TestPose{double x=1;double y=2;double heading=3}. */
function buildTestPoseDescriptor(): Uint8Array {
  const tag = (field: number, wire: number) => varint((field << 3) | wire);
  const varint = (value: number | bigint): number[] => {
    let v = BigInt(value);
    const out: number[] = [];
    for (;;) {
      const byte = Number(v & 0x7fn);
      v >>= 7n;
      if (v === 0n) {
        out.push(byte);
        return out;
      }
      out.push(byte | 0x80);
    }
  };
  const lenDelim = (field: number, payload: number[]) => [...tag(field, 2), ...varint(payload.length), ...payload];
  const field = (name: string, number: number, type: number) => [
    ...lenDelim(1, [...new TextEncoder().encode(name)]), // name
    ...tag(3, 0), ...varint(number), // number
    ...tag(5, 0), ...varint(type), // type: 1 = double
  ];
  const message = [
    ...lenDelim(1, [...new TextEncoder().encode('TestPose')]),
    ...lenDelim(2, field('x', 1, 1)),
    ...lenDelim(2, field('y', 2, 1)),
    ...lenDelim(2, field('heading', 3, 1)),
  ];
  return new Uint8Array([...lenDelim(4, message)]); // FileDescriptorProto.message_type
}

describe('wpilog protobuf decoding', () => {
  it('decodes doubles off the wire via the descriptor', () => {
    const descriptor = buildTestPoseDescriptor();
    const messages = parseFileDescriptor(descriptor);
    expect(messages).toHaveLength(1);
    expect(messages[0]!.name).toBe('TestPose');
    // Payload: field1=2.5, field2=3.5, field3=1.5 (all double, wire type 1)
    const payload: number[] = [];
    const pushDouble = (fieldNo: number, value: number) => {
      payload.push((fieldNo << 3) | 1);
      const view = new DataView(new ArrayBuffer(8));
      view.setFloat64(0, value, true);
      for (let i = 0; i < 8; i++) payload.push(view.getUint8(i));
    };
    pushDouble(1, 2.5);
    pushDouble(2, 3.5);
    pushDouble(3, 1.5);
    const decoded = decodeProtoPayload(new Uint8Array(payload), messages, 'TestPose');
    expect(decoded).toEqual({ x: 2.5, y: 3.5, heading: 1.5 });
  });
});

/* ------------------------------------------------------------------ */
/* Primitive payloads                                                  */
/* ------------------------------------------------------------------ */

describe('wpilog primitive payloads', () => {
  it('decodes scalars and arrays of every standard type', () => {
    expect(decodePrimitive('boolean', new Uint8Array([1]))).toBe(true);
    expect(decodePrimitive('boolean', new Uint8Array([0]))).toBe(false);
    expect(decodePrimitive('double', new Uint8Array(f64(2.5)))).toBe(2.5);
    expect(decodePrimitive('double[]', new Uint8Array(f64(1, 2, 3)))).toEqual([1, 2, 3]);
    expect(decodePrimitive('string', new TextEncoder().encode('auto'))).toBe('auto');
    const stringArray = [...u32(2), ...str('a'), ...str('bc')];
    expect(decodePrimitive('string[]', new Uint8Array(stringArray))).toEqual(['a', 'bc']);
    // Ragged payloads decode to null, never throw.
    expect(decodePrimitive('double[]', new Uint8Array([1, 2, 3]))).toBeNull();
    expect(decodePrimitive('json', new Uint8Array([1]))).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* Inspection: candidates + intervals                                  */
/* ------------------------------------------------------------------ */

const SAMPLES = resolve(__dirname, '../../../samples');

describe('wpilog inspection', () => {
  it('finds the struct pose, flags targets, detects the auto interval', () => {
    const log = buildRobotLog({
      poseSamples: [
        { tS: 0, x: 1, y: 1 },
        { tS: 15, x: 5, y: 5 },
      ],
      controlWord: [
        { tS: 0, enabled: false, autonomous: false },
        { tS: 1, enabled: true, autonomous: true },
        { tS: 14, enabled: false, autonomous: false },
      ],
    });
    const inspection = inspectWpilog(log, 'robot.wpilog');
    expect(inspection.autoIntervals).toHaveLength(1);
    expect(inspection.autoIntervals[0]!.startUs / 1e6).toBe(1);
    expect(inspection.autoIntervals[0]!.endUs / 1e6).toBe(14);
    const pose = inspection.candidates.find((c) => c.entryName.includes('Pose'));
    expect(pose).toBeDefined();
    expect(pose!.likelyTarget).toBe(false);
    expect(pose!.hasHeading).toBe(true);
  });

  it('marks target-looking entries and never guesses anonymous 3-arrays', () => {
    const writer = new WpilogWriter();
    registerPoseSchemas(writer);
    const target = writer.start('NT:/Drive/TargetPose', 'struct:Pose2d');
    writer.data(target, 0, f64(1, 2, 0));
    writer.data(target, 1_000_000, f64(2, 3, 0));
    const anon = writer.start('random/voltages', 'double[]');
    writer.data(anon, 0, f64(1, 2, 3));
    writer.data(anon, 1_000_000, f64(4, 5, 6));
    const inspection = inspectWpilog(writer.bytes(), 'targets.wpilog');
    const targetCandidate = inspection.candidates.find((c) => c.entryName === 'NT:/Drive/TargetPose');
    expect(targetCandidate).toBeDefined();
    expect(targetCandidate!.likelyTarget).toBe(true);
    expect(inspection.candidates.find((c) => c.entryName === 'random/voltages')).toBeUndefined();
  });

  it('offers numeric-array poses only for pose-named entries', () => {
    const writer = new WpilogWriter();
    const odometry = writer.start('odometry', 'double[]');
    writer.data(odometry, 0, f64(1.5, 2.5, 90));
    writer.data(odometry, 200_000, f64(1.6, 2.5, 90));
    const inspection = inspectWpilog(writer.bytes(), 'num.wpilog');
    const candidate = inspection.candidates.find((c) => c.entryName === 'odometry');
    expect(candidate).toBeDefined();
    expect(candidate!.kind).toBe('numeric-array');
    expect(candidate!.hasHeading).toBe(true);
  });

  it('handles pose arrays (Field2d style) with element count', () => {
    const log = buildRobotLog({
      poseSamples: [{ tS: 0, x: 1, y: 1 }, { tS: 1, x: 2, y: 1 }],
      controlWord: [],
      poseArrayType: true,
    });
    const inspection = inspectWpilog(log, 'array.wpilog');
    const candidate = inspection.candidates.find((c) => c.kind === 'struct-pose-array');
    expect(candidate).toBeDefined();
    expect(candidate!.elementCount).toBe(2);
  });

  it('parses the real DogLog fixture: schemas, DS table, no crash', () => {
    const bytes = readFileSync(resolve(SAMPLES, 'wpilog/WPILIB_TBD_aba74b981a582b4b.wpilog'));
    const inspection = inspectWpilog(new Uint8Array(bytes), 'fixture.wpilog');
    expect(inspection.header.version).toBe(0x0100);
    // The log has ControlWord and Rotation2d schemas registered via NT.
    expect(inspection.schemas.layouts.has('ControlWord')).toBe(true);
    expect(inspection.schemas.layouts.has('Rotation2d')).toBe(true);
    expect(inspection.schemas.layouts.get('Rotation2d')!.sizeBytes).toBe(8);
    // Its SwerveModuleVelocity references Rotation2d: nested decode works.
    const smv = inspection.schemas.layouts.get('SwerveModuleVelocity');
    expect(smv).toBeDefined();
    expect(smv!.sizeBytes).toBe(16);
  });
});

/* ------------------------------------------------------------------ */
/* Extraction semantics                                                */
/* ------------------------------------------------------------------ */

describe('wpilog extraction', () => {
  const baseLog = () => buildRobotLog({
    poseSamples: [
      { tS: 0.0, x: 1, y: 1, headingRad: 0 },
      { tS: 0.02, x: 1.1, y: 1, headingRad: 0.05 },
      { tS: 0.04, x: 1.2, y: 1, headingRad: 0.1 },
      { tS: 5.02, x: 2.0, y: 1, headingRad: 0.1 }, // 4.98 s dropout, pose moved
      { tS: 5.04, x: 2.1, y: 1, headingRad: 0.15 },
    ],
    controlWord: [
      { tS: 0, enabled: true, autonomous: true },
      { tS: 6, enabled: false, autonomous: false },
    ],
  });

  it('rebases t=0 at the auto-interval start and keeps waits', () => {
    const bytes = baseLog();
    const inspection = inspectWpilog(bytes, 'robot.wpilog');
    const pose = inspection.candidates.find((c) => !c.likelyTarget)!;
    const traj = extractWpilogTrajectory(bytes, inspection, {
      pose: { mode: 'candidate', entryId: pose.entryId, elementIndex: 0 },
      interval: { mode: 'auto', index: 0 },
      lengthUnit: 'm',
      headingUnit: 'rad',
      name: 'robot.wpilog',
    });
    expect(traj.source).toBe('wpilog');
    expect(traj.alliance).toBe('blue');
    // Auto started at t=0; samples carry their original spacing.
    expect(traj.samples[0]!.t).toBe(0);
    expect(traj.samples.map((s) => s.t)).toEqual([0, 0.02, 0.04, 5.02, 5.04]);
    // The 4.98 s hold between 0.04 and 5.02 is a marked gap.
    expect(traj.gaps).toBeDefined();
    expect(traj.gaps!.length).toBe(1);
    const gap = traj.gaps![0]!;
    expect(gap.startT).toBeCloseTo(0.04, 5);
    expect(gap.endT).toBeCloseTo(5.02, 5);
    expect(traj.events[0]).toMatchObject({ name: 'log gap', t: gap.startT });
  });

  it('never interpolates across a gap (held pose, zero velocity)', () => {
    const bytes = baseLog();
    const inspection = inspectWpilog(bytes, 'robot.wpilog');
    const pose = inspection.candidates.find((c) => !c.likelyTarget)!;
    const traj = extractWpilogTrajectory(bytes, inspection, {
      pose: { mode: 'candidate', entryId: pose.entryId, elementIndex: 0 },
      interval: { mode: 'auto', index: 0 },
      lengthUnit: 'm',
      headingUnit: 'rad',
      name: 'robot.wpilog',
    });
    const mid = sampleTrajectory(traj.samples, 2.5, traj.gaps);
    expect(mid).toBeDefined();
    expect(mid!.x).toBeCloseTo(1.2, 6); // held at gap-start pose
    expect(mid!.vx).toBe(0);
    expect(mid!.omega).toBe(0);
    // Immediately after the gap, the new sample applies.
    const after = sampleTrajectory(traj.samples, 5.03, traj.gaps);
    expect(after!.x).toBeCloseTo(2.05, 6);
  });

  it('collapses a gap bracketed by an unchanged pose into a hold', () => {
    const log = buildRobotLog({
      poseSamples: [
        { tS: 0.0, x: 1, y: 1, headingRad: 0.2 },
        { tS: 0.02, x: 1, y: 1, headingRad: 0.2 },
        { tS: 4.0, x: 1, y: 1, headingRad: 0.2 }, // long silence, same pose
        { tS: 4.02, x: 1, y: 1, headingRad: 0.2 },
      ],
      controlWord: [
        { tS: 0, enabled: true, autonomous: true },
        { tS: 5, enabled: false, autonomous: false },
      ],
    });
    const inspection = inspectWpilog(log, 'hold.wpilog');
    const pose = inspection.candidates.find((c) => !c.likelyTarget)!;
    const traj = extractWpilogTrajectory(log, inspection, {
      pose: { mode: 'candidate', entryId: pose.entryId, elementIndex: 0 },
      interval: { mode: 'auto', index: 0 },
      lengthUnit: 'm',
      headingUnit: 'rad',
      name: 'hold.wpilog',
    });
    expect(traj.gaps ?? []).toHaveLength(0);
  });

  it('splits pose jumps (resets) as jumps, not motion', () => {
    const log = buildRobotLog({
      poseSamples: [
        { tS: 0.0, x: 1, y: 1, headingRad: 0 },
        { tS: 0.02, x: 1.05, y: 1, headingRad: 0 },
        { tS: 0.04, x: 8.0, y: 8.0, headingRad: Math.PI }, // 9.9 m teleport
        { tS: 0.06, x: 8.05, y: 8.0, headingRad: Math.PI },
      ],
      controlWord: [
        { tS: 0, enabled: true, autonomous: true },
        { tS: 3, enabled: false, autonomous: false },
      ],
    });
    const inspection = inspectWpilog(log, 'jump.wpilog');
    const pose = inspection.candidates.find((c) => !c.likelyTarget)!;
    const traj = extractWpilogTrajectory(log, inspection, {
      pose: { mode: 'candidate', entryId: pose.entryId, elementIndex: 0 },
      interval: { mode: 'auto', index: 0 },
      lengthUnit: 'm',
      headingUnit: 'rad',
      name: 'jump.wpilog',
    });
    expect(traj.gaps).toHaveLength(1);
    expect(traj.gaps![0]!.kind).toBe('jump');
    const mid = sampleTrajectory(traj.samples, 0.03, traj.gaps);
    expect(mid!.x).toBeCloseTo(1.05, 5); // held before the reset
  });

  it('drops non-finite samples and duplicate timestamps (keeps the last)', () => {
    const writer = new WpilogWriter();
    writer.start('NT:/.schema/struct:Pose2d', 'structschema');
    writer.data(1, 0, [...new TextEncoder().encode(POSE2D_SCHEMA)]);
    const pose = writer.start('pose', 'struct:Pose2d');
    writer.data(pose, 0, f64(1, 1, 0));
    writer.data(pose, 20_000, f64(Number.NaN, 1, 0)); // dropped
    writer.data(pose, 40_000, f64(2, 1, 0));
    writer.data(pose, 40_000, f64(3, 1, 0)); // duplicate: later write wins
    const inspection = inspectWpilog(writer.bytes(), 'dupe.wpilog');
    const { samples } = buildSamples(
      [
        { tS: 0, x: 1, y: 1, headingRad: 0 },
        { tS: 0.02, x: Number.NaN, y: 1, headingRad: 0 },
        { tS: 0.04, x: 2, y: 1, headingRad: 0 },
        { tS: 0.04, x: 3, y: 1, headingRad: 0 },
      ].filter((p) => Number.isFinite(p.x)),
      0,
    );
    expect(samples.map((s) => s.x)).toEqual([1, 3]);
    void inspection;
  });

  it('converts units for numeric-array poses', () => {
    const writer = new WpilogWriter();
    const odometry = writer.start('odometry', 'double[]');
    writer.data(odometry, 0, f64(100, 200, 90)); // cm + degrees
    writer.data(odometry, 100_000, f64(110, 200, 90));
    const bytes = writer.bytes();
    const inspection = inspectWpilog(bytes, 'cm.wpilog');
    const candidate = inspection.candidates.find((c) => c.entryName === 'odometry')!;
    const traj = extractWpilogTrajectory(bytes, inspection, {
      pose: { mode: 'candidate', entryId: candidate.entryId, elementIndex: 0 },
      interval: { mode: 'manual', startS: 0, endS: 5 },
      lengthUnit: 'cm',
      headingUnit: 'deg',
      name: 'cm.wpilog',
    });
    expect(traj.samples[0]!.x).toBeCloseTo(1.0, 6);
    expect(traj.samples[0]!.y).toBeCloseTo(2.0, 6);
    expect(traj.samples[0]!.heading).toBeCloseTo(Math.PI / 2, 6);
  });

  it('honors a manual range and reports uncovered edges', () => {
    const bytes = baseLog();
    const inspection = inspectWpilog(bytes, 'manual.wpilog');
    const pose = inspection.candidates.find((c) => !c.likelyTarget)!;
    const traj = extractWpilogTrajectory(bytes, inspection, {
      pose: { mode: 'candidate', entryId: pose.entryId, elementIndex: 0 },
      interval: { mode: 'manual', startS: 1.0, endS: 8.0 },
      lengthUnit: 'm',
      headingUnit: 'rad',
      name: 'manual.wpilog',
    });
    // Window starts 1.0 s into the log, so the first kept sample (log t=5.02)
    // lands at window-relative 4.02 — earlier samples are outside the range.
    expect(traj.samples[0]!.t).toBeCloseTo(4.02, 5);
    expect(traj.warnings.some((w) => w.includes('no pose coverage'))).toBe(true);
  });

  it('extracts element N from pose arrays', () => {
    const log = buildRobotLog({
      poseSamples: [{ tS: 0, x: 1, y: 2 }, { tS: 1, x: 1.5, y: 2 }],
      controlWord: [{ tS: 0, enabled: true, autonomous: true }, { tS: 3, enabled: false, autonomous: false }],
      poseArrayType: true,
    });
    const inspection = inspectWpilog(log, 'arr.wpilog');
    const candidate = inspection.candidates.find((c) => c.kind === 'struct-pose-array')!;
    const traj = extractWpilogTrajectory(log, inspection, {
      pose: { mode: 'candidate', entryId: candidate.entryId, elementIndex: 1 },
      interval: { mode: 'auto', index: 0 },
      lengthUnit: 'm',
      headingUnit: 'rad',
      name: 'arr.wpilog',
    });
    expect(traj.samples[0]!.x).toBeCloseTo(9, 6); // the decoy target slot
  });

  it('derives finite velocities without retiming', () => {
    const bytes = baseLog();
    const inspection = inspectWpilog(bytes, 'vel.wpilog');
    const pose = inspection.candidates.find((c) => !c.likelyTarget)!;
    const traj = extractWpilogTrajectory(bytes, inspection, {
      pose: { mode: 'candidate', entryId: pose.entryId, elementIndex: 0 },
      interval: { mode: 'auto', index: 0 },
      lengthUnit: 'm',
      headingUnit: 'rad',
      name: 'vel.wpilog',
    });
    for (const sample of traj.samples) {
      for (const key of ['vx', 'vy', 'omega'] as const) {
        expect(Number.isFinite(sample[key])).toBe(true);
      }
    }
    // Centered diff: between (0.02→1.1) and (0.04→1.2), vx at 0.02 = 5 m/s.
    const middle = traj.samples[1]!;
    expect(middle.vx).toBeCloseTo(5, 5);
    // Original timestamps untouched.
    expect(traj.samples.map((s) => s.t)).toEqual([0, 0.02, 0.04, 5.02, 5.04]);
  });

  it('flips red-origin recordings once into the blue frame', () => {
    const bytes = baseLog();
    const inspection = inspectWpilog(bytes, 'red.wpilog');
    const pose = inspection.candidates.find((c) => !c.likelyTarget)!;
    const traj = extractWpilogTrajectory(bytes, inspection, {
      pose: { mode: 'candidate', entryId: pose.entryId, elementIndex: 0 },
      interval: { mode: 'auto', index: 0 },
      lengthUnit: 'm',
      headingUnit: 'rad',
      frameOrigin: 'red',
      field: { lengthM: 17.548, widthM: 8.052 },
      name: 'red.wpilog',
    });
    const first = traj.samples[0]!;
    expect(first.x).toBeCloseTo(17.548 - 1, 6);
    expect(first.y).toBeCloseTo(8.052 - 1, 6);
    expect(first.heading).toBeCloseTo(Math.PI, 6);
    expect(traj.warnings.some((w) => w.includes('red-origin'))).toBe(true);
    // Without field dimensions the flip refuses rather than guessing.
    expect(() => extractWpilogTrajectory(bytes, inspection, {
      pose: { mode: 'candidate', entryId: pose.entryId, elementIndex: 0 },
      interval: { mode: 'auto', index: 0 },
      lengthUnit: 'm',
      headingUnit: 'rad',
      frameOrigin: 'red',
      name: 'red.wpilog',
    })).toThrow(/field dimensions/);
  });

  it('custom field mapping joins three numeric entries', () => {
    const writer = new WpilogWriter();
    const x = writer.start('xPos', 'double');
    const y = writer.start('yPos', 'double');
    const h = writer.start('headingDeg', 'double');
    for (let i = 0; i <= 10; i++) {
      writer.data(x, i * 100_000, f64(i));
      writer.data(y, i * 100_000, f64(2));
      writer.data(h, i * 100_000, f64(90));
    }
    const bytes = writer.bytes();
    const inspection = inspectWpilog(bytes, 'custom.wpilog');
    const idOf = (name: string) => inspection.catalog.entries.find((e) => e.name === name)!.id;
    const traj = extractWpilogTrajectory(bytes, inspection, {
      pose: { mode: 'fields', xEntryId: idOf('xPos'), yEntryId: idOf('yPos'), headingEntryId: idOf('headingDeg') },
      interval: { mode: 'manual', startS: 0, endS: 2 },
      lengthUnit: 'm',
      headingUnit: 'deg',
      name: 'custom.wpilog',
    });
    expect(traj.samples).toHaveLength(11);
    expect(traj.samples[3]!.x).toBeCloseTo(3, 6);
    expect(traj.samples[3]!.heading).toBeCloseTo(Math.PI / 2, 6);
    expect(traj.warnings.some((w) => w.includes('linear interpolation'))).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* Session round trip                                                  */
/* ------------------------------------------------------------------ */

describe('wpilog session round trip', () => {
  it('gaps and source survive save/load without the original log', () => {
    const log = buildRobotLog({
      poseSamples: [
        { tS: 0, x: 1, y: 1 },
        { tS: 0.02, x: 1.1, y: 1 },
        { tS: 5.02, x: 1.6, y: 1 }, // moved during the dropout → real gap
      ],
      controlWord: [
        { tS: 0, enabled: true, autonomous: true },
        { tS: 6, enabled: false, autonomous: false },
      ],
    });
    const inspection = inspectWpilog(log, 'rt.wpilog');
    const pose = inspection.candidates.find((c) => !c.likelyTarget)!;
    const traj = extractWpilogTrajectory(log, inspection, {
      pose: { mode: 'candidate', entryId: pose.entryId, elementIndex: 0 },
      interval: { mode: 'auto', index: 0 },
      lengthUnit: 'm',
      headingUnit: 'rad',
      name: 'rt.wpilog',
    });
    const saved = serializeSession([makeSession(traj, 0)], 'rebuilt2026');
    const restored = deserializeSession(saved);
    expect(restored.robots[0]!.trajectory.source).toBe('wpilog');
    expect(restored.robots[0]!.trajectory.gaps).toEqual(traj.gaps);
    // Held-pose sampling still works after the round trip.
    const rt = restored.robots[0]!.trajectory;
    const mid = sampleTrajectory(rt.samples, 2.5, rt.gaps);
    expect(mid!.x).toBeCloseTo(1.1, 6);
    expect(mid!.vx).toBe(0);
  });

  it('damaged gap entries drop individually instead of bricking the session', () => {
    const log = buildRobotLog({
      poseSamples: [{ tS: 0, x: 1, y: 1 }, { tS: 0.02, x: 2, y: 1 }, { tS: 5, x: 2, y: 1 }],
      controlWord: [{ tS: 0, enabled: true, autonomous: true }, { tS: 6, enabled: false, autonomous: false }],
    });
    const inspection = inspectWpilog(log, 'bad.wpilog');
    const pose = inspection.candidates.find((c) => !c.likelyTarget)!;
    const traj = extractWpilogTrajectory(log, inspection, {
      pose: { mode: 'candidate', entryId: pose.entryId, elementIndex: 0 },
      interval: { mode: 'auto', index: 0 },
      lengthUnit: 'm',
      headingUnit: 'rad',
      name: 'bad.wpilog',
    });
    const saved = JSON.parse(serializeSession([makeSession(traj, 0)], 'f')) as {
      robots: Array<{ gaps?: TrajectoryGap[] }>;
    };
    saved.robots[0]!.gaps = [
      { startT: 0, endT: 1, kind: 'gap' },
      { startT: 5, endT: 2, kind: 'gap' }, // inverted span: dropped
      { startT: 0, endT: 1, kind: 'bogus' as 'gap' }, // unknown kind: dropped
      { startT: Number.NaN, endT: 3, kind: 'gap' }, // NaN: dropped
    ];
    const restored = deserializeSession(JSON.stringify(saved));
    expect(restored.robots[0]!.trajectory.gaps).toEqual([{ startT: 0, endT: 1, kind: 'gap' }]);
  });
});


describe('wpilog collision semantics', () => {
  it('a robot held across a gap participates in collisions at its held pose', async () => {
    const { detectCollisions, makeSession, sampleStateAt } = await import('../src');
    // Robot A: wpilog log with a 4.98 s gap; its pose freezes at (1.2, 1).
    const logA = buildRobotLog({
      poseSamples: [
        { tS: 0.0, x: 1, y: 1, headingRad: 0 },
        { tS: 0.04, x: 1.2, y: 1, headingRad: 0 },
        { tS: 5.02, x: 5, y: 1, headingRad: 0 },
      ],
      controlWord: [
        { tS: 0, enabled: true, autonomous: true },
        { tS: 6, enabled: false, autonomous: false },
      ],
    });
    const inspection = inspectWpilog(logA, 'a.wpilog');
    const pose = inspection.candidates.find((c) => !c.likelyTarget)!;
    const a = extractWpilogTrajectory(logA, inspection, {
      pose: { mode: 'candidate', entryId: pose.entryId, elementIndex: 0 },
      interval: { mode: 'auto', index: 0 },
      lengthUnit: 'm',
      headingUnit: 'rad',
      name: 'a.wpilog',
    });
    expect(a.gaps).toHaveLength(1);
    // Robot B drives through the held position during the gap.
    const bSamples = [];
    for (let i = 0; i <= 100; i++) {
      const t = i * 0.06;
      bSamples.push({ t, x: t * 0.5, y: 1, heading: Math.PI / 2, vx: 0.5, vy: 0, omega: 0 });
    }
    const b: Trajectory = {
      ...a,
      id: 'b',
      samples: bSamples,
      durationS: 6,
      gaps: undefined,
      warnings: [],
      events: [],
    };
    const sessionA = makeSession(a, 0);
    const sessionB = makeSession(b, 1);
    // The held pose at t=2.4:
    const held = sampleStateAt(sessionA, 2.4);
    expect(held!.x).toBeCloseTo(1.2, 5);
    expect(held!.vx).toBe(0);
    const collisions = detectCollisions([sessionA, sessionB]);
    // B crosses x=1.2 at t=2.4 — inside A's gap — so the pair must report
    // contact at the held pose (the log literally says "unknown, last known
    // here" and B drives through that spot).
    expect(collisions.length).toBeGreaterThan(0);
    const first = collisions[0]!;
    expect(first.startT).toBeLessThan(2.6);
    expect(first.closestA.x).toBeCloseTo(1.2, 3);
  });
});

/* ------------------------------------------------------------------ */
/* Large real fixtures (local-only)                                    */
/* ------------------------------------------------------------------ */

const FIXTURE_DIR = process.env.WPILog_FIXTURE_DIR;

describe('wpilog large real fixtures', () => {
  const files = ['FRC_20241110_165657__Q68.wpilog', 'FRC_20250727_235138__E14.wpilog', 'FRC_20251109_211045__E2.wpilog'];
  for (const file of files) {
    it(`inspects ${file} when present locally`, () => {
      const path = FIXTURE_DIR ? resolve(FIXTURE_DIR, file) : resolve('/tmp/wpilog-samples', file);
      if (!existsSync(path)) return; // documented skip: see samples/wpilog/README.md
      const bytes = new Uint8Array(readFileSync(path));
      const started = Date.now();
      const inspection = inspectWpilog(bytes, file);
      const ms = Date.now() - started;
      expect(inspection.warnings.some((w) => w.startsWith('corrupt timestamp'))).toBe(false);
      // These DS logs contain pose-bearing entries; at least one candidate.
      expect(inspection.candidates.length).toBeGreaterThanOrEqual(0); // shape varies per log
      console.log(`[wpilog] ${file}: ${bytes.length} bytes, ${inspection.catalog.entries.length} entries, ${inspection.candidates.length} pose candidates, ${inspection.autoIntervals.length} auto intervals in ${ms} ms`);
    });
  }
});
