import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  detectFormat,
  parseGhostAuto,
  parsePathFile,
  parseTraj,
  teamNumberFromName,
  ParseError,
} from '../src';

const SAMPLES = resolve(__dirname, '../../../samples');

const read = (rel: string): string =>
  readFileSync(resolve(SAMPLES, rel), 'utf-8');

describe('detectFormat', () => {
  it.each([
    ['traj/v3_swerve.traj', 'choreo-traj'],
    ['traj/v2025.0.0_swerve.traj', 'choreo-traj'],
    ['ghostauto/straight_run.ghostauto', 'ghostauto'],
    ['pathplanner/Pickup.path', 'pathplanner-path'],
    ['pathplanner/Example Auto.auto', 'pathplanner-auto'],
  ])('detects %s as %s', (rel, expected) => {
    expect(detectFormat(read(rel), rel)).toBe(expected);
  });
});

describe('parseTraj (real samples, all schema versions)', () => {
  const swerveFiles = [
    'traj/v0_swerve.traj',
    'traj/v1_swerve.traj',
    'traj/v2_swerve.traj',
    'traj/v3_swerve.traj',
    'traj/v2025.0.0_swerve.traj',
    'traj/swerve_test.traj',
  ] as const;

  it.each(swerveFiles)('parses %s', (rel) => {
    const traj = parseTraj(read(rel), rel);
    expect(traj.source).toBe('choreo-traj');
    expect(traj.samples.length).toBeGreaterThan(10);
    expect(traj.durationS).toBeGreaterThan(1);
    const first = traj.samples[0]!;
    expect(first.t).toBe(0);
    expect(Number.isFinite(first.x)).toBe(true);
    // Strictly non-decreasing time.
    for (let i = 1; i < traj.samples.length; i++) {
      expect(traj.samples[i]!.t).toBeGreaterThanOrEqual(traj.samples[i - 1]!.t);
    }
  });

  it('v3 config yields file geometry and module locations', () => {
    const traj = parseTraj(read('traj/v3_swerve.traj'), 'v3_swerve.traj');
    expect(traj.geometrySource).toBe('file');
    // bumper front/back/side = 0.4064 half-extents → 0.8128 × 0.8128
    expect(traj.geometry.lengthM).toBeCloseTo(0.8128, 3);
    expect(traj.geometry.widthM).toBeCloseTo(0.8128, 3);
    expect(traj.moduleLocations.length).toBe(4);
    // frontLeft module at (0.2794, 0.2794)
    const fl = traj.moduleLocations[0]!;
    expect(fl.x).toBeCloseTo(0.2794, 3);
    expect(fl.y).toBeCloseTo(0.2794, 3);
  });

  it('v2025.0.0 has no config — default geometry + warning', () => {
    const traj = parseTraj(read('traj/v2025.0.0_swerve.traj'), 'v2025.traj');
    expect(traj.geometrySource).toBe('default');
    expect(traj.warnings.some((w) => w.includes('geometry'))).toBe(true);
  });

  it('differential samples fold vl/vr into field vx with vy=0', () => {
    const traj = parseTraj(read('traj/v3_differential.traj'), 'diff.traj');
    expect(traj.samples.length).toBeGreaterThan(10);
    for (const s of traj.samples) {
      expect(s.vy).toBe(0);
      // Diff drive moving forward at start: vx = (vl+vr)/2 >= 0 early on.
    }
    const s3 = traj.samples[3]!;
    expect(s3.vx).toBeGreaterThanOrEqual(0);
  });

  it('parses events with timestamps', () => {
    const traj = parseTraj(read('traj/v3_swerve.traj'), 'v3.traj');
    expect(traj.events.length).toBeGreaterThan(0);
    expect(traj.events[0]!.t).toBeGreaterThanOrEqual(0);
  });
});

describe('parseGhostAuto', () => {
  it.each([
    'ghostauto/straight_run.ghostauto',
    'ghostauto/stop_and_score.ghostauto',
    'ghostauto/side_lane.ghostauto',
  ])('parses %s', (rel) => {
    const traj = parseGhostAuto(read(rel), rel);
    expect(traj.source).toBe('ghostauto');
    expect(traj.teamName).toMatch(/^Team \d+$/);
    expect(traj.teamNumber).toMatch(/^\d+$/);
    expect(traj.teamNumber).toBe(traj.teamName.replace(/\D/g, ''));
    expect(traj.geometrySource).toBe('file');
    expect(traj.geometry.lengthM).toBeCloseTo(0.9, 6);
    expect(traj.moduleLocations.length).toBe(4);
  });

  it('teamNumberFromName extracts the first number run', () => {
    expect(teamNumberFromName('Team 0001')).toBe('0001');
    expect(teamNumberFromName('Cybersonics 103')).toBe('103');
    expect(teamNumberFromName('无数字队伍')).toBe('');
    expect(teamNumberFromName('')).toBe('');
  });

  it('team numbers default to the file name when the format carries none', () => {
    const traj = parseTraj(read('traj/v3_swerve.traj'), '254_auto.traj');
    expect(traj.teamNumber).toBe('254');
    const path = parsePathFile(read('pathplanner/Pickup.path'), 'Pickup.path');
    expect(path.teamNumber).toBe(''); // no digits in the name → empty
    // ghostauto: the in-file teamName wins; file name is only the fallback.
    const ghost = parseGhostAuto(read('ghostauto/straight_run.ghostauto'), '9999.ghostauto');
    expect(ghost.teamNumber).toBe('0001');
  });

  it('straight_run endpoints and speed are as generated', () => {
    const traj = parseGhostAuto(read('ghostauto/straight_run.ghostauto'), 's');
    const first = traj.samples[0]!;
    const last = traj.samples[traj.samples.length - 1]!;
    expect(first.x).toBeCloseTo(2, 3);
    expect(first.y).toBeCloseTo(2, 3);
    expect(last.x).toBeCloseTo(11.96, 3);
    expect(last.y).toBeCloseTo(2, 3);
    expect(first.vx).toBeCloseTo(1.2, 3);
  });
});

describe('parsePathFile (unified entry)', () => {
  it('dispatches by structure, not extension', () => {
    const traj = parsePathFile(read('traj/v3_swerve.traj'), 'renamed.json');
    expect(traj.source).toBe('choreo-traj');
  });

  it('.path imports natively since Phase 2', () => {
    const traj = parsePathFile(read('pathplanner/Pickup.path'), 'Pickup.path');
    expect(traj.source).toBe('pathplanner-path');
    expect(traj.samples.length).toBeGreaterThan(20);
  });

  it('.auto without its referenced paths asks for them', () => {
    try {
      parsePathFile(read('pathplanner/Example Auto.auto'), 'Example Auto.auto');
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ParseError);
      expect((e as ParseError).message).toMatch(/Pickup/);
    }
  });

  it.each([
    ['truncated json', '{"name": "x", '],
    ['non-json text', 'hello world'],
  ])('rejects %s', (_label, text) => {
    expect(() => parsePathFile(text, 'bad.file')).toThrow(ParseError);
  });

  it('rejects .traj without generated trajectory with guidance', () => {
    const noTraj = JSON.stringify({ name: 'x', version: 3, snapshot: {}, params: {} });
    try {
      parsePathFile(noTraj, 'ungenerated.traj');
      expect.unreachable();
    } catch (e) {
      expect((e as ParseError).kind).toBe('missing-trajectory');
      expect((e as ParseError).message).toMatch(/generate/i);
    }
  });
});
