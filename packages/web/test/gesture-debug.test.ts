import { describe, expect, it } from 'vitest';
import { gestureSummary, type GestureSample } from '../src/gesture-debug';

describe('gestureSummary', () => {
  it('summarizes a clean gesture with no post-end events', () => {
    const list: GestureSample[] = [
      { t: 0, phase: 'start', scale: 1 },
      { t: 100, phase: 'change', scale: 1.05 },
      { t: 200, phase: 'change', scale: 1.10 },
      { t: 250, phase: 'end', scale: 1.10 },
    ];
    // First change is skipped (no previous change to ratio against);
    // max |ln ratio| = ln(1.10/1.05) ≈ 0.05.
    expect(gestureSummary(list)).toBe('n=2 maxΔln=0.05 dur=0.1s end=1.10 postEnd=0');
  });

  it('flags events flushed after gestureend (the round-3 bug signature)', () => {
    const list: GestureSample[] = [
      { t: 0, phase: 'start', scale: 1 },
      { t: 100, phase: 'change', scale: 1.05 },
      { t: 200, phase: 'end', scale: 1.05 },
      { t: 260, phase: 'change', scale: 1.05 },
      { t: 300, phase: 'change', scale: 1.40 },
    ];
    // post-end change with a huge ratio: maxΔln = ln(1.40/1.05) ≈ 0.29.
    expect(gestureSummary(list)).toBe('n=3 maxΔln=0.29 dur=0.2s end=1.40 postEnd=2');
  });

  it('handles a gesture with no change events', () => {
    const list: GestureSample[] = [
      { t: 0, phase: 'start', scale: 1 },
      { t: 50, phase: 'end', scale: 1 },
    ];
    expect(gestureSummary(list)).toBe('n=0 maxΔln=0.00 dur=0.0s end=— postEnd=0');
  });
});
