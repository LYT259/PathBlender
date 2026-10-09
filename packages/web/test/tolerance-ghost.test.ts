import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  detectCollisions,
  makeSession,
  obbOverlap,
  parseGhostAuto,
  poseToObb,
  samplePoseAt,
} from '@pathblender/core';
import { toleranceGhostsAt } from '../src/canvas2d-render';

const SAMPLES = resolve(__dirname, '../../../samples');
const read = (rel: string): string =>
  readFileSync(resolve(SAMPLES, rel), 'utf-8');

const load = (rel: string) =>
  makeSession(parseGhostAuto(read(`ghostauto/${rel}.ghostauto`), rel));

// The §6.5-① fixture pair: nominal plan is clean, only a slipped start
// collides — exactly the case the on-field ghost exists to show.
const tolerancePair = () => {
  const a = { ...load('straight_run'), startDelayS: 3.0 };
  const b = load('stop_and_score');
  const tol = detectCollisions([a, b], { toleranceS: 0.5 });
  expect(tol.length).toBeGreaterThanOrEqual(1);
  expect(tol.every((c) => c.kind === 'tolerance')).toBe(true);
  return { a, b, tol };
};

describe('toleranceGhostsAt', () => {
  it('inside the window, ghosts the shifted robot at its slipped-clock pose — and that pose collides with the plan', () => {
    const { a, b, tol } = tolerancePair();
    const c = tol[0]!;
    const ghosts = toleranceGhostsAt(tol, [a, b], c.closestT);
    expect(ghosts).toHaveLength(1);
    const g = ghosts[0]!;
    expect(g.robot.trajectory.id).toBe(b.trajectory.id);
    expect(g.offsetS).toBe(c.offsetS);
    expect(g.pose).toEqual(samplePoseAt(b, c.closestT - c.offsetS));
    // The whole point: the ghost visibly overlaps the solid plan robot at
    // this instant (same OBB test the scan itself passed to flag it).
    const pa = samplePoseAt(a, c.closestT);
    expect(
      obbOverlap(poseToObb(pa, a.trajectory.geometry), poseToObb(g.pose, b.trajectory.geometry)),
    ).toBe(true);
  });

  it('draws nothing outside the conflict window', () => {
    const { a, b, tol } = tolerancePair();
    const c = tol[0]!;
    expect(toleranceGhostsAt(tol, [a, b], c.startT - 0.05)).toHaveLength(0);
    expect(toleranceGhostsAt(tol, [a, b], c.endT + 0.05)).toHaveLength(0);
  });

  it('draws nothing for planned conflicts — the solid robots already overlap', () => {
    const a = load('straight_run');
    const b = load('stop_and_score');
    const planned = detectCollisions([a, b]);
    expect(planned.length).toBeGreaterThanOrEqual(1);
    expect(toleranceGhostsAt(planned, [a, b], planned[0]!.closestT)).toHaveLength(0);
  });

  it('skips ghosts whose robot is not on the field', () => {
    const { a, tol } = tolerancePair();
    expect(toleranceGhostsAt(tol, [a], tol[0]!.closestT)).toHaveLength(0);
  });
});
