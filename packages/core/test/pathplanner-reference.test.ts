/**
 * Task 8 (plan: docs/superpowers/plans/2026-11-07-pathplanner-profile-timing):
 * self-gating acceptance against the pinned official PathPlanner v2025.2.7
 * references in samples/pathplanner/reference (manifest-driven; provenance,
 * tolerances and the fixture protocol live in that directory's README).
 *
 * Gate semantics: with no fixtures the acceptance suite is skipped and one
 * gate test documents the closed gate — this file by itself never claims
 * official alignment. The loader/comparator behavior is unit-tested below
 * with constructed fixtures in temp directories; those are synthetic and
 * assert nothing official (externally-unverifiable rule from the task brief).
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  applyProfileToTrajectory,
  generateAutoTrajectory,
  parseAutoStructure,
  parsePathPlannerPath,
  parseRobotProfile,
  resolveRobotConfig,
  sampleTrajectory,
  trajectoryDuration,
} from '../src';
import type { ParsedAuto, RobotProfile, TrajectorySample } from '../src';

// ---------------------------------------------------------------------------
// Harness types + declared tolerances (README records the basis; the manifest
// may override per run — any relaxation must carry a reason there).
// ---------------------------------------------------------------------------

interface GoldenState {
  t: number;
  x: number;
  y: number;
  /** Holonomic pose rotation (what this repo calls TrajectorySample.heading). */
  holonomicRotDeg: number;
  linearVelocity: number;
}

interface CapRule {
  maxVelocityMPS: number;
  /** Window bounds in seconds; omitted = the whole timeline. */
  fromT?: number;
  toT?: number;
}

interface JoinRule {
  /** A declared hold: the robot must stand still ~this long at this pose. */
  holdSeconds: number;
  x: number;
  y: number;
}

interface ExpectedCase {
  durationS?: number;
  startSpeedMPS?: number;
  endSpeedMPS?: number;
  endX?: number;
  endY?: number;
  endHeadingDeg?: number;
  maxSpeedMPS?: number;
  peakAccelMPSSq?: number;
  caps?: CapRule[];
  joins?: JoinRule[];
}

interface Tolerances {
  durationRelTol: number;
  positionTolM: number;
  headingTolDeg: number;
  speedTolMPS: number;
  accelTolMPSS: number;
  holdSpeedMPS: number;
  holdMinFraction: number;
  holdMaxOvershootS: number;
}

const DEFAULT_TOLERANCES: Tolerances = {
  durationRelTol: 0.02,
  positionTolM: 0.05,
  headingTolDeg: 3,
  speedTolMPS: 0.2,
  accelTolMPSS: 0.5,
  holdSpeedMPS: 0.05,
  holdMinFraction: 0.75,
  holdMaxOvershootS: 0.5,
};

interface CaseManifest {
  name: string;
  kind: 'path' | 'auto';
  pathFile?: string;
  autoFile?: string;
  /** Referenced .path files for a kind:'auto' case, resolved by stem. */
  pathFiles?: string[];
  settingsFile: string;
  goldenFile?: string;
  /** fileName → sha256; every listed file is verified before the case loads. */
  sha256?: Record<string, string>;
  expected: ExpectedCase;
}

interface LoadedFixture {
  name: string;
  kind: 'path' | 'auto';
  dir: string;
  settingsText: string;
  pathFile?: string;
  pathText?: string;
  autoFile?: string;
  autoText?: string;
  autoPathTexts: Map<string, string>;
  goldenStates: GoldenState[];
  expected: ExpectedCase;
  tolerances: Tolerances;
}

interface RunResult {
  samples: TrajectorySample[];
  durationS: number;
}

// ---------------------------------------------------------------------------
// Harness implementation (loader → repo pipeline → per-dimension comparators).
// ---------------------------------------------------------------------------

