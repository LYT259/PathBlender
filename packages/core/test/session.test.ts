import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  applyAllianceChange,
  applyProfileToTrajectory,
  deserializeSession,
  flipPoseToBlue,
  makeSession,
  parseGhostAuto,
  parsePathFile,
  parseRobotProfile,
  parseTraj,
  REBUILT_2026,
  COLORBLIND_COLORS,
  remapColorblind,
  samplePoseAt,
  serializeSession,
  SESSION_COLORS,
  sessionDuration,
} from '../src';
import type { Trajectory } from '../src';

const SAMPLES = resolve(__dirname, '../../../samples');
const read = (rel: string): string =>
  readFileSync(resolve(SAMPLES, rel), 'utf-8');

describe('red→blue normalization (WPILib semantics)', () => {
  it('flips a pose 180° about the field center', () => {
    const p = flipPoseToBlue({ x: 1, y: 2, heading: 0.3 }, REBUILT_2026);
    expect(p.x).toBeCloseTo(REBUILT_2026.lengthM - 1, 9);
    expect(p.y).toBeCloseTo(REBUILT_2026.widthM - 2, 9);
    expect(p.heading).toBeCloseTo(Math.PI + 0.3 - 2 * Math.PI, 9); // wrapped
  });

  it('flip is an involution', () => {
    const p = { x: 4.2, y: 3.1, heading: 1.1 };
    const there = flipPoseToBlue(p, REBUILT_2026);
    const back = flipPoseToBlue(there, REBUILT_2026);
    expect(back.x).toBeCloseTo(p.x, 9);
    expect(back.y).toBeCloseTo(p.y, 9);
    expect(back.heading).toBeCloseTo(p.heading, 9);
  });

  it('applyAllianceChange flips every sample once and toggles back losslessly', () => {
    const traj = parseTraj(read('traj/v3_swerve.traj'), 'v3.traj');
    const red = applyAllianceChange(traj, 'red', REBUILT_2026);
    expect(red.alliance).toBe('red');
    expect(red.samples[0]!.x).toBeCloseTo(REBUILT_2026.lengthM - traj.samples[0]!.x, 9);
    const back = applyAllianceChange(red, 'blue', REBUILT_2026);
    expect(back.samples[0]!.x).toBeCloseTo(traj.samples[0]!.x, 9);
    expect(back.samples[0]!.heading).toBeCloseTo(traj.samples[0]!.heading, 9);
  });
});

describe('session sampling on the global clock', () => {
  const traj = parseGhostAuto(read('ghostauto/straight_run.ghostauto'), 's');
  const st = makeSession(traj);

  it('t<delay parks at the start pose; t>end clamps to last', () => {
    const delayed = { ...st, startDelayS: 2 };
    expect(samplePoseAt(delayed, 1).x).toBeCloseTo(2, 6);
    expect(samplePoseAt(delayed, 99).x).toBeCloseTo(11.96, 2);
    // At local t=1s, x = 2 + 1.2×1 = 3.2
    expect(samplePoseAt(delayed, 3).x).toBeCloseTo(3.2, 2);
  });

  it('session duration covers the latest end', () => {
    expect(sessionDuration([st, { ...st, startDelayS: 3 }])).toBeCloseTo(
      3 + traj.durationS,
      6,
    );
  });
});

