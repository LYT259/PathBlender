import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseRobotProfile, deserializeSession, serializeSession, makeSession, parseTraj } from '../src';
import { ParseError } from '../src';

const trajText = JSON.stringify({
  version: 1,
  name: 'L1',
  trajectory: { samples: [{ t: 0, x: 1, y: 1, heading: 0, vx: 1, vy: 0, omega: 0 }, { t: 2, x: 3, y: 1, heading: 0, vx: 0, vy: 0, omega: 0 }] },
});

// Real Choreo project file (BLACKHOLE2026 deploy, committed 2026-10-04):
// project-form config wraps every value as {exp, val} ("17.73623005 in").
const chorSample = readFileSync(resolve(__dirname, '../../../samples/choreo/choreo.chor'), 'utf-8');

describe('parseRobotProfile (PathPlanner settings.json, both generations)', () => {
  it('reads the 2024+ nested robotConfig shape', () => {
    const text = JSON.stringify({
      generationSettings: { defaultMaxVel: 5 },
      robotConfig: {
        holonomicMode: true,
        robotMassKg: 68,
        robotWidth: 0.85,
        robotLength: 1.02,
        modules: [{ x: 0.3, y: 0.3 }, { x: 0.3, y: -0.3 }, { x: -0.3, y: 0.3 }, { x: -0.3, y: -0.3 }],
      },
    });
    const profile = parseRobotProfile(text, '254/deploy/pathplanner/settings.json');
    expect(profile).not.toBeNull();
    expect(profile!.name).toBe('pathplanner'); // nearest folder, not the stem
    expect(profile!.geometry.widthM).toBeCloseTo(0.85);
    expect(profile!.geometry.lengthM).toBeCloseTo(1.02);
    expect(profile!.moduleLocations).toHaveLength(4);
    expect(profile!.massKG).toBe(68);
    expect(profile!.holonomic).toBe(true);
  });

  it('reads the 2023- top-level shape', () => {
    const text = JSON.stringify({
      isHolonomic: true,
      robotWidth: 0.9,
      robotLength: 0.9,
      moduleLocations: [{ x: 0.25, y: 0.25 }, { x: 0.25, y: -0.25 }],
    });
    const profile = parseRobotProfile(text, 'settings.json');
    expect(profile).not.toBeNull();
    expect(profile!.name).toBe('settings'); // root of the drop: stem stands in
    expect(profile!.geometry.widthM).toBeCloseTo(0.9);
    expect(profile!.moduleLocations).toHaveLength(2);
    expect(profile!.holonomic).toBe(true);
  });

  it('falls back to defaults for the missing dimension and unparseable modules', () => {
    const profile = parseRobotProfile(JSON.stringify({ robotConfig: { robotWidth: 0.7 } }), 'a/settings.json');
    expect(profile!.geometry.widthM).toBeCloseTo(0.7);
    // Missing length falls back to DEFAULT_GEOMETRY (0.9652 m, the 2025
    // rule-max placeholder — re-resolved per season at consumption time).
    expect(profile!.geometry.lengthM).toBeCloseTo(0.9652);
    expect(profile!.moduleLocations).toEqual([]);
    expect(profile!.massKG).toBeUndefined();
  });

  it('names the profile after the team folder for direct folder drops', () => {
    const profile = parseRobotProfile(JSON.stringify({ robotConfig: { robotLength: 1 } }), '254/settings.json');
    expect(profile!.name).toBe('254');
  });

  it('returns null for trajectory files and unrelated JSON so callers can fall through', () => {
    expect(parseRobotProfile(trajText, 'L1.traj')).toBeNull();
    expect(parseRobotProfile('{"hello":"world"}', 'x.json')).toBeNull();
    expect(parseRobotProfile(JSON.stringify({ waypoints: [], globalConstraints: {} }), 'p.path')).toBeNull();
  });

  it('throws the shared invalid-json error for non-JSON text', () => {
    expect(() => parseRobotProfile('not json', 'settings.json')).toThrow(ParseError);
  });
});

