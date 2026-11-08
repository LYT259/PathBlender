import { describe, expect, it } from 'vitest';
import { detectObstacleCollisions, makeSession, obstaclesForField, REBUILT_2026 } from '../src';
import type { SessionTrajectory } from '../src';

const GEOMETRY = { lengthM: 0.9, widthM: 0.9, offsetX: 0, offsetY: 0 };

/** A 20 s lane spanning the full field length, offset in y per robot so the
 *  scan sweeps every hull of the obstacle set (helper shape from
 *  obstacle-detect.test.ts). */
function laneRobot(i: number, lengthM: number, widthM: number): SessionTrajectory {
  const y = 0.5 + (i * (widthM - 1)) / 5;
  const samples = [0, 20].map((t) => ({
    t,
    x: t === 0 ? 0.5 : lengthM - 0.5,
    y,
    heading: 0,
    vx: 0,
    vy: 0,
    omega: 0,
  }));
  return makeSession({
    id: `perf-${i}`,
    name: `perf-${i}`,
    teamName: '',
    teamNumber: '0000',
    source: 'choreo-traj',
    alliance: 'blue',
    durationS: 20,
    samples,
    geometry: GEOMETRY,
    geometrySource: 'file',
    moduleLocations: [],
    events: [],
    warnings: [],
  });
}

describe('obstacle scan performance', () => {
  it('full-scan budget: 6 robots × 20 s × the 2026 obstacle set stays well under 0.5 s', () => {
    const obstacles = obstaclesForField(REBUILT_2026, 'welded');
    const robots = Array.from({ length: 6 }, (_, i) => laneRobot(i, REBUILT_2026.lengthM, REBUILT_2026.widthM));
    // Warm up once (JIT).
    detectObstacleCollisions(robots, obstacles);
    const t0 = Date.now();
    const hits = detectObstacleCollisions(robots, obstacles);
    const elapsed = Date.now() - t0;
    expect(hits.length).toBeGreaterThan(0);
    // 500 ms is a ~10× margin over the expected tens of ms; if it ever
    // flakes on CI, re-measure and document the new baseline in this
    // comment before raising the bound — no silent self-green.
    expect(elapsed).toBeLessThan(500);
  });
});