describe('session file round-trip', () => {
  it('serialize → deserialize preserves everything needed', () => {
    const a = makeSession(parseGhostAuto(read('ghostauto/straight_run.ghostauto'), 'a'), 0);
    const b = { ...makeSession(parseTraj(read('traj/v3_swerve.traj'), 'b'), 1), startDelayS: 1.5 };
    const text = serializeSession([a, b], 'rebuilt-2026');
    // New files carry the post-rename marker.
    expect(JSON.parse(text).app).toBe('pathblender');
    const back = deserializeSession(text);
    expect(back.fieldId).toBe('rebuilt-2026');
    expect(back.robots).toHaveLength(2);
    expect(back.robots[1]!.startDelayS).toBeCloseTo(1.5, 9);
    expect(back.robots[0]!.trajectory.teamNumber).toBe('0001');
    expect(back.robots[1]!.trajectory.teamNumber).toBe('');
    expect(back.robots[0]!.trajectory.samples).toHaveLength(a.trajectory.samples.length);
    expect(back.robots[0]!.trajectory.geometry.lengthM).toBeCloseTo(0.9, 6);
    expect(back.robots[1]!.trajectory.geometrySource).toBe('file');
    // Restored robots behave identically.
    expect(samplePoseAt(back.robots[0]!, 4).x).toBeCloseTo(samplePoseAt(a, 4).x, 9);
  });

  it('pre-v1.4 session files (no teamNumber) still deserialize', () => {
    const a = makeSession(parseGhostAuto(read('ghostauto/straight_run.ghostauto'), 'a'), 0);
    const text = serializeSession([a], 'rebuilt-2026');
    const legacy = JSON.parse(text);
    for (const r of legacy.robots) delete r.teamNumber;
    const back = deserializeSession(JSON.stringify(legacy));
    expect(back.robots[0]!.trajectory.teamNumber).toBe('');
  });

  it('display names survive the round-trip and files without them still deserialize', () => {
    const a = makeSession(parseGhostAuto(read('ghostauto/straight_run.ghostauto'), 'a'), 0);
    a.trajectory.displayName = '红队射手';
    const text = serializeSession([a], 'rebuilt-2026');
    const back = deserializeSession(text);
    expect(back.robots[0]!.trajectory.displayName).toBe('红队射手');
    expect(back.robots[0]!.trajectory.teamNumber).toBe('0001');
    // Older session files simply lack the field.
    const legacy = JSON.parse(text);
    for (const r of legacy.robots) delete r.displayName;
    expect(deserializeSession(JSON.stringify(legacy)).robots[0]!.trajectory.displayName).toBeUndefined();
  });

  it('pre-rename marker (ghpathblender) still deserializes', () => {
    const a = makeSession(parseGhostAuto(read('ghostauto/straight_run.ghostauto'), 'a'), 0);
    const legacy = JSON.parse(serializeSession([a], 'rebuilt-2026'));
    legacy.app = 'ghpathblender';
    const back = deserializeSession(JSON.stringify(legacy));
    expect(back.robots).toHaveLength(1);
    expect(back.robots[0]!.trajectory.teamNumber).toBe('0001');
  });

  it('rejects foreign JSON', () => {
    expect(() => deserializeSession('{"app":"other"}')).toThrow();
  });
});


describe('session id persistence (save/load keeps identity)', () => {
  it('serialize→deserialize keeps trajectory ids, so the demo marker survives', () => {
    const traj = parseTraj(read('traj/v3_swerve.traj'), 'v3.traj');
    const st = makeSession(traj);
    const back = deserializeSession(serializeSession([st], 'rebuilt-2026'));
    expect(back.robots[0]?.trajectory.id).toBe(traj.id);
  });

  it('pre-persistence files (no stored id) still load with a fresh id', () => {
    const traj = parseTraj(read('traj/v3_swerve.traj'), 'v3.traj');
    const st = makeSession(traj);
    const file = JSON.parse(serializeSession([st], 'rebuilt-2026'));
    delete file.robots[0].id;
    const back = deserializeSession(JSON.stringify(file));
    expect(back.robots[0]?.trajectory.id).toBeTruthy();
    expect(back.robots[0]?.trajectory.id).not.toBe(traj.id);
  });
});