function sha256Of(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function readFixtureFile(dir: string, file: string, caseName: string): string {
  const path = join(dir, file);
  if (!existsSync(path)) {
    throw new Error(`reference fixture "${caseName}" references missing file: ${file}`);
  }
  return readFileSync(path, 'utf-8');
}

function loadReferenceFixtures(dir: string): LoadedFixture[] {
  const manifestPath = join(dir, 'manifest.json');
  // An absent or empty manifest means zero fixtures — the gate stays closed.
  if (!existsSync(manifestPath)) return [];
  let manifest: { tolerances?: Partial<Tolerances>; cases?: CaseManifest[] };
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as typeof manifest;
  } catch (e) {
    // A corrupt manifest must fail loudly, never silently close the gate.
    throw new Error(
      `reference manifest is malformed (${manifestPath}): ${e instanceof Error ? e.message : e}`,
    );
  }
  const tolerances: Tolerances = { ...DEFAULT_TOLERANCES, ...manifest.tolerances };
  const fixtures: LoadedFixture[] = [];
  for (const c of manifest.cases ?? []) {
    const settingsText = readFixtureFile(dir, c.settingsFile, c.name);
    for (const [file, expected] of Object.entries(c.sha256 ?? {})) {
      if (sha256Of(join(dir, file)) !== expected) {
        throw new Error(
          `sha256 mismatch for ${file} in reference fixture "${c.name}" — pinned fixture bytes changed`,
        );
      }
    }
    let goldenStates: GoldenState[] = [];
    if (c.goldenFile !== undefined) {
      const golden = JSON.parse(readFixtureFile(dir, c.goldenFile, c.name)) as {
        states?: unknown[];
      };
      goldenStates = (golden.states ?? []).map((raw, i) => {
        const s = raw as Record<string, unknown>;
        const state: GoldenState = {
          t: Number(s['t']),
          x: Number(s['x']),
          y: Number(s['y']),
          holonomicRotDeg: Number(s['holonomicRotDeg']),
          linearVelocity: Number(s['linearVelocity']),
        };
        if (Object.values(state).some((v) => !Number.isFinite(v))) {
          throw new Error(`golden state ${i} of fixture "${c.name}" is malformed`);
        }
        return state;
      });
    }
    const autoPathTexts = new Map<string, string>();
    if (c.kind === 'path' && c.pathFile !== undefined) {
      fixtures.push({
        name: c.name,
        kind: 'path',
        dir,
        settingsText,
        pathFile: c.pathFile,
        pathText: readFixtureFile(dir, c.pathFile, c.name),
        autoPathTexts,
        goldenStates,
        expected: c.expected ?? {},
        tolerances,
      });
    } else if (c.kind === 'auto' && c.autoFile !== undefined) {
      for (const pf of c.pathFiles ?? []) {
        autoPathTexts.set(pf.replace(/\.path$/i, ''), readFixtureFile(dir, pf, c.name));
      }
      fixtures.push({
        name: c.name,
        kind: 'auto',
        dir,
        settingsText,
        autoFile: c.autoFile,
        autoText: readFixtureFile(dir, c.autoFile, c.name),
        autoPathTexts,
        goldenStates,
        expected: c.expected ?? {},
        tolerances,
      });
    } else {
      throw new Error(
        `reference fixture "${c.name}" is neither a path case with pathFile nor an auto case with autoFile`,
      );
    }
  }
  return fixtures;
}

function runFixture(fixture: LoadedFixture): RunResult {
  const profile: RobotProfile | null = parseRobotProfile(
    fixture.settingsText,
    join(fixture.name, 'settings.json'),
  );
  if (!profile) {
    throw new Error(`reference fixture "${fixture.name}": settings did not parse as a robot profile`);
  }
  if (fixture.kind === 'path') {
    const traj = parsePathPlannerPath(fixture.pathText!, fixture.pathFile!);
    const applied = applyProfileToTrajectory(traj, profile);
    return { samples: applied.samples, durationS: applied.durationS };
  }
  const auto: ParsedAuto = parseAutoStructure(
    fixture.autoText!,
    fixture.autoFile!,
    (pathName) => fixture.autoPathTexts.get(pathName),
  );
  const { config } = resolveRobotConfig(profile);
  const generated = generateAutoTrajectory(auto, config);
  return { samples: generated.samples, durationS: trajectoryDuration(generated.samples) };
}

