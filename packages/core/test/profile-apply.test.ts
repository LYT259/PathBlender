import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  applyProfileToTrajectory,
  DCMotor,
  DEFAULT_GEOMETRY,
  deserializeSession,
  dynamicsConfigComplete,
  makeSession,
  parsePathFile,
  parseRobotProfile,
  parseTraj,
  resolveRobotConfig,
  serializeSession,
} from '../src';
import type { RobotProfile } from '../src';

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
    // Authoritative v2025.2.7 shape: every field top-level flat, exactly as
    // home_page.dart _saveProjectSettingsToFile writes it (verified at the
    // pinned tag). Angular defaults are degrees in the file.
    const text = JSON.stringify({
      robotWidth: 0.85,
      robotLength: 1.02,
      robotMass: 61.2,
      robotMOI: 5.1,
      driveGearing: 6.08,
      driveWheelRadius: 0.0508,
      wheelCOF: 1.0,
      driveMotorType: 'falcon500FOC',
      driveCurrentLimit: 80,
      defaultMaxVel: 4.5,
      defaultMaxAccel: 3.2,
      defaultMaxAngVel: 540,
      defaultMaxAngAccel: 720,
      defaultNominalVoltage: 12,
    });
    const profile = parseRobotProfile(text, '254/pathplanner/settings.json');
    expect(profile!.dynamics!.massKG).toBe(61.2);
    expect(profile!.dynamics!.moiKGm2).toBe(5.1);
    expect(profile!.dynamics!.driveGearing).toBe(6.08);
    expect(profile!.dynamics!.wheelRadiusM).toBe(0.0508);
    expect(profile!.dynamics!.wheelCOF).toBe(1.0);
    expect(profile!.dynamics!.driveMotorType).toBe('falcon500FOC');
    expect(profile!.dynamics!.driveCurrentLimitA).toBe(80);
    expect(profile!.defaultConstraints!.maxVelMPS).toBe(4.5);
    expect(profile!.defaultConstraints!.maxAccelMPSS).toBe(3.2);
    // 540°/s × π/180 = 9.42477…, 720°/s² × π/180 = 12.56637… (upstream
    // PathConstraints stores degrees; the generator converts via
    // Units.degreesToRadians, trajectory.dart at v2025.2.7).
    expect(profile!.defaultConstraints!.maxAngVelRadPS).toBeCloseTo(9.42478, 4);
    expect(profile!.defaultConstraints!.maxAngAccelRadPSSq).toBeCloseTo(12.56637, 4);
    expect(profile!.defaultConstraints!.nominalVoltageV).toBe(12);
  });

  it('keeps linear defaults in SI units unchanged', () => {
    const text = JSON.stringify({
      robotWidth: 0.9,
      robotLength: 0.9,
      defaultMaxVel: 4.5,
      defaultMaxAccel: 3.2,
    });
    const profile = parseRobotProfile(text, 'a/settings.json');
    expect(profile!.defaultConstraints!.maxVelMPS).toBe(4.5);
    expect(profile!.defaultConstraints!.maxAccelMPSS).toBe(3.2);
  });

  it('still converts angular defaults from the legacy nested generationSettings shape', () => {
    // Compatibility coverage: pre-flat files nested the same keys under
    // generationSettings. The deg→rad fix applies to both shapes.
    const text = JSON.stringify({
      robotConfig: { robotWidth: 0.9, robotLength: 0.9 },
      generationSettings: {
        defaultMaxAngVel: 540,
        defaultMaxAngAccel: 720,
        defaultNominalVoltage: 0,
      },
    });
    const profile = parseRobotProfile(text, 'a/settings.json');
    expect(profile!.defaultConstraints!.maxAngVelRadPS).toBeCloseTo(9.42478, 4);
    expect(profile!.defaultConstraints!.maxAngAccelRadPSSq).toBeCloseTo(12.56637, 4);
    // Non-positive nominal voltage is dropped, not applied.
    expect(profile!.defaultConstraints!.nominalVoltageV).toBeUndefined();
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

  it('unlimited global constraints are never backfilled from the profile', () => {
    const withDefaults = parseRobotProfile(
      JSON.stringify({
        robotConfig: { robotWidth: 0.9, robotLength: 0.9, robotMass: 65 },
        generationSettings: { defaultMaxVel: 3.0, defaultMaxAccel: 2.0 },
      }),
      'a/settings.json',
    )!;
    const noDefaults = parseRobotProfile(
      JSON.stringify({ robotConfig: { robotWidth: 0.9, robotLength: 0.9, robotMass: 65 } }),
      'a/settings.json',
    )!;

    // File-carried constraints (constrained_pointing.path) must survive
    // application untouched (v1.14): a constrained path stays constrained.
    const applied = applyProfileToTrajectory(traj, withDefaults);
    const carried = (applied.editable as unknown as { path: { globalConstraints: { unlimited: boolean } } }).path;
    expect(carried.globalConstraints.unlimited).toBe(false);

    // An unlimited path (the "no constraint" marker) stays exactly as the
    // file wrote it — upstream never merges project defaults into a path.
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
    const filled = applyProfileToTrajectory(unlimitedTraj as Parameters<typeof applyProfileToTrajectory>[0], withDefaults);
    const gc = (filled.editable as unknown as { path: { globalConstraints: { unlimited: boolean; maxVelocityMPS: number } } }).path.globalConstraints;
    expect(gc.unlimited).toBe(true);
    expect(gc.maxVelocityMPS).toBe(999);
    // Carrying generationSettings must be indistinguishable from not
    // carrying them: the defaults never reach the path.
    const filledNoDefaults = applyProfileToTrajectory(
      unlimitedTraj as Parameters<typeof applyProfileToTrajectory>[0],
      noDefaults,
    );
    expect(filled.durationS).toBe(filledNoDefaults.durationS);
  });

  it('unlimited path keeps the estimate warning lineage', () => {
    // Re-parse the sample with the velocity cap omitted so the parser maps
    // it to +∞ and parse-time warnings carry the unlimited caveat; profile
    // application must not silently drop that honesty marker.
    const asJson = JSON.parse(read('pathplanner/constrained_pointing.path')) as {
      globalConstraints: Record<string, unknown>;
    };
    delete asJson.globalConstraints.maxVelocity;
    asJson.globalConstraints.unlimited = true;
    const unlimited = parsePathFile(JSON.stringify(asJson), 'constrained_pointing.path');
    expect(unlimited.warnings.join('\n')).toContain('path has unlimited global constraints');

    const profile = parseRobotProfile(
      JSON.stringify({
        robotConfig: { robotWidth: 0.9, robotLength: 0.9, robotMass: 65 },
        generationSettings: { defaultMaxVel: 3.0, defaultMaxAccel: 2.0 },
      }),
      'a/settings.json',
    )!;
    const applied = applyProfileToTrajectory(unlimited, profile);
    expect(applied.warnings.join('\n')).toContain('path has unlimited global constraints');
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

describe('resolveRobotConfig (motor, current, provenance)', () => {
  const traj = parsePathFile(read('pathplanner/constrained_pointing.path'), 'constrained_pointing.path');

  // Authoritative v2025.2.7 flat shape (Task 1). Probed on this sample: the
  // motor model only binds above ~120 kg (lighter robots saturate the path's
  // own 3 m/s² constraint first), so the shared fixture is 150 kg with 200 A
  // headroom — heavier than the 74.088 kg default, but the default-config
  // parse is current-starved at 60 A, so both motors still beat it.
  const fullSettings = (over: Record<string, unknown> = {}): string =>
    JSON.stringify({
      robotWidth: 0.85,
      robotLength: 0.85,
      holonomicMode: true,
      robotMass: 150,
      robotMOI: 6.9,
      wheelCOF: 1.2,
      driveWheelRadius: 0.048,
      driveGearing: 6.08,
      maxDriveSpeed: 4.5,
      driveMotorType: 'krakenX60',
      driveCurrentLimit: 200,
      flModuleX: 0.273, flModuleY: 0.273,
      frModuleX: -0.273, frModuleY: 0.273,
      blModuleX: 0.273, blModuleY: -0.273,
      brModuleX: -0.273, brModuleY: -0.273,
      ...over,
    });
  const profile = (over: Record<string, unknown> = {}) =>
    parseRobotProfile(fullSettings(over), '254/pathplanner/settings.json')!;

  it('motor type reaches the generator and changes a dynamics-limited timeline', () => {
    const falcon = applyProfileToTrajectory(traj, profile({ driveMotorType: 'falcon500' }));
    const kraken = applyProfileToTrajectory(traj, profile({ driveMotorType: 'krakenX60' }));
    // Falcon 500 delivers less torque at speed than the Kraken X60 with the
    // same gearing and current headroom → longer timeline.
    expect(falcon.durationS).toBeGreaterThan(kraken.durationS);
    // Sanity: both beat the default-config parse (74.088 kg, 60 A Kraken).
    expect(falcon.durationS).toBeLessThan(traj.durationS);
    expect(kraken.durationS).toBeLessThan(traj.durationS);
  });

  it('current limit reaches the generator', () => {
    // 40 vs 80 A: a viable pair. At ≤30 A the loss term (draw at max drive
    // speed, clamped by the limit) cancels the available torque entirely and
    // the timeline degenerates to zero duration — upstream-identical physics
    // (trajectory.dart torqueLoss at v2025.2.7), characterized here, not
    // papered over.
    const low = applyProfileToTrajectory(traj, profile({ driveCurrentLimit: 40 }));
    const high = applyProfileToTrajectory(traj, profile({ driveCurrentLimit: 80 }));
    expect(low.durationS).toBeGreaterThan(high.durationS);
  });

  it('unknown motor type is visibly unsupported', () => {
    const p = profile({ driveMotorType: 'madeUp2027' });
    const resolved = resolveRobotConfig(p);
    expect(resolved.unknownMotorType).toBe('madeUp2027');
    expect(resolved.provenance.driveMotorType).toBe('unsupported');
    // Fallback is the default Kraken model with the profile's gearing still
    // applied (7.09 N·m stall × 6.08 reduction = 43.1072 N·m), never a guess.
    expect(resolved.config.moduleConfig.driveMotor.stallTorqueNM).toBeCloseTo(43.1072, 3);
    const applied = applyProfileToTrajectory(traj, p);
    expect(applied.warnings.join('\n')).toContain('drive motor "madeUp2027" not supported');
  });

  it('invalid current limit is recorded, not applied', () => {
    const p = profile({ driveCurrentLimit: -5 });
    const resolved = resolveRobotConfig(p);
    expect(resolved.provenance.driveCurrentLimitA).toBe('invalid');
    // Holonomic module = 1 motor → the per-module default stays 60 A.
    expect(resolved.config.moduleConfig.driveCurrentLimitA).toBe(60);
  });

  it('hand-built profile with non-positive gearing never scales the motor with it', () => {
    // Public-API path: a hand-built RobotProfile skips the parser guards
    // (Task 2 review minor), so resolveRobotConfig itself must treat a
    // non-positive driveGearing like a rejected file value — the default
    // 5.143 reduction applies, consistent with the provenance entry.
    const handBuilt: RobotProfile = {
      name: 'hand-built',
      geometry: DEFAULT_GEOMETRY,
      moduleLocations: [],
      holonomic: true,
      dynamics: { driveGearing: -3, driveMotorType: 'krakenX60' },
    };
    const resolved = resolveRobotConfig(handBuilt);
    expect(resolved.provenance.driveGearing).toBe('invalid');
    // Kraken X60 stall 7.09 N·m × default 5.143 = 36.46387 N·m at the
    // wheel; scaling with -3 would give -21.27 N·m.
    expect(resolved.config.moduleConfig.driveMotor.stallTorqueNM).toBeCloseTo(36.46387, 3);
  });

  it('non-positive mass and MOI are rejected as invalid, not passed to dynamics', () => {
    const p = profile({ robotMass: -10, robotMOI: 0 });
    const resolved = resolveRobotConfig(p);
    expect(resolved.provenance.massKG).toBe('invalid');
    expect(resolved.provenance.moiKGm2).toBe('invalid');
    // makeRobotConfig defaults (upstream Defaults): 74.088 kg, 6.883 kg·m².
    expect(resolved.config.massKG).toBe(74.088);
    expect(resolved.config.moi).toBe(6.883);
  });

  it('diff-drive doubles the per-motor current limit into the per-module total', () => {
    const p = profile({ holonomicMode: false, robotTrackwidth: 0.6, driveCurrentLimit: 80 });
    const resolved = resolveRobotConfig(p);
    expect(resolved.config.moduleConfig.driveCurrentLimitA).toBe(160);
    // numMotors = 2 for diff drive: Kraken stall 366 A × 2 motors = 732 A.
    expect(resolved.config.moduleConfig.driveMotor.stallCurrentAmps).toBe(732);
  });

  it('provenance marks every consumed parameter', () => {
    const complete = resolveRobotConfig(profile());
    expect(complete.provenance).toEqual({
      massKG: 'file',
      moiKGm2: 'file',
      wheelCOF: 'file',
      wheelRadiusM: 'file',
      driveGearing: 'file',
      maxDriveVelocityMPS: 'file',
      driveMotorType: 'file',
      driveCurrentLimitA: 'file',
      moduleLocations: 'file',
      holonomic: 'file',
    });
    expect(dynamicsConfigComplete(complete.provenance)).toBe(true);

    const noMotor = resolveRobotConfig(profile({ driveMotorType: undefined }));
    expect(noMotor.provenance.driveMotorType).toBe('default');
    expect(dynamicsConfigComplete(noMotor.provenance)).toBe(false);
  });

  it('DCMotor.isKnownMotorType matches the exact upstream case list', () => {
    // lib/trajectory/dc_motor.dart at v2025.2.7 (Task 1 citation): these 8
    // strings are every case fromString resolves; a real team's motor string
    // outside the list must surface as unsupported, not silently swapped.
    for (const known of [
      'krakenX60', 'krakenX60FOC', 'falcon500', 'falcon500FOC',
      'vortex', 'NEO', 'CIM', 'miniCIM',
    ]) {
      expect(DCMotor.isKnownMotorType(known)).toBe(true);
    }
    expect(DCMotor.isKnownMotorType('madeUp2027')).toBe(false);
    expect(DCMotor.isKnownMotorType('krakenx60')).toBe(false);
  });
});