describe('timing source persistence (timingSource, 2026-11-07)', () => {
  const fullProfile = parseRobotProfile(
    JSON.stringify({
      robotWidth: 0.85, robotLength: 0.85, holonomicMode: true,
      robotMass: 150, robotMOI: 6.9, wheelCOF: 1.2,
      driveWheelRadius: 0.048, driveGearing: 6.08, maxDriveSpeed: 4.5,
      driveMotorType: 'krakenX60', driveCurrentLimit: 200,
      flModuleX: 0.273, flModuleY: 0.273, frModuleX: -0.273, frModuleY: 0.273,
      blModuleX: 0.273, blModuleY: -0.273, brModuleX: -0.273, brModuleY: -0.273,
    }),
    '254/pathplanner/settings.json',
  )!;
  const partialProfile = parseRobotProfile(
    JSON.stringify({ robotConfig: { robotWidth: 0.9, robotLength: 0.9, robotMass: 61.2 } }),
    '254/settings.json',
  )!;
  const full = applyProfileToTrajectory(
    parsePathFile(read('pathplanner/constrained_pointing.path'), 'constrained_pointing.path'),
    fullProfile,
  );
  const partial = applyProfileToTrajectory(
    parsePathFile(read('pathplanner/Pickup.path'), 'Pickup.path'),
    partialProfile,
  );
  const logged: Trajectory = {
    id: 'log-1',
    name: 'robot.wpilog',
    teamName: 'robot.wpilog',
    teamNumber: '',
    source: 'wpilog',
    alliance: 'blue',
    samples: [
      { t: 0, x: 1, y: 1, heading: 0, vx: 0, vy: 0, omega: 0 },
      { t: 1, x: 2, y: 1, heading: 0, vx: 1, vy: 0, omega: 0 },
    ],
    durationS: 1,
    geometry: { lengthM: 0.9, widthM: 0.9, offsetX: 0, offsetY: 0 },
    geometrySource: 'default',
    moduleLocations: [],
    events: [],
    warnings: [],
    timingSource: 'logged',
  };

  it('timingSource survives the session round trip', () => {
    const robots = [makeSession(full, 0), makeSession(partial, 1), makeSession(logged, 2)];
    // Route options ride along as whole trajectories — their timing state
    // must persist the same way (profile application reaches them in Task 6).
    robots[0]!.routeOptions = [{ id: 'r1', relPath: 'alt.path', trajectory: full }];
    const back = deserializeSession(serializeSession(robots, 'rebuilt-2026'));
    expect(back.robots.map((r) => r.trajectory.timingSource)).toEqual([
      'full-config',
      'partial-config',
      'logged',
    ]);
    expect(back.robots[0]!.routeOptions![0]!.trajectory.timingSource).toBe('full-config');
    // Choreo (undefined) stays absent — no key invented on write or read.
    const choreo = makeSession(parseTraj(read('traj/v3_swerve.traj'), 'v3.traj'), 3);
    const text = serializeSession([choreo], 'rebuilt-2026');
    expect((JSON.parse(text).robots[0] as Record<string, unknown>).timingSource).toBeUndefined();
    expect(deserializeSession(text).robots[0]!.trajectory.timingSource).toBeUndefined();
  });

  it('pre-timingSource session file restores without the field', () => {
    // Hand-written minimal v1 file exactly as a pre-2026-11-07 build wrote
    // it: no timingSource key anywhere, one robot.
    const legacy = JSON.stringify({
      app: 'pathblender',
      version: 1,
      fieldId: 'rebuilt-2026',
      robots: [
        {
          name: 'Old Path',
          teamName: '',
          source: 'pathplanner-path',
          alliance: 'blue',
          startDelayS: 0,
          color: '#C5A16A',
          visible: true,
          geometry: { lengthM: 0.9, widthM: 0.9, offsetX: 0, offsetY: 0 },
          geometrySource: 'file',
          moduleLocations: [],
          events: [],
          samples: [
            { t: 0, x: 1, y: 1, heading: 0, vx: 0, vy: 0, omega: 0 },
            { t: 2, x: 3, y: 1, heading: 0, vx: 0, vy: 0, omega: 0 },
          ],
        },
      ],
    });
    const back = deserializeSession(legacy);
    expect(back.robots[0]!.trajectory.timingSource).toBeUndefined();
    expect(back.robots[0]!.trajectory.samples).toHaveLength(2);
    expect(back.robots[0]!.trajectory.samples[0]!.x).toBe(1);
    expect(back.robots[0]!.trajectory.durationS).toBe(2);
  });

  it('invalid timingSource values are dropped, not crashed on or invented', () => {
    const file = JSON.parse(
      serializeSession(
        [
          {
            ...makeSession(full, 0),
            routeOptions: [{ id: 'r1', relPath: 'alt.path', trajectory: full }],
          },
        ],
        'rebuilt-2026',
      ),
    ) as {
      robots: Array<{ timingSource: unknown; routeOptions: Array<{ trajectory: { timingSource: unknown } }> }>;
    };
    file.robots[0]!.timingSource = 'wishful-thinking';
    file.robots[0]!.routeOptions[0]!.trajectory.timingSource = 'bogus';
    const back = deserializeSession(JSON.stringify(file));
    expect(back.robots[0]!.trajectory.timingSource).toBeUndefined();
    expect(back.robots[0]!.routeOptions![0]!.trajectory.timingSource).toBeUndefined();
    // The rest of the robot is intact.
    expect(back.robots[0]!.trajectory.samples.length).toBeGreaterThan(2);
  });
});

