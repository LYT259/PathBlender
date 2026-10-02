import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { autoResolveConflicts, detectCollisions, makeSession } from '../src';
import { parseGhostAuto } from '../src';

const SAMPLES = resolve(__dirname, '../../../samples');
const read = (rel: string): string =>
  readFileSync(resolve(SAMPLES, rel), 'utf-8');

const load = (rel: string) =>
  makeSession(parseGhostAuto(read(`ghostauto/${rel}.ghostauto`), rel));

describe('autoResolveConflicts', () => {
  it('clears the tuned collision with the smallest delay steps', () => {
    const a = load('straight_run');
    const b = load('stop_and_score');
    expect(detectCollisions([a, b]).length).toBeGreaterThan(0);

    const out = autoResolveConflicts([a, b]);
    expect(detectCollisions(out)).toHaveLength(0);

    // Exactly one robot is delayed, by a multiple of the 0.25 s step.
    const delayed = out.filter((r) => r.startDelayS > 0);
    expect(delayed).toHaveLength(1);
    expect((delayed[0]!.startDelayS * 4) % 1).toBeCloseTo(0);
  });

  it('respects the season auto period as the delay ceiling', () => {
    const a = load('straight_run');
    const b = load('stop_and_score');
    expect(detectCollisions([a, b]).length).toBeGreaterThan(0);

    // Default ceiling (current season, 20 s) separates the pair…
    expect(detectCollisions(autoResolveConflicts([a, b]))).toHaveLength(0);

    // …but a zero ceiling forbids every delay step, so the pair is declared
    // unsolvable and returned untouched rather than pushed past the ceiling.
    const capped = autoResolveConflicts([a, b], 0);
    expect(capped.every((r) => r.startDelayS === 0)).toBe(true);
    expect(detectCollisions(capped).length).toBeGreaterThan(0);
  });

  it('does not touch an already-clean session', () => {
    const a = load('straight_run');
    const c = load('side_lane');
    const out = autoResolveConflicts([a, c]);
    expect(out.every((r) => r.startDelayS === 0)).toBe(true);
  });

  it('is pure — the input array is not mutated', () => {
    const a = load('straight_run');
    const b = load('stop_and_score');
    autoResolveConflicts([a, b]);
    expect(a.startDelayS).toBe(0);
    expect(b.startDelayS).toBe(0);
  });
});