const DEG = 180 / Math.PI;
const speedOf = (s: TrajectorySample): number => Math.hypot(s.vx, s.vy);

function angleDeltaDeg(aDeg: number, bDeg: number): number {
  const d = Math.abs(aDeg - bDeg) % 360;
  return d > 180 ? 360 - d : d;
}

function checkDuration(run: RunResult, fixture: LoadedFixture): string[] {
  const want = fixture.expected.durationS;
  if (want === undefined) return [];
  const err = Math.abs(run.durationS - want) / want;
  if (err <= fixture.tolerances.durationRelTol) return [];
  return [
    `total duration ${run.durationS.toFixed(6)}s vs official ${want}s — ${(err * 100).toFixed(2)}% off, tolerance ±${(fixture.tolerances.durationRelTol * 100).toFixed(1)}%`,
  ];
}

function checkEndpoints(run: RunResult, fixture: LoadedFixture): string[] {
  const first = run.samples[0];
  const last = run.samples.at(-1);
  if (!first || !last) return ['no samples to check endpoints'];
  const tol = fixture.tolerances;
  const expected = fixture.expected;
  const violations: string[] = [];
  if (expected.startSpeedMPS !== undefined) {
    const err = Math.abs(speedOf(first) - expected.startSpeedMPS);
    if (err > tol.speedTolMPS) {
      violations.push(
        `start speed ${speedOf(first).toFixed(3)} vs official ${expected.startSpeedMPS} m/s — ${err.toFixed(3)} off (±${tol.speedTolMPS})`,
      );
    }
  }
  if (expected.endSpeedMPS !== undefined) {
    const err = Math.abs(speedOf(last) - expected.endSpeedMPS);
    if (err > tol.speedTolMPS) {
      violations.push(
        `end speed ${speedOf(last).toFixed(3)} vs official ${expected.endSpeedMPS} m/s — ${err.toFixed(3)} off (±${tol.speedTolMPS})`,
      );
    }
  }
  if (expected.endX !== undefined && expected.endY !== undefined) {
    const err = Math.hypot(last.x - expected.endX, last.y - expected.endY);
    if (err > tol.positionTolM) {
      violations.push(
        `end position (${last.x.toFixed(3)}, ${last.y.toFixed(3)}) vs official (${expected.endX}, ${expected.endY}) — ${err.toFixed(3)} m off (±${tol.positionTolM})`,
      );
    }
  }
  if (expected.endHeadingDeg !== undefined) {
    const err = angleDeltaDeg(last.heading * DEG, expected.endHeadingDeg);
    if (err > tol.headingTolDeg) {
      violations.push(
        `end heading ${(last.heading * DEG).toFixed(2)}° vs official ${expected.endHeadingDeg}° — ${err.toFixed(2)}° off (±${tol.headingTolDeg}°)`,
      );
    }
  }
  return violations;
}

