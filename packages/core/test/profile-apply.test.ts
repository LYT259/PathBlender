import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  applyProfileToTrajectory,
  DCMotor,
  DEFAULT_GEOMETRY,
  deserializeSession,
  dynamicsConfigComplete,
  extractWpilogTrajectory,
  generateTrajectory,
  inspectWpilog,
  makeRobotConfig,
  makeSession,
  parsePathFile,
  parsePathJson,
  parsePathPlannerAuto,
  parseRobotProfile,
  parseTraj,
  resolveRobotConfig,
  serializeSession,
  trajectoryDuration,
} from '../src';
import type { RobotProfile, RobotConfig, Trajectory } from '../src';

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
    const profile = parseRobotProfile(
      JSON.stringify({ robotConfig: { robotWidth: 0.9, robotLength: 0.9, robotMass: 50 } }),
      'a/settings.json',
    )!;

    const choreo = parseTraj(read('traj/v3_swerve.traj'), 'v3_swerve.traj');
    const applied = applyProfileToTrajectory(choreo, profile);
    // Reference-equal: embedded samples survive application untouched.
    expect(applied.samples).toBe(choreo.samples);
    expect(applied.geometrySource).toBe('file');
    expect(applied.massKG).toBe(50);

    // WPILOG-derived trajectories embed logged poses — equally never regenerated.
    const wpilogTraj = extractMinimalPoseLog();
    const appliedLog = applyProfileToTrajectory(wpilogTraj, profile);
    expect(appliedLog.samples).toBe(wpilogTraj.samples);
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

describe('.auto regeneration', () => {
  // Pickup.path/Score.path are fully constraint-masked against mass alone
  // (their own constraints bind before the drive dynamics), so the routine's
  // first segment resolves to the dynamics-sensitive constrained_pointing.path
  // sample, and the profile is the Task 2 full synthetic set with a lower
  // current limit (40 A) — proven to retime both paths decisively.
  const autoText = read('pathplanner/Example Auto.auto');
  const constrainedText = read('pathplanner/constrained_pointing.path');
  const scoreText = read('pathplanner/Score.path');
  const resolveAutoPaths = (name: string): string | undefined =>
    name === 'Pickup' ? constrainedText : name === 'Score' ? scoreText : undefined;
  const parseAuto = () => parsePathPlannerAuto(autoText, 'Example Auto.auto', resolveAutoPaths);

  const currentLimitedProfile = parseRobotProfile(
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
      driveCurrentLimit: 40,
      flModuleX: 0.273, flModuleY: 0.273,
      frModuleX: -0.273, frModuleY: 0.273,
      blModuleX: 0.273, blModuleY: -0.273,
      brModuleX: -0.273, brModuleY: -0.273,
    }),
    '254/pathplanner/settings.json',
  )!;

  // Independently derived expectations: the auto chains the .path
  // generator's own timelines — d1 + 1s wait + 0s named + 1s wait + d2.
  // The generator is exercised directly here; the code under test is the
  // chaining and the regeneration branch.
  const segmentTimings = (config: RobotConfig) => {
    const g1 = generateTrajectory(parsePathJson(constrainedText, 'Pickup.path'), config);
    const g2 = generateTrajectory(parsePathJson(scoreText, 'Score.path'), config);
    return {
      d1: trajectoryDuration(g1.samples),
      d2: trajectoryDuration(g2.samples),
      markerT: g2.events.find((e) => e.name === 'Example Marker')!.t,
    };
  };
  const byDefault = segmentTimings(makeRobotConfig());
  const byProfile = segmentTimings(resolveRobotConfig(currentLimitedProfile).config);

  it('fixture check: the current limit really retimes both referenced paths', () => {
    expect(byProfile.d1).toBeGreaterThan(byDefault.d1);
    expect(byProfile.d2).toBeGreaterThan(byDefault.d2);
  });

  it('applying a profile regenerates every segment, shift, and event', () => {
    const traj = parseAuto();
    expect(traj.editable?.kind).toBe('pathplanner-auto');
    expect(traj.durationS).toBeCloseTo(byDefault.d1 + 2 + byDefault.d2, 6);

    const applied = applyProfileToTrajectory(traj, currentLimitedProfile);
    expect(applied.editable?.kind).toBe('pathplanner-auto');
    expect(applied.geometrySource).toBe('file');
    // Current-starved: less torque, longer timeline.
    expect(applied.durationS).toBeGreaterThan(traj.durationS);
    expect(applied.durationS).toBeCloseTo(byProfile.d1 + 2 + byProfile.d2, 6);

    // Events shift with the segments: 'print hello' fires after the first
    // segment plus its 1 s wait; Score's marker rides Score's own timeline
    // shifted by the new clock.
    const named = (t: Trajectory) => t.events.find((e) => e.name === 'print hello')!;
    expect(named(traj).t).toBeCloseTo(byDefault.d1 + 1, 6);
    expect(named(applied).t).toBeCloseTo(byProfile.d1 + 1, 6);
    const marker = (t: Trajectory) => t.events.find((e) => e.name === 'Example Marker')!;
    expect(marker(traj).t).toBeCloseTo(byDefault.d1 + 2 + byDefault.markerT, 6);
    expect(marker(applied).t).toBeCloseTo(byProfile.d1 + 2 + byProfile.markerT, 6);

    // Waits are preserved exactly: 10 Hz holds with zero velocity at one
    // fixed pose, across both waits (the named command moves nothing).
    const holdInterior = (t: Trajectory, start: number) => {
      const inside = t.samples.filter((s) => s.t > start + 1e-9 && s.t < start + 1 - 1e-9);
      // Offsets 0.1…0.9 — the 1.0 sample shares its t with the next
      // segment's first sample, so the interior is unambiguous.
      expect(inside).toHaveLength(9);
      for (let i = 0; i < inside.length; i++) {
        expect(inside[i]!.t).toBeCloseTo(start + (i + 1) / 10, 9);
        expect(inside[i]!.vx).toBe(0);
        expect(inside[i]!.vy).toBe(0);
        expect(inside[i]!.omega).toBe(0);
        expect(inside[i]!.x).toBeCloseTo(inside[0]!.x, 12);
        expect(inside[i]!.y).toBeCloseTo(inside[0]!.y, 12);
      }
      return { x: inside[0]!.x, y: inside[0]!.y };
    };
    const hold1 = holdInterior(traj, byDefault.d1);
    const hold2 = holdInterior(traj, byDefault.d1 + 1);
    expect([hold2.x, hold2.y]).toEqual([hold1.x, hold1.y]);
    const appliedHold1 = holdInterior(applied, byProfile.d1);
    const appliedHold2 = holdInterior(applied, byProfile.d1 + 1);
    // Geometry is config-independent: the robot parks at the same spot.
    expect(appliedHold1.x).toBeCloseTo(hold1.x, 12);
    expect(appliedHold1.y).toBeCloseTo(hold1.y, 12);
    expect([appliedHold2.x, appliedHold2.y]).toEqual([appliedHold1.x, appliedHold1.y]);

    // Named commands stay zero-duration events with their warning, and the
    // regenerated warnings never claim a robot config of their own.
    expect(applied.warnings[0]).toContain('regenerated with real robot config');
    expect(applied.warnings.join('\n')).toContain('named commands run in unknown time');
    expect(applied.warnings.join('\n')).not.toContain('generated with default robot config');
  });

  it('regeneration is deterministic', () => {
    const a = applyProfileToTrajectory(parseAuto(), currentLimitedProfile);
    const b = applyProfileToTrajectory(parseAuto(), currentLimitedProfile);
    expect(a.samples).toEqual(b.samples);
    expect(a.events).toEqual(b.events);
  });
});

