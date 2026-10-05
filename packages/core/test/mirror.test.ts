import { describe, expect, it } from 'vitest';
import { DEFAULT_GEOMETRY, REBUILT_2026, makeSession, mirrorAcrossLongAxis, samplePoseAt, serializeSession, deserializeSession, type Trajectory } from '../src';

function traj(): Trajectory {
  return {
    id: 't1', name: 'A', teamName: 'Team', teamNumber: '254', source: 'ghostauto', alliance: 'blue',
    samples: [
      { t: 0, x: 2, y: 1, heading: 0.5, vx: 1, vy: 0.5, omega: 0.25 },
      { t: 1, x: 3, y: 2, heading: -1, vx: 2, vy: -1, omega: -0.5 },
      { t: 2, x: 4, y: 3, heading: 3, vx: 0, vy: 0, omega: 0 },
    ],
    durationS: 2,
    geometry: DEFAULT_GEOMETRY,
    geometrySource: 'file',
    moduleLocations: [],
    events: [{ name: 'score', t: 1.5 }],
    warnings: [],
  };
}

describe('mirrorAcrossLongAxis', () => {
  it('reflects y, heading, vy and ω across the long centerline and leaves x, vx and events alone', () => {
    const field = REBUILT_2026;
    const mirrored = mirrorAcrossLongAxis(traj(), field);
    expect(mirrored.samples.map((s) => s.y)).toEqual([field.widthM - 1, field.widthM - 2, field.widthM - 3]);
    expect(mirrored.samples.map((s) => s.x)).toEqual([2, 3, 4]);
    expect(mirrored.samples.map((s) => s.vx)).toEqual([1, 2, 0]);
    expect(mirrored.samples[0]).toMatchObject({ heading: -0.5, vy: -0.5, omega: -0.25 });
    expect(mirrored.durationS).toBe(2);
    expect(mirrored.events).toEqual([{ name: 'score', t: 1.5 }]);
    // Headings wrap into the (-π, π] window: -3 rad is already inside it.
    expect(mirrored.samples[2]!.heading).toBeCloseTo(-3, 12);
  });

  it('is an involution: mirroring twice restores the samples bit-for-bit', () => {
    const field = REBUILT_2026;
    const twice = mirrorAcrossLongAxis(mirrorAcrossLongAxis(traj(), field), field);
    const original = traj();
    expect(twice.samples).toEqual(original.samples);
  });

  it('works for either stored alliance because it never reads traj.alliance', () => {
    const field = REBUILT_2026;
    const red: Trajectory = {
      ...traj(),
      alliance: 'red',
      samples: traj().samples.map((s) => ({ ...s, x: field.lengthM - s.x, y: field.widthM - s.y, heading: s.heading + Math.PI, vx: -s.vx, vy: -s.vy })),
    };
    const mirrored = mirrorAcrossLongAxis(red, field);
    expect(mirrored.samples[0]!.y).toBeCloseTo(field.widthM - (field.widthM - 1), 12);
    expect(mirrored.samples[0]!.x).toBe(field.lengthM - 2);
  });

  it('mirrors compositions end-to-end through the session sampling (poses follow the reflection)', () => {
    const field = REBUILT_2026;
    const robot = makeSession(traj());
    const mirrored = { ...makeSession(mirrorAcrossLongAxis(traj(), field)), mirrored: true };
    for (const t of [0, 0.5, 1, 2]) {
      const a = samplePoseAt(robot, t);
      const b = samplePoseAt(mirrored, t);
      expect(b.y).toBeCloseTo(field.widthM - a.y, 12);
      expect(b.x).toBeCloseTo(a.x, 12);
    }
  });

  it('round-trips the mirrored flag through the session file', () => {
    const plain = makeSession(traj());
    const flagged = { ...makeSession(mirrorAcrossLongAxis(traj(), REBUILT_2026)), mirrored: true };
    for (const robot of [plain, flagged]) {
      const restored = deserializeSession(serializeSession([robot], REBUILT_2026.id)).robots[0]!;
      expect(restored.mirrored).toBe(robot.mirrored);
    }
    // Old files without the flag read as off.
    const legacy = deserializeSession(serializeSession([plain], REBUILT_2026.id).replace('"mirrored": true,', '')).robots[0]!;
    expect(legacy.mirrored).toBeUndefined();
  });
});
