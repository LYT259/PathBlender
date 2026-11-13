/**
 * App-level integration for the nearby-share entry on the WEB build: File →
 * Share nearby (Bluetooth) opens the real, unmocked ShareDialog, the web
 * shell shows the desktop-only notice, and closing the dialog must keep the
 * Tauri bridge completely untouched — App's onClose used to call bleCancel
 * unconditionally, so every web close invoked ble_cancel even though the
 * dialog itself correctly skips every BLE command off-desktop. The invoke
 * spy is the contract: zero calls across open, notice and close.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const native = vi.hoisted(() => ({ invoke: vi.fn((_c: string, ..._a: unknown[]) => Promise.resolve()) }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: native.invoke }));

import { App } from '../src/App';

beforeEach(() => {
  localStorage.clear();
  // No __TAURI_INTERNALS__ and an http location: the web build, with App's
  // module-level IS_DESKTOP evaluated false at import time.
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
  native.invoke.mockClear();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('web build nearby-share entry', () => {
  it('File ▸ Share nearby shows the desktop-only notice and closes with zero invokes', async () => {
    render(<App />);
    fireEvent.click(screen.getByText('File', { selector: '.menu-top' }));
    fireEvent.click(screen.getByText('Share nearby (Bluetooth)'));

    expect(await screen.findByText('Nearby share runs in the PathBlender desktop app. On the web, exchange files with a USB drive instead.')).toBeTruthy();
    // Opening reached the gate before any command: capabilities stays unsent.
    expect(native.invoke).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByText(/desktop app\. On the web/)).toBeNull();
    // The close flow is web-visible too — it must stay off the bridge.
    expect(native.invoke).not.toHaveBeenCalled();
    expect(native.invoke).not.toHaveBeenCalledWith('ble_cancel', expect.anything());
  });
});
