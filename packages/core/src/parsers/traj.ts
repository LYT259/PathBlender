/**
 * Choreo `.traj` parser.
 *
 * Format facts confirmed against real samples (docs/formats/format-facts.md):
 * top level { name, version, snapshot, params, trajectory, events };
 * trajectory { config?, sampleType?, waypoints, samples, splits }.
 * samples carry full time-parameterized state — parse & replay, no
 * generation needed. Known schema versions: 0, 1, 2, 3, "v2025.0.0".
 */

import type {
  ModuleLocation,
  RobotGeometry,
  Trajectory,
  TrajectoryEvent,
  TrajectorySample,
} from '../types';
import { DEFAULT_GEOMETRY, teamNumberFromName, trajectoryDuration } from '../types';
import { asArray, asRecord, num, parseJson, str } from './json';
import { geometryFromConfig } from './robot-profile';
import { parseChoreoWaypoints } from './traj-editable';
import { ParseError } from './parse-error';

const KNOWN_VERSIONS = new Set<string | number>([0, 1, 2, 3, 'v2025.0.0']);

interface RawSample {
  t: number;
  x: number;
  y: number;
  heading: number;
  vx: number;
  vy: number;
  omega: number;
}

function swerveState(s: Record<string, unknown>): RawSample {
  return {
    t: num(s.t, Number.NaN),
    x: num(s.x, Number.NaN),
    y: num(s.y, Number.NaN),
    heading: num(s.heading, 0),
    vx: num(s.vx, 0),
    vy: num(s.vy, 0),
    omega: num(s.omega, 0),
  };
}

function differentialState(s: Record<string, unknown>): RawSample {
  // vl/vr are wheel linear velocities (m/s); field vy is 0 for a diff drive.
  const vl = num(s.vl, 0);
  const vr = num(s.vr, 0);
  return {
    t: num(s.t, Number.NaN),
    x: num(s.x, Number.NaN),
    y: num(s.y, Number.NaN),
    heading: num(s.heading, 0),
    vx: (vl + vr) / 2,
    vy: 0,
    omega: num(s.omega, 0),
  };
}

/**
 * v3 config → geometry mapping lives in robot-profile.ts (geometryFromConfig):
 * the embedded config and the `.chor` project config are the same fields, so
 * one mapper serves both consumers (red book v1.15).
 */