describe('v2025.2.7 flat settings.json fields (upstream home_page.dart writer)', () => {
  // The real file is top-level flat: every key sits at the JSON root exactly
  // as _saveProjectSettingsToFile writes it at tag v2025.2.7 — no robotConfig
  // or generationSettings wrapper. Module corner order matches upstream
  // RobotConfig.fromPrefs: [fl, fr, bl, br] with fl=(+x,+y), fr=(+x,-y).
  const flatSettings = JSON.stringify({
    robotWidth: 0.85,
    robotLength: 0.85,
    holonomicMode: true,
    robotMass: 68,
    flModuleX: 0.273, flModuleY: 0.273,
    frModuleX: 0.273, frModuleY: -0.273,
    blModuleX: -0.273, blModuleY: 0.273,
    brModuleX: -0.273, brModuleY: -0.273,
    driveMotorType: 'falcon500FOC',
    driveCurrentLimit: 80,
  });

  it('reads flat module corners, motor type, and current limit', () => {
    const profile = parseRobotProfile(flatSettings, '254/deploy/pathplanner/settings.json');
    expect(profile).not.toBeNull();
    expect(profile!.holonomic).toBe(true);
    expect(profile!.massKG).toBe(68);
    expect(profile!.moduleLocations).toEqual([
      { x: 0.273, y: 0.273 },
      { x: 0.273, y: -0.273 },
      { x: -0.273, y: 0.273 },
      { x: -0.273, y: -0.273 },
    ]);
    expect(profile!.dynamics!.driveMotorType).toBe('falcon500FOC');
    expect(profile!.dynamics!.driveCurrentLimitA).toBe(80);
    expect(profile!.rejectedGenerationFields).toBeUndefined();
  });

  it('ignores partial flat corners and falls back to nested modules', () => {
    // One stray flat corner inside a robotConfig must not hijack the nested
    // modules array: the flat set is all-or-nothing (eight finite values).
    const nested = parseRobotProfile(
      JSON.stringify({
        robotConfig: {
          robotWidth: 0.85,
          robotLength: 0.85,
          flModuleX: 0.3,
          modules: [{ x: 0.25, y: 0.25 }, { x: 0.25, y: -0.25 }],
        },
      }),
      'a/settings.json',
    );
    expect(nested!.moduleLocations).toHaveLength(2);
    expect(nested!.moduleLocations[0]).toEqual({ x: 0.25, y: 0.25 });

    // Six of eight corners present → the flat set is absent as far as the
    // parser is concerned, and there is nothing to fall back to.
    const partial = parseRobotProfile(
      JSON.stringify({
        robotWidth: 0.85,
        robotLength: 0.85,
        flModuleX: 0.3, flModuleY: 0.3,
        frModuleX: 0.3, frModuleY: -0.3,
        blModuleX: -0.3, blModuleY: 0.3,
      }),
      'a/settings.json',
    );
    expect(partial!.moduleLocations).toEqual([]);
  });

  it('rejects non-positive current limit but records the raw value as rejected', () => {
    const profile = parseRobotProfile(
      JSON.stringify({
        robotWidth: 0.9,
        robotLength: 0.9,
        driveMotorType: 'falcon500FOC',
        driveCurrentLimit: 0,
      }),
      'a/settings.json',
    );
    expect(profile!.dynamics!.driveCurrentLimitA).toBeUndefined();
    expect(profile!.dynamics!.driveMotorType).toBe('falcon500FOC');
    // Metadata distinguishes "file said 0" from "file said nothing".
    expect(profile!.rejectedGenerationFields).toEqual({ driveCurrentLimit: 0 });

    const emptyMotor = parseRobotProfile(
      JSON.stringify({
        robotWidth: 0.9,
        robotLength: 0.9,
        driveMotorType: '',
        driveCurrentLimit: 60,
      }),
      'a/settings.json',
    );
    expect(emptyMotor!.dynamics!.driveMotorType).toBeUndefined();
    expect(emptyMotor!.dynamics!.driveCurrentLimitA).toBe(60);
    expect(emptyMotor!.rejectedGenerationFields).toEqual({ driveMotorType: '' });
  });

  it('prefers flat corners over nested modules when both exist', () => {
    // Upstream current versions write flat corners; a legacy nested array in
    // the same file must not win.
    const profile = parseRobotProfile(
      JSON.stringify({
        robotWidth: 0.85,
        robotLength: 0.85,
        holonomicMode: true,
        flModuleX: 0.273, flModuleY: 0.273,
        frModuleX: 0.273, frModuleY: -0.273,
        blModuleX: -0.273, blModuleY: 0.273,
        brModuleX: -0.273, brModuleY: -0.273,
        modules: [{ x: 9, y: 9 }],
      }),
      'a/settings.json',
    );
    expect(profile!.moduleLocations).toHaveLength(4);
    expect(profile!.moduleLocations[0]).toEqual({ x: 0.273, y: 0.273 });
    expect(profile!.moduleLocations.some((m) => m.x === 9)).toBe(false);
  });

  it('builds the diff-drive layout from robotTrackwidth when holonomicMode is false', () => {
    // Mirrors RobotConfig.fromPrefs at v2025.2.7: non-holonomic projects
    // ignore the flat corner fields and use (0, ±trackwidth/2).
    const profile = parseRobotProfile(
      JSON.stringify({
        robotWidth: 0.85,
        robotLength: 0.85,
        holonomicMode: false,
        robotTrackwidth: 0.7,
        flModuleX: 0.273, flModuleY: 0.273,
        frModuleX: 0.273, frModuleY: -0.273,
        blModuleX: -0.273, blModuleY: 0.273,
        brModuleX: -0.273, brModuleY: -0.273,
      }),
      'a/settings.json',
    );
    expect(profile!.holonomic).toBe(false);
    expect(profile!.moduleLocations).toEqual([{ x: 0, y: 0.35 }, { x: 0, y: -0.35 }]);
  });
});

