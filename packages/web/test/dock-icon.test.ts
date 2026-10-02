/**
 * Dock-icon theme mirroring (user request 2026-10-01): the running app's
 * Dock tile must switch to the night artwork when the app theme resolves
 * dark and back to the day artwork on light — the Tauri command carries
 * the resolved value; browsers never invoke it.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

const native = vi.hoisted(() => ({ invoke: vi.fn((_command: string, ..._args: unknown[]) => Promise.resolve()) }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: native.invoke }));

import { syncDockIcon } from '../src/dock-icon';

beforeEach(() => {
  native.invoke.mockClear();
});

describe('syncDockIcon', () => {
  it('desktop + resolved dark → set_dock_icon dark=true', async () => {
    syncDockIcon('dark', true);
    await vi.waitFor(() => expect(native.invoke).toHaveBeenCalled());
    expect(native.invoke).toHaveBeenCalledWith('set_dock_icon', { dark: true });
  });

  it('desktop + resolved light → set_dock_icon dark=false', async () => {
    syncDockIcon('light', true);
    await vi.waitFor(() => expect(native.invoke).toHaveBeenCalled());
    expect(native.invoke).toHaveBeenCalledWith('set_dock_icon', { dark: false });
  });

  it('browser context → never invokes the shell', () => {
    syncDockIcon('dark', false);
    expect(native.invoke).not.toHaveBeenCalled();
  });

  it('a rejected invoke is swallowed (shell missing artwork)', async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on('unhandledRejection', onUnhandled);
    native.invoke.mockRejectedValueOnce(new Error('no resource'));
    syncDockIcon('dark', true);
    await vi.waitFor(() => expect(native.invoke).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20)); // let the rejection settle
    process.off('unhandledRejection', onUnhandled);
    expect(unhandled).toEqual([]);
  });
});
