import { describe, expect, it, vi } from 'vitest';
import {
  createSessionGuard,
  guardAfterAutosave,
  guardAfterEdit,
  initialGuardState,
  isSessionDirty,
  UPDATE_BLOCKED_MARKER,
} from '../src/update-guard';

describe('pure transitions', () => {
  it('initial state is clean (mount-time restore or welcome page)', () => {
    expect(isSessionDirty(initialGuardState)).toBe(false);
  });

  it('an edit pending its save is dirty', () => {
    expect(isSessionDirty(guardAfterEdit(initialGuardState))).toBe(true);
  });

  it('a successful save after an edit is clean again', () => {
    expect(isSessionDirty(guardAfterAutosave(guardAfterEdit(initialGuardState), 'saved'))).toBe(false);
  });

  it('an emptied session is clean', () => {
    expect(isSessionDirty(guardAfterAutosave(guardAfterEdit(initialGuardState), 'cleared'))).toBe(false);
  });

  it('a failed autosave is dirty and stays dirty across edits', () => {
    const failed = guardAfterAutosave(guardAfterEdit(initialGuardState), 'failed');
    expect(isSessionDirty(failed)).toBe(true);
    expect(isSessionDirty(guardAfterEdit(failed))).toBe(true);
    expect(isSessionDirty(guardAfterAutosave(failed, 'cleared'))).toBe(false); // recovery clears
  });

  it('a save with no preceding edit (debounce-only playhead move) stays clean', () => {
    expect(isSessionDirty(guardAfterAutosave(initialGuardState, 'saved'))).toBe(false);
  });
});

describe('createSessionGuard', () => {
  const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

  it('reports are serialized so a stale report can never land after a newer one', async () => {
    // Independent-review finding: with concurrent sends, a requested [false,
    // true] could ARRIVE as true-then-stale-false, leaving Rust clean for a
    // dirty session while the dedupe cache believed `true` was delivered —
    // fail-open, and a later sync() would send nothing. Serialization makes
    // arrival order equal request order by construction.
    const gates: Array<() => void> = [];
    const arrivals: boolean[] = [];
    let rustFlag: boolean | null = null;
    const send = (d: boolean) =>
      new Promise<void>((resolve) => {
        gates.push(() => {
          arrivals.push(d);
          rustFlag = d;
          resolve();
        });
      });
    const g = createSessionGuard(send);
    g.autosaveDone('cleared'); // request clean → the only send in flight
    g.edit();                  // dirty — must queue behind the clean send
    expect(gates.length).toBe(1); // RED on the concurrent implementation (2)
    gates[0]!();               // clean lands on Rust
    await flush();             // settle → the queued dirty report goes out
    expect(gates.length).toBe(2);
    gates[1]!();               // dirty lands — necessarily after the clean one
    await flush();
    expect(arrivals).toEqual([false, true]);
    expect(rustFlag).toBe(true); // Rust dirty: the session IS dirty
    g.sync();                    // dedupe holds — nothing extra
    await flush();
    expect(gates.length).toBe(2);
  });

  it('first sync delivers the clean state', async () => {
    const send = vi.fn(() => Promise.resolve());
    createSessionGuard(send).sync();
    expect(send).toHaveBeenCalledExactlyOnceWith(false);
  });

  it('sends dirty once for edit + failed save, and clean again on recovery', async () => {
    const send = vi.fn(() => Promise.resolve());
    const g = createSessionGuard(send);
    g.edit();                 // pending → dirty → send(true)
    g.autosaveDone('failed'); // still dirty → no send
    g.sync();                 // no change → no send
    await flush();            // the dirty report settles
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(true);
    g.autosaveDone('saved');  // dirty → clean → queued behind the in-flight report
    await flush();            // serialized: clean report goes out after dirty settles
    expect(send).toHaveBeenNthCalledWith(2, false);
  });

  it('a rejected send resets the cache so the next sync re-sends', async () => {
    const send = vi.fn((_d: boolean) => Promise.reject(new Error('ipc gone')));
    const g = createSessionGuard(send);
    g.edit();                 // sends true (rejected)
    // A rejection is only observable after the microtask queue drains; the
    // rejection resets both caches, and there is deliberately no automatic
    // retry (a persistently failing IPC must not loop).
    await flush();
    g.autosaveDone('saved');  // dirty → clean; delivery is unknown → send(false)
    expect(send.mock.calls.map((c) => c[0])).toEqual([true, false]);
    g.sync();                 // clean was delivered by that send → no extra send
    await flush();
    expect(send.mock.calls.map((c) => c[0])).toEqual([true, false]);
  });

  it('playback bursts of debounce-only saves never report dirty', () => {
    const send = vi.fn(() => Promise.resolve());
    const g = createSessionGuard(send);
    g.sync(); // initial clean delivery: false
    for (let i = 0; i < 5; i++) g.autosaveDone('saved'); // playhead debounce saves during playback
    expect(send.mock.calls.map((c) => c[0])).toEqual([false]);
  });

  it('the blocked marker string is pinned for the Rust side', () => {
    expect(UPDATE_BLOCKED_MARKER).toBe('update blocked: unsaved session');
  });
});