function checkCurves(run: RunResult, fixture: LoadedFixture): string[] {
  const tol = fixture.tolerances;
  const expected = fixture.expected;
  const violations: string[] = [];
  const speeds = run.samples.map(speedOf);
  const peak = speeds.length > 0 ? Math.max(...speeds) : 0;
  if (expected.maxSpeedMPS !== undefined) {
    const err = Math.abs(peak - expected.maxSpeedMPS);
    if (err > tol.speedTolMPS) {
      violations.push(
        `peak speed ${peak.toFixed(3)} vs official ${expected.maxSpeedMPS} m/s — ${err.toFixed(3)} off (±${tol.speedTolMPS})`,
      );
    }
  }
  if (expected.peakAccelMPSSq !== undefined) {
    let peakAccel = 0;
    for (let i = 1; i < run.samples.length; i++) {
      const a = run.samples[i - 1]!;
      const b = run.samples[i]!;
      const dt = b.t - a.t;
      if (dt > 1e-9) {
        peakAccel = Math.max(peakAccel, (speedOf(b) - speedOf(a)) / dt);
      }
    }
    const err = Math.abs(peakAccel - expected.peakAccelMPSSq);
    if (err > tol.accelTolMPSS) {
      violations.push(
        `peak accel ${peakAccel.toFixed(3)} vs official ${expected.peakAccelMPSSq} m/s² — ${err.toFixed(3)} off (±${tol.accelTolMPSS})`,
      );
    }
  }
  for (const cap of expected.caps ?? []) {
    let worst = 0;
    let worstT = 0;
    for (let i = 0; i < run.samples.length; i++) {
      const s = run.samples[i]!;
      if (cap.fromT !== undefined && s.t < cap.fromT) continue;
      if (cap.toT !== undefined && s.t > cap.toT) continue;
      if (speeds[i]! > worst) {
        worst = speeds[i]!;
        worstT = s.t;
      }
    }
    if (worst > cap.maxVelocityMPS + tol.speedTolMPS) {
      const window =
        cap.fromT !== undefined || cap.toT !== undefined
          ? ` in window ${cap.fromT ?? 0}–${cap.toT ?? 'end'}s`
          : '';
      violations.push(
        `speed cap ${cap.maxVelocityMPS} m/s exceeded${window}: ${worst.toFixed(3)} m/s at t=${worstT.toFixed(3)}s`,
      );
    }
  }
  return violations;
}

function checkPoses(run: RunResult, fixture: LoadedFixture): string[] {
  const tol = fixture.tolerances;
  const violations: string[] = [];
  for (const g of fixture.goldenStates) {
    const ours = sampleTrajectory(run.samples, g.t);
    if (!ours) {
      violations.push(`t=${g.t.toFixed(3)}s: no sample`);
      continue;
    }
    const posErr = Math.hypot(ours.x - g.x, ours.y - g.y);
    if (posErr > tol.positionTolM) {
      violations.push(
        `t=${g.t.toFixed(3)}s: pose (${ours.x.toFixed(3)}, ${ours.y.toFixed(3)}) vs official (${g.x}, ${g.y}) — ${posErr.toFixed(3)} m off (±${tol.positionTolM})`,
      );
    }
    const rotErr = angleDeltaDeg(ours.heading * DEG, g.holonomicRotDeg);
    if (rotErr > tol.headingTolDeg) {
      violations.push(
        `t=${g.t.toFixed(3)}s: heading ${(ours.heading * DEG).toFixed(2)}° vs official ${g.holonomicRotDeg.toFixed(2)}° — ${rotErr.toFixed(2)}° off (±${tol.headingTolDeg}°)`,
      );
    }
    const speedErr = Math.abs(speedOf(ours) - g.linearVelocity);
    if (speedErr > tol.speedTolMPS) {
      violations.push(
        `t=${g.t.toFixed(3)}s: speed ${speedOf(ours).toFixed(3)} vs official ${g.linearVelocity.toFixed(3)} m/s — ${speedErr.toFixed(3)} off (±${tol.speedTolMPS})`,
      );
    }
  }
  return violations;
}

/** Samples within this gap merge into one hold window (waits sample at 10 Hz). */
const HOLD_MERGE_GAP_S = 0.15;

