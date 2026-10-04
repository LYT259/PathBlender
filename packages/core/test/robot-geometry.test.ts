import { describe, expect, it } from 'vitest';
import {
  STEERING_STATIC_MPS,
  chassisModules,
  moduleBaseYaw,
  moduleSteeringAngles,
  robotVisualGeometry,
  seasonRobotProfile,
  withSeasonGeometry,
} from '../src';
import type { Trajectory } from '../src';

const IN = 0.0254;

/** Minimal trajectory stub for the visual/season resolvers. */
function traj(over: Partial<Trajectory>): Trajectory {
  return {
    id: 't',
    name: 't',
    teamName: '',
    teamNumber: '',
    source: 'ghostauto',
    alliance: 'blue',
    samples: [],
    durationS: 0,
    geometry: { lengthM: 1, widthM: 1, offsetX: 0, offsetY: 0 },
    geometrySource: 'default',
    moduleLocations: [],
    events: [],
    warnings: [],
    ...over,
  };
}

describe('seasonRobotProfile (rule-verified per-season maxima)', () => {
  type Row = [number, number, number, number, number];
  // year, frame length in, frame width in, bumper in/side, outer square/length in
  const rows: Row[] = [
    [2022, 30, 30, 3.25, 36.5],
    [2023, 30, 30, 3.25, 36.5],
    [2024, 30, 30, 3.25, 36.5],
    [2025, 30, 30, 4, 38],
    [2026, 27.5, 27.5, 4, 35.5],
  ];
  it.each(rows)('%i: frame %ix%i in + %s in bumper', (year, fl, fw, b, outerL) => {
    const p = seasonRobotProfile(year);
    expect(p.chassis.lengthM).toBeCloseTo(fl * IN, 6);
    expect(p.chassis.widthM).toBeCloseTo(fw * IN, 6);
    expect(p.bumperDepthM).toBeCloseTo(b * IN, 6);
    expect(p.outer.lengthM).toBeCloseTo(outerL * IN, 6);
    expect(p.outer.widthM).toBeCloseTo((fw + 2 * b) * IN, 6);
    expect(p.outer.offsetX).toBe(0);
    expect(p.outer.offsetY).toBe(0);
  });

  it('2026 is smaller than 2025 (perimeter dropped to 110 in)', () => {
    expect(seasonRobotProfile(2026).outer.lengthM).toBeLessThan(
      seasonRobotProfile(2025).outer.lengthM,
    );
  });

  it('unknown years (custom fields carry 0) fall back to the 2025 profile', () => {
    expect(seasonRobotProfile(0)).toEqual(seasonRobotProfile(2025));
    expect(seasonRobotProfile(2031)).toEqual(seasonRobotProfile(2025));
  });
});

describe('withSeasonGeometry', () => {
  it('file geometry passes through untouched (same reference)', () => {
    const t = traj({ geometrySource: 'file', geometry: { lengthM: 0.7, widthM: 0.6, offsetX: 0, offsetY: 0 } });
    const st = { trajectory: t, startDelayS: 0, color: '#fff', visible: true };
    expect(withSeasonGeometry(st, 2026)).toBe(st);
  });

  it('default geometry is re-resolved per season and memoized when equal', () => {
    const st = { trajectory: traj({}), startDelayS: 0, color: '#fff', visible: true };
    const a = withSeasonGeometry(st, 2023);
    expect(a.trajectory.geometry.lengthM).toBeCloseTo(0.9271, 6);
    const b = withSeasonGeometry(st, 2026);
    expect(b.trajectory.geometry.lengthM).toBeCloseTo(0.9017, 6);
    // Already at the season value → same object back (no re-render churn).
    expect(withSeasonGeometry(a, 2023)).toBe(a);
  });
});

describe('robotVisualGeometry (two layers)', () => {
  it('default robots get the season chassis inside the season bumper box', () => {
    const v = robotVisualGeometry(traj({}), 2025);
    expect(v.outer.lengthM).toBeCloseTo(0.9652, 6);
    expect(v.chassis.lengthM).toBeCloseTo(0.762, 6);
    expect(v.bumperDepthM).toBeCloseTo(4 * IN, 6);
  });

  it('file robots keep their box; the frame is inset by the season bumper', () => {
    const v = robotVisualGeometry(
      traj({ geometrySource: 'file', geometry: { lengthM: 0.8, widthM: 0.7, offsetX: 0.05, offsetY: -0.02 } }),
      2025,
    );
    expect(v.outer.lengthM).toBeCloseTo(0.8, 6);
    expect(v.chassis.lengthM).toBeCloseTo(0.8 - 2 * 4 * IN, 6);
    expect(v.chassis.offsetX).toBeCloseTo(0.05, 6);
  });
});

