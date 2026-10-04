import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  applyProfileToTrajectory,
  deserializeSession,
  makeSession,
  parsePathFile,
  parseRobotProfile,
  parseTraj,
  serializeSession,
} from '../src';

const SAMPLES = resolve(__dirname, '../../../samples');
const read = (rel: string) => readFileSync(resolve(SAMPLES, rel), 'utf-8');

describe('profile dynamics parsing (§6.6 全量消费)', () => {
  it('maps the real .chor config onto ProfileDynamics, vmax as motor-shaft speed', () => {
    const chor = readFileSync(resolve(SAMPLES, 'choreo/choreo.chor'), 'utf-8');
    const profile = parseRobotProfile(chor, 'choreo/choreo.chor');
    expect(profile!.dynamics).toBeDefined();
    expect(profile!.dynamics!.massKG).toBe(65);
    expect(profile!.dynamics!.moiKGm2).toBe(6);
    expect(profile!.dynamics!.wheelCOF).toBe(1.2);
    expect(profile!.dynamics!.driveGearing).toBe(7.15);
    // 534.07 rad/s at the motor ÷ 7.15 × 48.2 mm wheels ≈ 3.6 m/s at the carpet.
    expect(profile!.dynamics!.maxDriveVelocityMPS).toBeCloseTo(3.6, 1);
  });

  it('leaves vmax unmapped when the derivation reads as a unit error', () => {
    const text = JSON.stringify({
      type: 'Swerve',
      config: { bumper: { front: 0.45, side: 0.45, back: 0.45 }, vmax: 100, gearing: 1.0, radius: 1.0 },
    });
    const profile = parseRobotProfile(text, 'x/choreo.chor');
    expect(profile!.dynamics!.maxDriveVelocityMPS).toBeUndefined();
  });

  it('parses PP settings.json dynamics and generation defaults when carried', () => {
    // Field names per red book §6.6 (upstream prefs); no local real sample
    // carries them yet — synthetic fixture, plausibility-guarded.
    const text = JSON.stringify({
      robotConfig: {
        robotWidth: 0.85,
        robotLength: 1.02,
        robotMass: 61.2,
        robotMOI: 5.1,
        driveGearing: 6.08,
        driveWheelRadius: 0.0508,
        wheelCOF: 1.0,
      },
      generationSettings: {
        defaultMaxVel: 4.5,
        defaultMaxAccel: 3.2,
        defaultMaxAngVel: 540,
        defaultMaxAngAccel: 720,
      },
    });
    const profile = parseRobotProfile(text, '254/pathplanner/settings.json');
    expect(profile!.dynamics!.massKG).toBe(61.2);
    expect(profile!.dynamics!.moiKGm2).toBe(5.1);
    expect(profile!.dynamics!.driveGearing).toBe(6.08);
    expect(profile!.dynamics!.wheelRadiusM).toBe(0.0508);
    expect(profile!.dynamics!.wheelCOF).toBe(1.0);
    expect(profile!.defaultConstraints!.maxVelMPS).toBe(4.5);
    expect(profile!.defaultConstraints!.maxAngVelRadPS).toBe(540);
  });

  it('carries no dynamics for files without those fields (real samples today)', () => {
    const text = JSON.stringify({ robotConfig: { robotWidth: 0.9, robotLength: 0.9 } });
    const profile = parseRobotProfile(text, 'a/settings.json');
    expect(profile!.dynamics).toBeUndefined();
    expect(profile!.defaultConstraints).toBeUndefined();
  });
});