/* Minimal byte-level WPILOG pose log (test-side only; mirrors the spec-exact
   writer in wpilog.test.ts, trimmed to what extraction needs: the Pose2d
   schema trio, one struct:Pose2d entry, no control word — the extraction
   interval is a manual range). */
function extractMinimalPoseLog(): Trajectory {
  const chunks: number[] = [];
  const enc = new TextEncoder();
  const u32 = (v: number) => [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff];
  const strField = (s: string) => [...u32(enc.encode(s).length), ...enc.encode(s)];
  const f64 = (v: number) => {
    const view = new DataView(new ArrayBuffer(8));
    view.setFloat64(0, v, true);
    return [...new Uint8Array(view.buffer)];
  };
  chunks.push(...enc.encode('WPILOG'), 0x00, 0x01, ...u32(0)); // v1.0, no extra header

  let nextId = 1;
  const record = (entryId: number, timestampUs: number, payload: number[]) => {
    const widthFor = (value: number, max: number) => {
      for (let len = 1; len < max; len++) if (value < 2 ** (8 * len)) return len;
      return max;
    };
    const idLen = widthFor(entryId, 4);
    const sizeLen = widthFor(payload.length, 4);
    const tsLen = widthFor(timestampUs, 8);
    chunks.push((idLen - 1) | ((sizeLen - 1) << 2) | ((tsLen - 1) << 4));
    for (let i = 0; i < idLen; i++) chunks.push(Math.floor(entryId / 2 ** (8 * i)) % 256);
    for (let i = 0; i < sizeLen; i++) chunks.push(Math.floor(payload.length / 2 ** (8 * i)) % 256);
    for (let i = 0; i < tsLen; i++) chunks.push(Math.floor(timestampUs / 2 ** (8 * i)) % 256);
    chunks.push(...payload);
  };
  const start = (name: string, type: string, payload?: number[]) => {
    const id = nextId++;
    record(0, 0, [0, ...u32(id), ...strField(name), ...strField(type), ...strField('')]);
    if (payload) record(id, 0, payload);
    return id;
  };

  start('NT:/.schema/struct:Pose2d', 'structschema', [
    ...enc.encode('Translation2d translation;Rotation2d rotation'),
  ]);
  start('NT:/.schema/struct:Translation2d', 'structschema', [...enc.encode('double x;double y')]);
  start('NT:/.schema/struct:Rotation2d', 'structschema', [...enc.encode('double value')]);
  const pose = start('NT:/Drivetrain/Pose', 'struct:Pose2d');
  const poses = [
    { tS: 0.0, x: 1.0, y: 1.0 },
    { tS: 0.5, x: 1.5, y: 1.0 },
    { tS: 1.0, x: 2.0, y: 1.0 },
  ];
  for (const p of poses) record(pose, p.tS * 1e6, [...f64(p.x), ...f64(p.y), ...f64(0)]);

  const bytes = new Uint8Array(chunks);
  const inspection = inspectWpilog(bytes, 'robot.wpilog');
  const candidate = inspection.candidates.find((c) => !c.likelyTarget)!;
  const traj = extractWpilogTrajectory(bytes, inspection, {
    pose: { mode: 'candidate', entryId: candidate.entryId, elementIndex: 0 },
    interval: { mode: 'manual', startS: 0, endS: 1 },
    lengthUnit: 'm',
    headingUnit: 'rad',
    name: 'robot.wpilog',
  });
  expect(traj.source).toBe('wpilog');
  expect(traj.samples).toHaveLength(3);
  return traj;
}