describe('chassisModules', () => {
  it('uses the file layout when present', () => {
    const t = traj({ moduleLocations: [{ x: 0.3, y: 0.3 }, { x: -0.3, y: 0.3 }] });
    expect(chassisModules(t, { lengthM: 0.762, widthM: 0.762 })).toEqual(t.moduleLocations);
  });

  it('defaults to four corners on the frame-CAD plate zones (proportional)', () => {
    const mods = chassisModules(traj({}), { lengthM: 0.762, widthM: 0.762 });
    expect(mods).toHaveLength(4);
    const ix = (0.762 / 2) * 0.8056;
    for (const sx of [1, -1]) {
      for (const sy of [1, -1]) {
        expect(mods.some((m) => Math.abs(m.x - sx * ix) < 1e-9 && Math.abs(m.y - sy * ix) < 1e-9)).toBe(true);
      }
    }
  });
});

describe('moduleSteeringAngles', () => {
  const mods = [
    { x: 0.3, y: 0.3 },
    { x: -0.3, y: 0.3 },
    { x: -0.3, y: -0.3 },
    { x: 0.3, y: -0.3 },
  ];

  it('pure forward drive: all wheels point along +x', () => {
    expect(moduleSteeringAngles({ heading: 0, vx: 1, vy: 0, omega: 0 }, mods)).toEqual([
      0, 0, 0, 0,
    ]);
  });

  it('forward drive at any heading still reads as forward in the robot frame', () => {
    const h = 2.2;
    expect(moduleSteeringAngles({ heading: h, vx: Math.cos(h), vy: Math.sin(h), omega: 0 }, mods)).toEqual([
      0, 0, 0, 0,
    ]);
  });

  it('sideways strafe: wheels point 90° left', () => {
    expect(moduleSteeringAngles({ heading: 0, vx: 0, vy: 1, omega: 0 }, mods)).toEqual([
      Math.PI / 2, Math.PI / 2, Math.PI / 2, Math.PI / 2,
    ]);
  });

  it('rotation in place: each wheel points tangentially (CCW, ω>0)', () => {
    // Module (+x,+y): v = (−ω·y, +ω·x) = (−0.3, 0.3) → 135°.
    // Module (−x,−y): v = (0.3, −0.3) → −45°.
    const a = moduleSteeringAngles({ heading: 0, vx: 0, vy: 0, omega: 1 }, mods);
    expect(a[0]).toBeCloseTo((3 * Math.PI) / 4, 9);
    expect(a[2]).toBeCloseTo(-Math.PI / 4, 9);
  });

  it('combined translate + rotate steers each wheel differently', () => {
    const a = moduleSteeringAngles({ heading: 0, vx: 1, vy: 0, omega: 2 }, mods);
    // Front-right (x=+0.3, y=−0.3): v=(1+0.6, 0.6) → atan2(0.6,1.6)≈20.6°;
    // rear-left (x=−0.3, y=+0.3): v=(0.4, −0.6) → atan2(−0.6,0.4)≈−56.3°.
    expect(a[3]).toBeCloseTo(Math.atan2(0.6, 1.6), 9);
    expect(a[1]).toBeCloseTo(Math.atan2(-0.6, 0.4), 9);
    expect(new Set(a).size).toBe(4);
  });

  it('stationary robot: all null (caller keeps the last pointing)', () => {
    const a = moduleSteeringAngles({ heading: 1, vx: 0, vy: 0, omega: 0 }, mods);
    expect(a).toEqual([null, null, null, null]);
  });

  it('creeping below the static threshold counts as parked', () => {
    const eps = STEERING_STATIC_MPS / 2;
    expect(moduleSteeringAngles({ heading: 0, vx: eps, vy: 0, omega: 0 }, mods)[0]).toBeNull();
  });
});

describe('moduleBaseYaw (installed per-corner orientation, from the user CAD)', () => {
  it('corners: tangential pinwheel, motor-side rays verified against the CAD', () => {
    expect(moduleBaseYaw({ x: 1, y: 1 })).toBeCloseTo(-Math.PI / 4, 9); // FL
    expect(moduleBaseYaw({ x: 1, y: -1 })).toBeCloseTo((-3 * Math.PI) / 4, 9); // FR
    expect(moduleBaseYaw({ x: -1, y: -1 })).toBeCloseTo((3 * Math.PI) / 4, 9); // RR
    expect(moduleBaseYaw({ x: -1, y: 1 })).toBeCloseTo(Math.PI / 4, 9); // RL
  });
});
