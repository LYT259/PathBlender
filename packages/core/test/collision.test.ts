import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { detectCollisions, makeSession, minimumSeparation } from '../src';
import { parseGhostAuto } from '../src';

const SAMPLES = resolve(__dirname, '../../../samples');
const read = (rel: string): string =>
  readFileSync(resolve(SAMPLES, rel), 'utf-8');

const load = (rel: string) =>
  makeSession(parseGhostAuto(read(`ghostauto/${rel}.ghostauto`), rel));

describe('detectCollisions on tuned real-format samples', () => {
  it('straight_run × stop_and_score collide near (7.5, 2) around t≈3.8–5.0 s', () => {
    const a = load('straight_run');
    const b = load('stop_and_score');
    const hits = detectCollisions([a, b]);
    expect(hits.length).toBeGreaterThanOrEqual(1);
    const first = hits[0]!;
    // A enters bumper contact (0.9 m combined) of the parked B at x≈6.6 → t≈3.83.
    expect(first.startT).toBeGreaterThan(3.7);
    expect(first.startT).toBeLessThan(4.0);
    expect(first.endT).toBeGreaterThan(4.9);
    expect(first.closestA.x).toBeGreaterThan(6.5);
    expect(first.closestA.x).toBeLessThan(8.5);
    expect(first.closestB.y).toBeGreaterThan(1.5);
    expect(first.closestB.y).toBeLessThan(2.5);
  });

  it('straight_run × side_lane never collide (2 m lane offset)', () => {
    const a = load('straight_run');
    const c = load('side_lane');
    expect(detectCollisions([a, c])).toHaveLength(0);
  });

  it('a start delay can resolve the collision (what-if)', () => {
    const a = load('straight_run');
    const b = load('stop_and_score');
    // Delay the straight runner clear past the parked robot's dwell (ends t=5).
    const delayed = { ...a, startDelayS: 3.5 };
    expect(detectCollisions([delayed, b])).toHaveLength(0);
  });

  it('single robot never reports a collision', () => {
    expect(detectCollisions([load('straight_run')])).toHaveLength(0);
  });
});

describe('minimumSeparation', () => {
  it('reports the closest pair and distance', () => {
    const a = load('straight_run');
    const b = load('stop_and_score');
    const min = minimumSeparation([a, b]);
    expect(min).toBeDefined();
    expect(min!.distanceM).toBeLessThan(0.9); // well inside bumper contact
  });
});
