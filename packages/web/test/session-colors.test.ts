/**
 * Colorblind alignment for robots entering the session state — the unit
 * contract behind the App entry points (restore, imports, example).
 */
import { describe, expect, it } from 'vitest';
import { COLORBLIND_COLORS, makeSession, parseGhostAuto, SESSION_COLORS, type SessionTrajectory } from '@pathblender/core';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { withColorblindPalette } from '../src/session-colors';

const SAMPLE = readFileSync(
  resolve(__dirname, '../../../samples/ghostauto/straight_run.ghostauto'),
  'utf-8',
);

const robot = (colorIndex = 0): SessionTrajectory =>
  makeSession(parseGhostAuto(SAMPLE, 'straight_run.ghostauto'), colorIndex);

describe('withColorblindPalette', () => {
  it('maps default palette colors onto the colorblind slots when enabled', () => {
    const [a, b] = withColorblindPalette([robot(0), robot(1)], true);
    expect(a!.color).toBe(COLORBLIND_COLORS[0]);
    expect(b!.color).toBe(COLORBLIND_COLORS[1]);
  });

  it('maps colorblind colors back to their default slots when disabled', () => {
    const [a] = withColorblindPalette([robot(0)], true);
    const [b] = withColorblindPalette([a!], false);
    expect(b!.color).toBe(SESSION_COLORS[0]);
  });

  it('passes custom colors through untouched either way', () => {
    const custom = { ...robot(0), color: '#123456' };
    expect(withColorblindPalette([custom], true)[0]!.color).toBe('#123456');
    expect(withColorblindPalette([custom], false)[0]!.color).toBe('#123456');
  });

  it('returns the original object when a color is already aligned (no history noise)', () => {
    const [remapped] = withColorblindPalette([robot(0)], true);
    expect(withColorblindPalette([remapped!], true)[0]).toBe(remapped);
  });

  it('is idempotent: applying twice yields the same colors', () => {
    const once = withColorblindPalette([robot(0), robot(1), robot(2)], true);
    const twice = withColorblindPalette(once, true);
    expect(twice.map((r) => r.color)).toEqual(once.map((r) => r.color));
  });
});
