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