function checkJoins(run: RunResult, fixture: LoadedFixture): string[] {
  const joins = fixture.expected.joins ?? [];
  if (joins.length === 0) return [];
  const tol = fixture.tolerances;
  const windows: TrajectorySample[][] = [];
  for (const s of run.samples) {
    if (speedOf(s) > tol.holdSpeedMPS) continue;
    const current = windows.at(-1);
    if (current && s.t - current[current.length - 1]!.t <= HOLD_MERGE_GAP_S) {
      current.push(s);
    } else {
      windows.push([s]);
    }
  }
  const violations: string[] = [];
  for (const join of joins) {
    const matched = windows.some((w) => {
      const dur = w[w.length - 1]!.t - w[0]!.t;
      if (dur < join.holdSeconds * tol.holdMinFraction) return false;
      if (dur > join.holdSeconds + tol.holdMaxOvershootS) return false;
      return w.every((s) => Math.hypot(s.x - join.x, s.y - join.y) <= tol.positionTolM);
    });
    if (!matched) {
      violations.push(
        `hold of ~${join.holdSeconds}s at (${join.x}, ${join.y}) not found — declared auto join violated`,
      );
    }
  }
  return violations;
}

// ---------------------------------------------------------------------------
// Harness behavior — constructed fixtures in temp dirs (synthetic; they assert
// harness behavior only, never official numbers).
// ---------------------------------------------------------------------------

const tempDirs: string[] = [];
afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

function makeFixtureDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'pb-reference-'));
  tempDirs.push(dir);
  return dir;
}

function writeJson(dir: string, name: string, value: unknown): void {
  writeFileSync(join(dir, name), `${JSON.stringify(value, null, 1)}\n`);
}

const SAMPLE_SETTINGS = {
  robotWidth: 0.9,
  robotLength: 0.9,
  holonomicMode: true,
  robotMass: 74.088,
  robotMOI: 6.883,
  wheelCOF: 1.2,
  driveWheelRadius: 0.048,
  driveGearing: 5.143,
  maxDriveSpeed: 5.45,
  driveMotorType: 'krakenX60',
  driveCurrentLimit: 60.0,
  flModuleX: 0.273,
  flModuleY: 0.273,
  frModuleX: 0.273,
  frModuleY: -0.273,
  blModuleX: -0.273,
  blModuleY: 0.273,
  brModuleX: -0.273,
  brModuleY: -0.273,
};

/** Straight 1 m path from (x0, 0) to (x1, 0), hand-writable .path shape. */
function straightPath(x0: number, x1: number): Record<string, unknown> {
  const third = (x1 - x0) / 3;
  return {
    version: '2025.0',
    waypoints: [
      {
        anchor: { x: x0, y: 0 },
        prevControl: null,
        nextControl: { x: x0 + third, y: 0 },
        isLocked: false,
        linkedName: null,
      },
      {
        anchor: { x: x1, y: 0 },
        prevControl: { x: x1 - third, y: 0 },
        nextControl: null,
        isLocked: false,
        linkedName: null,
      },
    ],
    rotationTargets: [],
    constraintZones: [],
    pointTowardsZones: [],
    eventMarkers: [],
    globalConstraints: {
      maxVelocity: 4.0,
      maxAcceleration: 4.0,
      maxAngularVelocity: 540.0,
      maxAngularAcceleration: 720.0,
      nominalVoltage: 12.0,
      unlimited: false,
    },
    goalEndState: { velocity: 0, rotation: 0.0 },
    reversed: false,
    folder: null,
    idealStartingState: { velocity: 0, rotation: 0.0 },
    useDefaultConstraints: false,
  };
}

const GOLDEN_SETTINGS_SHA = createHash('sha256')
  .update(`${JSON.stringify(SAMPLE_SETTINGS, null, 1)}\n`)
  .digest('hex');

function validPathCaseDir(): string {
  const dir = makeFixtureDir();
  writeJson(dir, 'settings.json', SAMPLE_SETTINGS);
  writeJson(dir, 'One.path', straightPath(0, 1));
  writeJson(dir, 'manifest.json', {
    version: 1,
    cases: [
      {
        name: 'constructed',
        kind: 'path',
        pathFile: 'One.path',
        settingsFile: 'settings.json',
        goldenFile: 'golden-one.json',
        sha256: { 'settings.json': GOLDEN_SETTINGS_SHA },
        expected: { durationS: 2, endX: 1, endY: 0, endHeadingDeg: 0 },
      },
    ],
  });
  writeJson(dir, 'golden-one.json', {
    totalTimeS: 2,
    states: [
      { t: 0, x: 0, y: 0, holonomicRotDeg: 0, linearVelocity: 0 },
      { t: 1, x: 0.5, y: 0, holonomicRotDeg: 0, linearVelocity: 1 },
      { t: 2, x: 1, y: 0, holonomicRotDeg: 0, linearVelocity: 0 },
    ],
  });
  return dir;
}

