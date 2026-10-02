import { describe, expect, it } from 'vitest';
import { parseRobotProfile, deserializeSession, serializeSession, makeSession, parseTraj } from '../src';
import { ParseError } from '../src';

const trajText = JSON.stringify({
  version: 1,
  name: 'L1',
  trajectory: { samples: [{ t: 0, x: 1, y: 1, heading: 0, vx: 1, vy: 0, omega: 0 }, { t: 2, x: 3, y: 1, heading: 0, vx: 0, vy: 0, omega: 0 }] },
});

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
