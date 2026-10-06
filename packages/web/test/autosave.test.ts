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

  it('round-trips the ui slot (selection, playhead, playback range)', () => {
    const rs = robots();
    const ui = { selectedId: rs[0]!.trajectory.id, t: 2.5, playbackRange: 'paths' as const };
    saveAutosave(rs, 'rebuilt-2026', undefined, ui);
    expect(loadAutosave()!.ui).toEqual(ui);
  });

  it('older autosaves without a ui slot restore with ui undefined', () => {
    localStorage.setItem('pb.autosave.v1', serializeSession(robots(), 'rebuilt-2026'));
    const back = loadAutosave();
    expect(back).not.toBeNull();
    expect(back!.ui).toBeUndefined();
  });

  it('missing slot and unusable blobs fall back to null', () => {
    expect(loadAutosave()).toBeNull();
    localStorage.setItem('pb.autosave.v1', 'not a session');
    expect(loadAutosave()).toBeNull();
  });

  it('quota overflow never throws: it sheds libraries, then warns', () => {
    // A user robot with a route library, so "the smaller shape" is observable.
    const withLibrary: SessionTrajectory[] = [{
      ...robots()[0]!,
      routeOptions: Array.from({ length: 4 }, (_, i) => ({
        id: `r${i}`,
        relPath: `dir/r${i}.traj`,
        trajectory: { ...robots()[0]!.trajectory, id: `r${i}`, name: `r${i}` },
      })),
    }];
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // jsdom's localStorage owns its setItem (it shadows Storage.prototype), so
    // the spy has to sit on the instance — a prototype spy here is a no-op,
    // which is why the quota test this one replaces never actually fired.
    const real = localStorage.setItem.bind(localStorage);
    // Refuse the first shape only: the retry must be the library-stripped one.
    let refusals = 1;
    vi.spyOn(localStorage, 'setItem').mockImplementation((k, v) => {
      if (refusals-- > 0) throw new DOMException('quota', 'QuotaExceededError');
      real(k, v);
    });
    expect(() => saveAutosave(withLibrary, 'rebuilt-2026')).not.toThrow();
    const stored = JSON.parse(localStorage.getItem('pb.autosave.v1')!) as { robots: Record<string, unknown>[] };
    expect(stored.robots[0]!.samples).toBeDefined();
    expect(stored.robots[0]!.routeOptions).toBeUndefined();
    expect(warn).not.toHaveBeenCalled();

    // Nothing fits: the user hears about it instead of losing the session in
    // silence — the exact failure that went unnoticed for three days.
    refusals = 99;
    expect(() => saveAutosave(withLibrary, 'rebuilt-2026')).not.toThrow();
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
    vi.restoreAllMocks();
  });

  it('stores the compact autosave shape, not the shareable file shape', () => {
    // savedAt is stamped from the wall clock on every serializeSession
    // call; pin Date so a millisecond tick between the write and the
    // expected string cannot make the byte comparison flaky.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-02T12:00:00.000Z'));
    try {
      const rs = robots();
      saveAutosave(rs, 'rebuilt-2026');
      expect(localStorage.getItem('pb.autosave.v1')).toBe(
        serializeSession(rs, 'rebuilt-2026', undefined, { pretty: false }),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  // The welcome demo is what every user sees first, and its 22-route library
  // used to ride along in the autosave until the write exceeded the storage
  // quota and continuity died outright (user report 2026-10-06). jsdom has no
  // quota, so the budget is asserted on the byte size instead.
  it('keeps the welcome demo inside the storage budget', async () => {
    const { createWelcomeExample } = await import('../src/welcome-example');
    const example = createWelcomeExample().robots;
    expect(example.some((r) => (r.routeOptions?.length ?? 0) > 1)).toBe(true);
    saveAutosave(example, 'rebuilt-2026', undefined, { selectedId: example[0]!.trajectory.id, t: 1.5 });

    const text = localStorage.getItem('pb.autosave.v1')!;
    expect(text.length).toBeLessThan(400_000);
    expect(text).not.toContain('\n');
    const stored = JSON.parse(text) as { robots: { routeOptions?: unknown }[] };
    expect(stored.robots).toHaveLength(example.length);
    expect(stored.robots.every((r) => r.routeOptions === undefined)).toBe(true);

    // Still restorable, and the demo comes back with its library from the
    // current build (the App refresh replaces the trimmed entries).
    const back = loadAutosave();
    expect(back!.robots).toHaveLength(example.length);
    expect(back!.ui?.t).toBe(1.5);
  });
});