describe('colorblind palette remap (§7.3-3, landed 2026-10-04)', () => {
  it('maps default palette colors both ways and leaves custom colors untouched', () => {
    const a = SESSION_COLORS[0] as string;
    const cb = remapColorblind(a, true);
    expect(cb).not.toBe(a);
    expect(remapColorblind(cb, false)).toBe(a);
    expect(remapColorblind('#123456', true)).toBe('#123456');
    // wrap slots are documented lossy: index 9 wraps onto slot 1 and a
    // disable round trip restores slot 1's color, not the original.
    const last = SESSION_COLORS[9] as string;
    const wrapped = remapColorblind(last, true);
    expect(wrapped).toBe(COLORBLIND_COLORS[1]);
    expect(remapColorblind(wrapped, false)).toBe(SESSION_COLORS[1]);
  });
});

describe('legacy default color migration on session read (muted palette, 2026-10-05)', () => {
  const traj = parseGhostAuto(read('ghostauto/straight_run.ghostauto'), 'a');

  /** A session file as a pre-mutation build wrote it, with one robot color. */
  const sessionWithColor = (color: string): string => {
    const text = JSON.parse(serializeSession([makeSession(traj)], 'rebuilt-2026'));
    text.robots[0].color = color;
    return JSON.stringify(text);
  };

  it('remaps the three former default colors to the muted palette', () => {
    expect(deserializeSession(sessionWithColor('#FF6EC7')).robots[0]!.color).toBe(SESSION_COLORS[0]);
    expect(deserializeSession(sessionWithColor('#00E5FF')).robots[0]!.color).toBe(SESSION_COLORS[1]);
    expect(deserializeSession(sessionWithColor('#AAFF00')).robots[0]!.color).toBe(SESSION_COLORS[2]);
  });

  it('tolerates lowercase hex from hand-edited files', () => {
    expect(deserializeSession(sessionWithColor('#ff6ec7')).robots[0]!.color).toBe(SESSION_COLORS[0]);
  });

  it('leaves custom, colorblind-palette, and unchanged-slot colors untouched', () => {
    expect(deserializeSession(sessionWithColor('#123456')).robots[0]!.color).toBe('#123456');
    expect(deserializeSession(sessionWithColor(COLORBLIND_COLORS[0]!)).robots[0]!.color).toBe(COLORBLIND_COLORS[0]);
    // Slots 4–10 never changed; their values pass through as-is.
    expect(deserializeSession(sessionWithColor('#FF9100')).robots[0]!.color).toBe('#FF9100');
  });

  it('a migrated color remaps through the colorblind toggle like a fresh one', () => {
    const restored = deserializeSession(sessionWithColor('#FF6EC7')).robots[0]!;
    expect(remapColorblind(restored.color, true)).toBe(COLORBLIND_COLORS[0]);
  });
});
