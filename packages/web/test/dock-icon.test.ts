/**
 * Dock-icon bridge for the independent app-icon preference (app-icon.tsx):
 * always explicit artwork — fixed light/dark pins that artwork regardless
 * of the OS, 'system' pushes the artwork matching the current OS
 * appearance (systemDark) and the provider re-invokes on every OS flip.
 * Browsers never invoke the shell.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

const native = vi.hoisted(() => ({ invoke: vi.fn((_command: string, ..._args: unknown[]) => Promise.resolve()) }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: native.invoke }));

import { syncDockIcon } from '../src/dock-icon';

beforeEach(() => {
  native.invoke.mockClear();
});

describe('syncDockIcon', () => {
  it('desktop + fixed dark pins night artwork even when the OS is light', async () => {
    syncDockIcon('dark', false, true);
    await vi.waitFor(() => expect(native.invoke).toHaveBeenCalled());
    expect(native.invoke).toHaveBeenCalledWith('set_dock_icon', { dark: true });
  });

  it('desktop + fixed light pins day artwork even when the OS is dark', async () => {
    syncDockIcon('light', true, true);
    await vi.waitFor(() => expect(native.invoke).toHaveBeenCalled());
    expect(native.invoke).toHaveBeenCalledWith('set_dock_icon', { dark: false });
  });

  it('desktop + system mirrors the current OS appearance', async () => {
    syncDockIcon('system', true, true);
    await vi.waitFor(() => expect(native.invoke).toHaveBeenCalled());
    expect(native.invoke).toHaveBeenCalledWith('set_dock_icon', { dark: true });
    native.invoke.mockClear();
    syncDockIcon('system', false, true);
    await vi.waitFor(() => expect(native.invoke).toHaveBeenCalled());
    expect(native.invoke).toHaveBeenCalledWith('set_dock_icon', { dark: false });
  });

  it('browser context → never invokes the shell', () => {
    syncDockIcon('dark', false, false);
    syncDockIcon('system', true, false);
    expect(native.invoke).not.toHaveBeenCalled();
  });

  it('a rejected invoke is swallowed (shell missing artwork)', async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on('unhandledRejection', onUnhandled);
    native.invoke.mockRejectedValueOnce(new Error('no resource'));
    syncDockIcon('dark', true, true);
    await vi.waitFor(() => expect(native.invoke).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20)); // let the rejection settle
    process.off('unhandledRejection', onUnhandled);
    expect(unhandled).toEqual([]);
  });
});