describe('reference harness loader (constructed fixtures)', () => {
  it('returns zero fixtures when the manifest is absent — the gate stays closed', () => {
    expect(loadReferenceFixtures(makeFixtureDir())).toHaveLength(0);
  });

  it('returns zero fixtures when the manifest declares no cases', () => {
    const dir = makeFixtureDir();
    writeJson(dir, 'manifest.json', { version: 1, cases: [] });
    expect(loadReferenceFixtures(dir)).toHaveLength(0);
  });

  it('rejects a malformed manifest instead of treating it as empty', () => {
    const dir = makeFixtureDir();
    writeFileSync(join(dir, 'manifest.json'), '{ not json');
    expect(() => loadReferenceFixtures(dir)).toThrow(/manifest/i);
  });

  it('rejects a case that references a missing file (cannot silently close the gate)', () => {
    const dir = makeFixtureDir();
    writeJson(dir, 'settings.json', SAMPLE_SETTINGS);
    writeJson(dir, 'manifest.json', {
      cases: [
        {
          name: 'broken',
          kind: 'path',
          pathFile: 'Missing.path',
          settingsFile: 'settings.json',
          expected: {},
        },
      ],
    });
    expect(() => loadReferenceFixtures(dir)).toThrow(/Missing\.path/);
  });

  it('rejects a fixture whose bytes no longer match the recorded sha256', () => {
    const dir = makeFixtureDir();
    writeJson(dir, 'settings.json', SAMPLE_SETTINGS);
    writeJson(dir, 'One.path', straightPath(0, 1));
    writeJson(dir, 'manifest.json', {
      cases: [
        {
          name: 'tampered',
          kind: 'path',
          pathFile: 'One.path',
          settingsFile: 'settings.json',
          sha256: { 'One.path': '0'.repeat(64) },
          expected: {},
        },
      ],
    });
    expect(() => loadReferenceFixtures(dir)).toThrow(/sha256.*One\.path/i);
  });

  it('loads a valid case with expected literals, tolerances, and golden states', () => {
    const fixtures = loadReferenceFixtures(validPathCaseDir());
    expect(fixtures).toHaveLength(1);
    const f = fixtures[0]!;
    expect(f.name).toBe('constructed');
    expect(f.expected.durationS).toBe(2);
    expect(f.tolerances.positionTolM).toBe(0.05);
    expect(f.goldenStates).toHaveLength(3);
    expect(f.goldenStates[1]!).toEqual({ t: 1, x: 0.5, y: 0, holonomicRotDeg: 0, linearVelocity: 1 });
  });
});

/** Constant 1 m/s along +x for 2 s, samples every 0.5 s — hand-derived. */
const steadyRun = (): RunResult => ({
  durationS: 2,
  samples: [0, 0.5, 1, 1.5, 2].map((t) => ({
    t,
    x: t / 2,
    y: 0,
    heading: 0,
    vx: 1,
    vy: 0,
    omega: 0,
  })),
});

const fixtureWith = (expected: ExpectedCase, goldenStates: GoldenState[] = []): LoadedFixture => ({
  name: 'synthetic',
  kind: 'path',
  dir: '/synthetic',
  settingsText: '',
  autoPathTexts: new Map(),
  goldenStates,
  expected,
  tolerances: { ...DEFAULT_TOLERANCES },
});

