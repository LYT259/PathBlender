import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadAutosave, saveAutosave } from '../src/autosave';
import {
  DEFAULT_GEOMETRY,
  makeSession,
  parseGhostAuto,
  serializeSession,
  type SessionTrajectory,
} from '@pathblender/core';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SAMPLE = readFileSync(
  resolve(__dirname, '../../../samples/ghostauto/straight_run.ghostauto'),
  'utf-8',
);

const robots = (): SessionTrajectory[] => [
  makeSession(parseGhostAuto(SAMPLE, 'straight_run.ghostauto')),
];

beforeEach(() => {
  localStorage.clear();
});

describe('saveAutosave / loadAutosave', () => {
  it('round-trips a session with its field', () => {
    saveAutosave(robots(), 'rebuilt-2026');
    const back = loadAutosave();
    expect(back).not.toBeNull();
    expect(back!.fieldId).toBe('rebuilt-2026');
    expect(back!.robots).toHaveLength(1);
    expect(back!.robots[0]!.trajectory.name).toBe('Straight Run');
    expect(back!.robots[0]!.trajectory.geometry.lengthM).toBeCloseTo(0.9, 6);
  });

  it('an empty session clears the slot (next launch = welcome page)', () => {
    saveAutosave(robots(), 'rebuilt-2026');
    saveAutosave([], 'rebuilt-2026');
    expect(loadAutosave()).toBeNull();
  });

  it('missing slot and unusable blobs fall back to null', () => {
    expect(loadAutosave()).toBeNull();
    localStorage.setItem('ghpb.autosave.v1', 'not a session');
    expect(loadAutosave()).toBeNull();
  });

  it('quota overflow is swallowed, not thrown', () => {
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError');
    });
    expect(() => saveAutosave(robots(), 'rebuilt-2026')).not.toThrow();
    set.mockRestore();
  });

  it('stores exactly what serializeSession produces', () => {
    // savedAt is stamped from the wall clock on every serializeSession
    // call; pin Date so a millisecond tick between the write and the
    // expected string cannot make the byte comparison flaky.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-02T12:00:00.000Z'));
    try {
      const rs = robots();
      saveAutosave(rs, 'rebuilt-2026');
      expect(localStorage.getItem('ghpb.autosave.v1')).toBe(
        serializeSession(rs, 'rebuilt-2026', undefined),
      );
    } finally {
      vi.useRealTimers();
    }
  });
});