describe('applyProfileToTrajectory (real-robot regeneration)', () => {
  // The regen-direction assert rides on constrained_pointing.path: probes
  // on 2026-10-04 showed its timeline responds to drive dynamics
  // (8.0105 s default → 7.6412 s tuned), while short gentle paths
  // (Pickup.path) are fully masked by their own path constraints.
  const traj = parsePathFile(read('pathplanner/constrained_pointing.path'), 'constrained_pointing.path');
  expect(traj.editable?.kind).toBe('pathplanner');

  it('regenerates a .path timeline from profile dynamics and clears the estimate warning', () => {
    const profile = parseRobotProfile(
      JSON.stringify({ robotConfig: { robotWidth: 0.9, robotLength: 0.9, robotMass: 45, robotMOI: 2.0 } }),
      '254/settings.json',
    )!;
    const applied = applyProfileToTrajectory(traj, profile);
    expect(applied.geometrySource).toBe('file');
    expect(applied.massKG).toBe(45);
    expect(applied.durationS).toBeLessThan(traj.durationS);
    expect(applied.warnings[0]).toContain('regenerated with real robot config');
    expect(applied.warnings.join('\n')).not.toContain('generated with default robot config');
  });

  it('keeps timing when path constraints mask the dynamics (documented behavior)', () => {
    const pickup = parsePathFile(read('pathplanner/Pickup.path'), 'Pickup.path');
    // Mass alone (the only dynamics field in today's real settings.json
    // samples) leaves Pickup's timeline bit-identical: its constraints bind
    // everywhere, so the traction model never surfaces. Provenance still
    // flips to 'file'.
    const profile = parseRobotProfile(
      JSON.stringify({ robotConfig: { robotWidth: 0.9, robotLength: 0.9, robotMass: 61.2 } }),
      'a/settings.json',
    )!;
    const applied = applyProfileToTrajectory(pickup, profile);
    expect(applied.durationS).toBeCloseTo(pickup.durationS, 9);
    expect(applied.geometrySource).toBe('file');
    expect(applied.massKG).toBe(61.2);
  });

  it('fills unlimited global constraints from profile generation defaults, never file data', () => {
    const profile = parseRobotProfile(
      JSON.stringify({
        robotConfig: { robotWidth: 0.9, robotLength: 0.9, robotMass: 65 },
        generationSettings: { defaultMaxVel: 3.0, defaultMaxAccel: 2.0 },
      }),
      'a/settings.json',
    )!;

    // File-carried constraints (Pickup.path) must survive untouched (v1.14).
    const applied = applyProfileToTrajectory(traj, profile);
    const carried = (applied.editable as unknown as { path: { globalConstraints: { unlimited: boolean } } }).path;
    expect(carried.globalConstraints.unlimited).toBe(false);

    // An unlimited path (the "no constraint" marker) takes the profile's
    // project defaults instead of the generator's invented ones.
    const unlimitedTraj = {
      ...traj,
      editable: {
        kind: 'pathplanner' as const,
        path: {
          ...(traj.editable as unknown as { kind: 'pathplanner'; path: { globalConstraints: Record<string, unknown> } }).path,
          globalConstraints: {
            maxVelocityMPS: 999, maxAccelerationMPSSq: 999,
            maxAngularVelocityRadPS: 999, maxAngularAccelerationRadPSSq: 999,
            nominalVoltage: 12, unlimited: true,
          },
        },
      },
    } as typeof traj;
    const filled = applyProfileToTrajectory(unlimitedTraj as Parameters<typeof applyProfileToTrajectory>[0], profile);
    const gc = (filled.editable as unknown as { path: { globalConstraints: { unlimited: boolean; maxVelocityMPS: number; maxAccelerationMPSSq: number } } }).path.globalConstraints;
    expect(gc.unlimited).toBe(false);
    expect(gc.maxVelocityMPS).toBe(3.0);
    expect(gc.maxAccelerationMPSSq).toBe(2.0);
  });

  it('keeps Choreo samples untouched (embedded, never regenerated)', () => {
    const choreo = parseTraj(read('traj/v3_swerve.traj'), 'v3_swerve.traj');
    const profile = parseRobotProfile(
      JSON.stringify({ robotConfig: { robotWidth: 0.9, robotLength: 0.9, robotMass: 50 } }),
      'a/settings.json',
    )!;
    const applied = applyProfileToTrajectory(choreo, profile);
    expect(applied.samples).toEqual(choreo.samples);
    expect(applied.geometrySource).toBe('file');
    expect(applied.massKG).toBe(50);
  });

  it('survives the session round trip (mass + drive mode persist since v1.7 files)', () => {
    const profile = parseRobotProfile(
      JSON.stringify({ robotConfig: { robotWidth: 0.9, robotLength: 0.9, robotMass: 61.2 }, isHolonomic: false }),
      'a/settings.json',
    )!;
    const applied = applyProfileToTrajectory(traj, profile);
    const restored = deserializeSession(serializeSession([makeSession(applied, 0)], 'rebuilt-2026'));
    expect(restored.robots[0]!.trajectory.massKG).toBe(61.2);
    expect(restored.robots[0]!.trajectory.holonomic).toBe(false);
  });
});
