import { describe, expect, it } from 'vitest';
import { lerpAngle, sampleTrajectory, wrapAngle } from '../src';
import type { TrajectorySample } from '../src';

const mk = (t: number, x: number, heading = 0): TrajectorySample => ({
  t,
  x,
  y: 0,
  heading,
  vx: 0,
  vy: 0,
  omega: 0,
});

describe('wrapAngle / lerpAngle', () => {
  it('wraps into (-π, π]', () => {
    expect(wrapAngle(0)).toBe(0);
    expect(wrapAngle(Math.PI)).toBeCloseTo(Math.PI);
    expect(wrapAngle(-Math.PI)).toBeCloseTo(Math.PI);
    expect(wrapAngle(3 * Math.PI)).toBeCloseTo(Math.PI);
    expect(wrapAngle(7)).toBeCloseTo(7 - 2 * Math.PI);
  });

  it('interpolates through the short arc', () => {
    expect(lerpAngle(3.0, -3.0, 0.5)).toBeCloseTo(Math.PI, 6); // through +π
    expect(lerpAngle(0.1, -0.1, 0.5)).toBeCloseTo(0, 6);
  });
});

describe('sampleTrajectory', () => {
  const samples = [mk(0, 0), mk(1, 10), mk(2, 20)];

  it('clamps before start and after end', () => {
    expect(sampleTrajectory(samples, -5)?.x).toBe(0);
    expect(sampleTrajectory(samples, 99)?.x).toBe(20);
  });

  it('interpolates linearly', () => {
    expect(sampleTrajectory(samples, 0.5)?.x).toBeCloseTo(5);
    expect(sampleTrajectory(samples, 1.25)?.x).toBeCloseTo(12.5);
  });

  it('handles heading wrap-around at the seam', () => {
    const turning = [
      { ...mk(0, 0, 3.0) },
      { ...mk(1, 1, -3.0) }, // = 3.283… mod 2π — should pass through +π
    ];
    const mid = sampleTrajectory(turning, 0.5)!;
    expect(mid.heading).toBeCloseTo(Math.PI, 6);
  });

  it('returns undefined for empty input', () => {
    expect(sampleTrajectory([], 0)).toBeUndefined();
  });
});
