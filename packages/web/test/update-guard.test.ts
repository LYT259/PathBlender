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
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(true);
    g.autosaveDone('saved');  // dirty → clean → send(false)
    expect(send).toHaveBeenNthCalledWith(2, false);
  });

  it('a rejected send resets the cache so the next sync re-sends', async () => {
    const send = vi.fn((_d: boolean) => Promise.reject(new Error('ipc gone')));
    const g = createSessionGuard(send);
    g.edit();                 // sends true (rejected)
    g.autosaveDone('saved');  // sends false (rejected)
    // A rejection is only observable after the microtask queue drains; both
    // rejections must reset lastDelivered before the re-send can be demanded.
    await new Promise((resolve) => setTimeout(resolve, 0));
    g.sync();                 // must re-send — the last delivered value is unknown
    expect(send.mock.calls.map((c) => c[0])).toEqual([true, false, false]);
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