describe('parseRobotProfile (Choreo project .chor, red book v1.15 companion read)', () => {
  it('parses the real committed sample: bumper, mirrored modules, mass, drive type', () => {
    const profile = parseRobotProfile(chorSample, 'BLACKHOLE2026-auto-paths/choreo/choreo.chor');
    expect(profile).not.toBeNull();
    expect(profile!.name).toBe('choreo'); // nearest folder, mirroring settings.json
    // bumper front+back = 0.901 m overall; side*2 = 0.901 m.
    expect(profile!.geometry.lengthM).toBeCloseTo(0.90100048654, 9);
    expect(profile!.geometry.widthM).toBeCloseTo(0.90100048654, 9);
    expect(profile!.geometry.offsetX).toBe(0);
    expect(profile!.moduleLocations).toHaveLength(4);
    expect(profile!.moduleLocations[0]).toEqual({ x: 0.281499945, y: 0.289000057 });
    expect(profile!.moduleLocations[1]).toEqual({ x: 0.281499945, y: -0.289000057 });
    expect(profile!.massKG).toBe(65);
    expect(profile!.holonomic).toBe(true); // type: "Swerve"
  });

  it('unwraps {exp, val} pairs and reads Differential as non-holonomic', () => {
    const text = JSON.stringify({
      name: 'choreo',
      version: 2,
      type: 'Differential',
      config: {
        mass: { exp: '65 kg', val: 65 },
        bumper: {
          front: { exp: '14 in', val: 0.3556 },
          side: { exp: '12 in', val: 0.3048 },
          back: { exp: '14 in', val: 0.3556 },
        },
      },
    });
    const profile = parseRobotProfile(text, 'team/choreo.chor');
    expect(profile).not.toBeNull();
    expect(profile!.geometry.lengthM).toBeCloseTo(0.7112, 9);
    expect(profile!.geometry.widthM).toBeCloseTo(0.6096, 9);
    expect(profile!.moduleLocations).toEqual([]); // no module corners carried
    expect(profile!.massKG).toBe(65);
    expect(profile!.holonomic).toBe(false);
  });

  it('also accepts plain-number config values (embedded .traj form)', () => {
    const text = JSON.stringify({
      type: 'Swerve',
      config: {
        mass: 65,
        bumper: { front: 0.45, side: 0.45, back: 0.45 },
        frontLeft: { x: 0.28, y: 0.29 },
        backLeft: { x: -0.28, y: 0.29 },
      },
    });
    const profile = parseRobotProfile(text, 'choreo.chor');
    expect(profile).not.toBeNull();
    expect(profile!.geometry.lengthM).toBeCloseTo(0.9);
    expect(profile!.moduleLocations).toHaveLength(4);
    expect(profile!.massKG).toBe(65);
  });

  it('returns null without a usable bumper so the caller falls through', () => {
    expect(parseRobotProfile(JSON.stringify({ type: 'Swerve', variables: {}, config: { mass: 65 } }), 'a/choreo.chor')).toBeNull();
    expect(parseRobotProfile(JSON.stringify({ type: 'Swerve', config: { bumper: { front: 9, side: 9, back: 9 } } }), 'a/choreo.chor')).toBeNull();
  });

  it('returns null for .traj files whose config is nested under trajectory', () => {
    const nested = JSON.stringify({
      name: 'L1',
      version: 3,
      trajectory: { config: { bumper: { front: 0.45, side: 0.45, back: 0.45 } }, samples: [] },
    });
    expect(parseRobotProfile(nested, 'L1.traj')).toBeNull();
  });
});

describe('SessionTrajectory.routeId round-trip', () => {
  it('survives serialize → deserialize and stays optional for old files', () => {
    const traj = parseTraj(trajText, 'L1.traj');
    const robot = { ...makeSession(traj, 0), routeId: 'route-7' };
    const restored = deserializeSession(serializeSession([robot], 'rebuilt-2026'));
    expect(restored.robots[0]!.routeId).toBe('route-7');
    // Old sessions without the field still load.
    const legacy = JSON.parse(serializeSession([robot], 'rebuilt-2026'));
    delete legacy.robots[0].routeId;
    expect(deserializeSession(JSON.stringify(legacy)).robots[0]!.routeId).toBeUndefined();
  });
});