export function parseTraj(text: string, fileName: string): Trajectory {
  const root = asRecord(parseJson(text, fileName));
  if (!root) throw new ParseError('unrecognized-format', fileName, 'not a JSON object');

  const trajObj = asRecord(root.trajectory);
  if (!trajObj || !asArray(trajObj.samples)) {
    throw new ParseError(
      'missing-trajectory',
      fileName,
      'no trajectory.samples — generate the trajectory in Choreo before exporting',
    );
  }

  const warnings: string[] = [];
  const version: unknown = root.version;
  if (
    (typeof version === 'string' || typeof version === 'number') &&
    !KNOWN_VERSIONS.has(version)
  ) {
    warnings.push(`unknown .traj schema version ${String(version)}; parsed best-effort`);
  }

  const rawSamples = asArray(trajObj.samples) ?? [];
  if (rawSamples.length === 0) {
    throw new ParseError('empty-trajectory', fileName);
  }

  const sampleType = str(trajObj.sampleType, 'Swerve');
  const toState = sampleType === 'Differential' ? differentialState : swerveState;

  const samples: TrajectorySample[] = [];
  for (const raw of rawSamples) {
    const rec = asRecord(raw);
    if (!rec) continue;
    const s = toState(rec);
    if (![s.t, s.x, s.y].every(Number.isFinite)) continue;
    samples.push({ ...s, heading: s.heading });
  }
  if (samples.length === 0) {
    throw new ParseError('empty-trajectory', fileName, 'no usable samples');
  }

  const { geometry, modules, fromFile } = (() => {
    const cfg = asRecord(trajObj.config);
    return cfg
      ? geometryFromConfig(cfg)
      : { geometry: DEFAULT_GEOMETRY, modules: [] as ModuleLocation[], fromFile: false };
  })();
  if (!fromFile) {
    warnings.push('no robot geometry carried — attach a Choreo .chor or PathPlanner settings.json profile for real dimensions');
  }

  // Traction headroom (red book §6.6 远期可选, landed 2026-10-04): fx/fy
  // are per-module wheel forces; the per-module friction limit is
  // COF·mass·g/n. A sustained stretch above 90% of that limit warns the
  // real run may slip — the path was planned for ideal grip. Judges only
  // when the config carries cof+mass; otherwise no honest verdict.
  {
    const cfgRec = asRecord(trajObj.config);
    const cof = cfgRec ? num(cfgRec.cof, Number.NaN) : Number.NaN;
    const mass = cfgRec ? num(cfgRec.mass, Number.NaN) : Number.NaN;
    if (Number.isFinite(cof) && Number.isFinite(mass) && cof > 0 && mass > 0) {
      let stretchStart: number | undefined;
      let stretchEnd: number | undefined;
      for (const raw of asArray(trajObj.samples) ?? []) {
        const rec = asRecord(raw);
        const t = rec ? num(rec.t, Number.NaN) : Number.NaN;
        const fx = rec ? asArray(rec.fx) : undefined;
        const fy = rec ? asArray(rec.fy) : undefined;
        const limit = (cof * mass * 9.8) / Math.max(fx?.length ?? 1, 1);
        let maxF = 0;
        for (let m = 0; fx && m < fx.length; m++) {
          const f = Math.hypot(num(fx[m], 0), num(fy?.[m], 0));
          if (f > maxF) maxF = f;
        }
        const near = Number.isFinite(t) && fx && maxF > 0.9 * limit;
        if (near) {
          if (stretchStart === undefined) stretchStart = t;
          stretchEnd = t;
        }
      }
      if (stretchStart !== undefined && stretchEnd !== undefined) {
        warnings.push(`wheel forces near the traction limit at t≈${stretchStart.toFixed(1)}–${stretchEnd.toFixed(1)} s — the real run may slip (path planned for ideal grip)`);
      }
    }
  }

  // Events: { name, from: { targetTimestamp, offset.val } }
  const events: TrajectoryEvent[] = [];
  for (const raw of asArray(root.events) ?? []) {
    const ev = asRecord(raw);
    const from = ev ? asRecord(ev.from) : undefined;
    if (!ev || !from) continue;
    const offset = asRecord(from.offset);
    const t =
      num(from.targetTimestamp, Number.NaN) +
      (offset ? num(offset.val, 0) : 0);
    const name = str(ev.name, 'event');
    if (Number.isFinite(t)) events.push({ name, t });
  }

  // Editable data for mediation edits (§6.3): snapshot waypoints when the
  // export carries them; splits are the trajectory.waypoints time array.
  const editable = (() => {
    const snap = asRecord(root.snapshot);
    const waypoints = snap ? parseChoreoWaypoints(snap.waypoints) : undefined;
    if (!waypoints) return undefined;
    const splits = (asArray(trajObj?.waypoints) ?? [])
      .map((v) => (typeof v === 'number' && Number.isFinite(v) ? v : null))
      .filter((v): v is number => v != null);
    return {
      kind: 'choreo' as const,
      version: str(root.version, ''),
      waypoints,
      splits,
      raw: root as unknown,
    };
  })();

  return {
    id: crypto.randomUUID(),
    name: str(root.name, fileName.replace(/\.traj$/i, '')),
    teamName: '',
    teamNumber: teamNumberFromName(fileName),
    source: 'choreo-traj',
    alliance: 'blue',
    samples,
    durationS: trajectoryDuration(samples),
    geometry,
    geometrySource: fromFile ? 'file' : 'default',
    moduleLocations: modules,
    events,
    warnings,
    editable,
  };
}