describe('reference harness comparators (constructed samples)', () => {
  it('flags a total duration outside the declared relative tolerance', () => {
    const f = fixtureWith({ durationS: 2 });
    expect(checkDuration(steadyRun(), f)).toEqual([]);
    const slow: RunResult = { durationS: 2.05, samples: [] };
    // 2.5% off — outside the 2% default.
    expect(checkDuration(slow, f).join('\n')).toMatch(/duration/);
    expect(checkDuration(slow, f).join('\n')).toMatch(/2\.05/);
  });

  it('flags start/end speeds and endpoints outside tolerance', () => {
    const f = fixtureWith({
      startSpeedMPS: 1,
      endSpeedMPS: 1,
      endX: 1,
      endY: 0,
      endHeadingDeg: 0,
    });
    expect(checkEndpoints(steadyRun(), f)).toEqual([]);
    const turned = steadyRun();
    turned.samples = turned.samples.map((s) => ({ ...s, heading: Math.PI / 2 }));
    expect(checkEndpoints(turned, f).join('\n')).toMatch(/end heading/);
    const stoppedEnd = steadyRun();
    stoppedEnd.samples = stoppedEnd.samples.map((s, i) => (i === 4 ? { ...s, vx: 0, vy: 0 } : s));
    expect(checkEndpoints(stoppedEnd, f).join('\n')).toMatch(/end speed/);
    const fastStart = steadyRun();
    fastStart.samples = fastStart.samples.map((s, i) => (i === 0 ? { ...s, vx: 1.5, vy: 0 } : s));
    expect(checkEndpoints(fastStart, f).join('\n')).toMatch(/start speed/);
  });

  it('flags curve peaks and declared speed caps outside tolerance', () => {
    const f = fixtureWith({ maxSpeedMPS: 1, peakAccelMPSSq: 0, caps: [{ maxVelocityMPS: 1.2 }] });
    expect(checkCurves(steadyRun(), f)).toEqual([]);
    const higherPeak = fixtureWith({ maxSpeedMPS: 1.5, peakAccelMPSSq: 0 });
    expect(checkCurves(steadyRun(), higherPeak).join('\n')).toMatch(/peak speed/);
    const accelRun = steadyRun();
    accelRun.samples = [0, 1, 2].map((t) => ({
      t,
      x: (t * t) / 2,
      y: 0,
      heading: 0,
      vx: t,
      vy: 0,
      omega: 0,
    }));
    expect(checkCurves(accelRun, fixtureWith({ peakAccelMPSSq: 0 })).join('\n')).toMatch(/peak accel/);
    const tightCap = fixtureWith({ caps: [{ maxVelocityMPS: 0.7 }] });
    expect(checkCurves(steadyRun(), tightCap).join('\n')).toMatch(/cap/);
    // Windowed cap: outside the declared window the same speed is fine.
    const windowed = fixtureWith({ caps: [{ maxVelocityMPS: 0.7, fromT: 5, toT: 6 }] });
    expect(checkCurves(steadyRun(), windowed)).toEqual([]);
  });

  it('flags pose, heading, and speed mismatches at the golden sample times', () => {
    const golden: GoldenState[] = [
      { t: 0, x: 0, y: 0, holonomicRotDeg: 0, linearVelocity: 1 },
      { t: 1, x: 0.5, y: 0, holonomicRotDeg: 0, linearVelocity: 1 },
    ];
    const f = fixtureWith({}, golden);
    expect(checkPoses(steadyRun(), f)).toEqual([]);
    const drifted = golden.slice();
    drifted[1] = { t: 1, x: 0.8, y: 0, holonomicRotDeg: 0, linearVelocity: 1 };
    expect(checkPoses(steadyRun(), fixtureWith({}, drifted)).join('\n')).toMatch(/t=1\.000s.*pose/);
    const rotated = golden.slice();
    rotated[1] = { t: 1, x: 0.5, y: 0, holonomicRotDeg: 10, linearVelocity: 1 };
    expect(checkPoses(steadyRun(), fixtureWith({}, rotated)).join('\n')).toMatch(/t=1\.000s.*heading/);
    const faster = golden.slice();
    faster[1] = { t: 1, x: 0.5, y: 0, holonomicRotDeg: 0, linearVelocity: 1.5 };
    expect(checkPoses(steadyRun(), fixtureWith({}, faster)).join('\n')).toMatch(/t=1\.000s.*speed/);
  });

  it('runs an .auto case through the repo pipeline and verifies its wait join', () => {
    const dir = makeFixtureDir();
    writeJson(dir, 'settings.json', SAMPLE_SETTINGS);
    writeJson(dir, 'A.path', straightPath(0, 1));
    writeJson(dir, 'B.path', straightPath(1, 2));
    writeJson(dir, 'Two.auto', {
      version: '2025.0',
      command: {
        type: 'sequential',
        data: {
          commands: [
            { type: 'path', data: { pathName: 'A' } },
            { type: 'wait', data: { waitTime: 1.0 } },
            { type: 'path', data: { pathName: 'B' } },
          ],
        },
      },
    });
    writeJson(dir, 'manifest.json', {
      cases: [
        {
          name: 'constructed-auto',
          kind: 'auto',
          autoFile: 'Two.auto',
          pathFiles: ['A.path', 'B.path'],
          settingsFile: 'settings.json',
          expected: { joins: [{ holdSeconds: 1.0, x: 1.0, y: 0.0 }] },
        },
      ],
    });
    const fixture = loadReferenceFixtures(dir)[0]!;
    const run = runFixture(fixture);
    // Physics floor: each 1 m leg from rest to rest at ≤4 m/s² needs ≥1 s
    // (t = 2√(d/a)), plus the declared 1 s wait — so ≥2.9 s in total.
    expect(run.durationS).toBeGreaterThan(2.9);
    expect(checkJoins(run, fixture)).toEqual([]);
    const wrongPose = fixtureWith({ joins: [{ holdSeconds: 1.0, x: 5.0, y: 5.0 }] });
    expect(checkJoins(run, wrongPose).join('\n')).toMatch(/hold/);
  });
});

