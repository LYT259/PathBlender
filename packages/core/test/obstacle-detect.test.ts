import { describe, expect, it } from 'vitest';
import { BOUNDS_TOLERANCE_M, detectObstacleCollisions, makeSession } from '../src';
import type { FieldObstacle, SessionTrajectory } from '../src';

// Square obstacle footprint (2,2)-(3,3), CCW, ground to 1 m.
const HUB: FieldObstacle = {
  id: 'test-hub',
  name: 'Test Hub',
  hull: [
    { x: 2, y: 2 },
    { x: 3, y: 2 },
    { x: 3, y: 3 },
    { x: 2, y: 3 },
  ],
  zMinM: 0,
  zMaxM: 1,
};

const GEOMETRY = { lengthM: 0.9, widthM: 0.9, offsetX: 0, offsetY: 0 };

function robot(
  id: string,
  samples: ReadonlyArray<{ t: number; x: number; y: number }>,
): SessionTrajectory {
  const duration = samples[samples.length - 1]!.t;
  return makeSession({
    id,
    name: id,
    teamName: '',
    teamNumber: '8814',
    source: 'choreo-traj',
    alliance: 'blue',
    durationS: duration,
    samples: samples.map((s) => ({ t: s.t, x: s.x, y: s.y, heading: 0, vx: 0, vy: 0, omega: 0 })),
    geometry: GEOMETRY,
    geometrySource: 'file',
    moduleLocations: [],
    events: [],
    warnings: [],
  });
}

// Robot parked with its bumper entering the hull's left face (x=2) by
// overlap meters — mirrors the field-bounds wall regression: the SAT MTV
// depth then equals `overlap` exactly (y stays fully alongside).
function grazer(overlapM: number): SessionTrajectory {
  const x = 2 - GEOMETRY.lengthM / 2 + overlapM;
  return robot(`graze-${overlapM}`, [
    { t: 0, x, y: 2.5 },
    { t: 1, x, y: 2.5 },
  ]);
}

describe('detectObstacleCollisions', () => {
  it('flags a path driven through the obstacle with interval, depth and worst pose', () => {
    // Straight line x(t) = 0.5 + t along y = 2.5: crosses the hull t≈1..3.
    const bot = robot('crosser', [
      { t: 0, x: 0.5, y: 2.5 },
      { t: 4, x: 4.5, y: 2.5 },
    ]);
    const hits = detectObstacleCollisions([bot], [HUB]);
    expect(hits).toHaveLength(1);
    const hit = hits[0]!;
    expect(hit.robotId).toBe('crosser');
    expect(hit.obstacleId).toBe('test-hub');
    expect(hit.startT).toBeGreaterThan(1);
    expect(hit.startT).toBeLessThan(2);
    expect(hit.endT).toBeGreaterThan(2);
    expect(hit.endT).toBeLessThan(3);
    expect(hit.maxPenetrationM).toBeGreaterThan(0);
    // Worst pose sits inside the hull footprint.
    expect(hit.worstPose.x).toBeGreaterThan(2);
    expect(hit.worstPose.x).toBeLessThan(3);
    expect(hit.worstPose.y).toBeGreaterThan(2);
    expect(hit.worstPose.y).toBeLessThan(3);
  });

  it('forgives a graze below BOUNDS_TOLERANCE_M but reports at the threshold', () => {
    expect(detectObstacleCollisions([grazer(0.0761)], [HUB])).toEqual([]);
    const at = detectObstacleCollisions([grazer(BOUNDS_TOLERANCE_M)], [HUB]);
    expect(at).toHaveLength(1);
    expect(at[0]!.maxPenetrationM).toBeCloseTo(BOUNDS_TOLERANCE_M, 9);
  });

  it('merges samples separated by < 1.5 steps into one interval', () => {
    // Constant-inside dwell for the whole run: every sample hits contiguously.
    const bot = robot('dweller', [
      { t: 0, x: 2.5, y: 2.5 },
      { t: 1, x: 2.5, y: 2.5 },
    ]);
    expect(detectObstacleCollisions([bot], [HUB])).toHaveLength(1);
  });

  it('empty obstacle list returns empty', () => {
    const bot = robot('crosser', [
      { t: 0, x: 0.5, y: 2.5 },
      { t: 4, x: 4.5, y: 2.5 },
    ]);
    expect(detectObstacleCollisions([bot], [])).toEqual([]);
  });

  it('default step is 0.05 s', () => {
    // Inside the hull exactly over t∈[1.02, 2.97]: the 0.05 grid from 0
    // first lands inside at 1.05 and last at 2.95.
    const bot = robot('banded', [
      { t: 0, x: 0.5, y: 2.5 },
      { t: 1.0, x: 1.5, y: 2.5 },
      { t: 1.02, x: 2.5, y: 2.5 },
      { t: 2.97, x: 2.5, y: 2.5 },
      { t: 3.0, x: 3.5, y: 2.5 },
      { t: 4.0, x: 3.5, y: 2.5 },
    ]);
    const hits = detectObstacleCollisions([bot], [HUB]);
    expect(hits).toHaveLength(1);
    expect(hits[0]!.startT).toBeCloseTo(1.05, 9);
    expect(hits[0]!.endT).toBeCloseTo(2.95, 9);
  });

  it('honors a custom stepS option', () => {
    const bot = robot('banded', [
      { t: 0, x: 0.5, y: 2.5 },
      { t: 1.0, x: 1.5, y: 2.5 },
      { t: 1.02, x: 2.5, y: 2.5 },
      { t: 2.97, x: 2.5, y: 2.5 },
      { t: 3.0, x: 3.5, y: 2.5 },
      { t: 4.0, x: 3.5, y: 2.5 },
    ]);
    // Coarse 0.5 grid from 0: first inside sample 1.5, last 2.5.
    const hits = detectObstacleCollisions([bot], [HUB], { stepS: 0.5 });
    expect(hits).toHaveLength(1);
    expect(hits[0]!.startT).toBeCloseTo(1.5, 9);
    expect(hits[0]!.endT).toBeCloseTo(2.5, 9);
  });
});
