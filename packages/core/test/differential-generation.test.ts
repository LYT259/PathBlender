/**
 * Differential-drive generation: the same ported pipeline with a two-module
 * (tank) config — the module kinematics degenerate correctly.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { generateTrajectory, makeRobotConfig, parsePathJson } from '../src';

const SAMPLES = resolve(__dirname, '../../../samples');

describe('differential generation', () => {
  const pickup = parsePathJson(
    readFileSync(resolve(SAMPLES, 'pathplanner/Pickup.path'), 'utf-8'),
    'Pickup.path',
  );

  it('generates a sane tank-drive trajectory', () => {
    const config = makeRobotConfig({ holonomic: false });
    const t = generateTrajectory(pickup, config);
    const s = t.samples;

    expect(s.length).toBeGreaterThan(20);
    expect(t.totalTimeS).toBeGreaterThan(2);
    // Tank drive cannot strafe: the velocity vector must align with the
    // robot heading (cross-track component ≈ 0) whenever it is moving.
    for (const st of s) {
      const speed = Math.hypot(st.vx, st.vy);
      if (speed < 0.2) continue; // heading is noisy near standstill
      const velAngle = Math.atan2(st.vy, st.vx);
      const cross = Math.abs(speed * Math.sin(velAngle - st.heading));
      expect(cross, `t=${st.t.toFixed(2)}`).toBeLessThan(0.3);
    }
    // Ends at the path terminus, at rest.
    const last = s[s.length - 1]!;
    expect(last.x).toBeCloseTo(7.7269, 1);
    expect(Math.hypot(last.vx, last.vy)).toBeLessThan(0.05);
  });

  it('tank is slower or equal to swerve on the same path', () => {
    const swerve = generateTrajectory(pickup, makeRobotConfig()).totalTimeS;
    const tank = generateTrajectory(pickup, makeRobotConfig({ holonomic: false })).totalTimeS;
    expect(tank).toBeGreaterThanOrEqual(swerve - 0.05);
  });
});