// ---------------------------------------------------------------------------
// The gate + the official acceptance suite.
// ---------------------------------------------------------------------------

const FIXTURE_DIR = resolve(__dirname, '../../../samples/pathplanner/reference');
const fixtures = loadReferenceFixtures(FIXTURE_DIR);

describe.skipIf(fixtures.length === 0)('official PathPlanner v2025.2.7 reference acceptance', () => {
  // Guard both ways: with fixtures on disk this fails if the loader ever
  // silently returns [] (the gate would close without anyone noticing); with
  // no fixtures it is the entry vitest reports as skipped, so the closed gate
  // is visible in the run output instead of vanishing.
  it('runs against pinned official fixtures', () => {
    expect(fixtures.length).toBeGreaterThan(0);
  });

  for (const fixture of fixtures) {
    describe(fixture.name, () => {
      let cached: RunResult | undefined;
      const run = (): RunResult => (cached ??= runFixture(fixture));

      it('matches the official total duration within the declared tolerance', () => {
        expect(checkDuration(run(), fixture)).toEqual([]);
      });

      it('matches official start/end velocities and endpoints', () => {
        expect(checkEndpoints(run(), fixture)).toEqual([]);
      });

      it('matches official curve peaks and stays within declared caps', () => {
        expect(checkCurves(run(), fixture)).toEqual([]);
      });

      it('matches official pose+heading at the fixture sample times', () => {
        expect(checkPoses(run(), fixture)).toEqual([]);
      });

      if (fixture.expected.joins?.length) {
        it('matches official auto segment joins', () => {
          expect(checkJoins(run(), fixture)).toEqual([]);
        });
      }
    });
  }
});

it('documents the gate when fixtures are absent', () => {
  if (fixtures.length > 0) return; // real assertions ran above
  expect(fixtures).toHaveLength(0); // gate, not a pass: see README
});
