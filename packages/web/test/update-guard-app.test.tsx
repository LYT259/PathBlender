/**
 * Update session guard — App wiring (update safety gate, red book §7.1).
 * The main window owns the session, so it owns the dirty computation: it
 * reports `set_update_guard` to the Rust shell, which fail-closed blocks
 * `install_update` while the report says dirty.
 *
 * Pinned contracts:
 * - dirty means ONLY a scene edit not yet persisted, or an autosave that
 *   failed in both shapes. A restored non-empty session and a playing
 *   session are NOT dirty — the playhead debounce is accepted-stale by
 *   design (600 ms), so the debounce path must never report dirty for an
 *   entire playback.
 * - a failed autosave stays dirty until some later save succeeds
 *   (sticky-then-recovered).
 * - the browser build (no Tauri marker) never invokes the command.
 *
 * Harness follows prefs-channel.test.tsx: the Tauri marker is stubbed
 * BEFORE the lazy App import (IS_DESKTOP is computed at module scope) and
 * @tauri-apps/api/core is mocked so App's dynamic-import send resolves to
 * the mock.
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { makeSession, parseGhostAuto, serializeSession } from '@pathblender/core';

const native = vi.hoisted(() => ({
  invoke: vi.fn((_command: string, ..._args: unknown[]) => Promise.resolve()),
}));
vi.mock('@tauri-apps/api/core', () => ({ invoke: native.invoke }));

const SAMPLES = resolve(__dirname, '../../../samples');
const SAMPLE = readFileSync(resolve(SAMPLES, 'ghostauto/straight_run.ghostauto'), 'utf-8');

function seedAutosave(): void {
  const robot = makeSession(parseGhostAuto(SAMPLE, 'straight_run.ghostauto'));
  localStorage.setItem('pb.autosave.v1', serializeSession([robot], 'rebuilt-2026'));
}

// Normalize to (command, args): delivery reaches native.invoke either
// directly through the mocked module or through the real core's
// __TAURI_INTERNALS__.invoke bridge (which appends an options passthrough
// the Rust side never sees) — the command + args are the contract.
function guardCalls(): [string, unknown][] {
  return native.invoke.mock.calls
    .filter((c) => c[0] === 'set_update_guard')
    .map((c) => [c[0] as string, c[1]]);
}

function asDesktop(): void {
  (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = { invoke: native.invoke };
}

async function renderApp() {
  // Same provider nesting as prefs-channel.test.tsx (context defaults).
  const [{ App }, { UpdateChannelProvider }, { ThemeProvider }] = await Promise.all([
    import('../src/App'),
    import('../src/update-channel'),
    import('../src/theme'),
  ]);
  render(
    <ThemeProvider>
      <UpdateChannelProvider>
        <App />
      </UpdateChannelProvider>
    </ThemeProvider>,
  );
}

const file = (rel: string): File =>
  new File([readFileSync(resolve(SAMPLES, rel))], rel.split('/').pop() as string, {
    type: 'application/json',
  });

function dropFile(rel: string): void {
  fireEvent.drop(window, { dataTransfer: { files: [file(rel)] } });
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('pb.lengthUnit', 'm');
  native.invoke.mockClear();
});

afterEach(() => {
  cleanup();
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.resetModules();
});

describe('update session guard reporting', () => {
  it('a restored non-empty session reports exactly one clean guard state', async () => {
    asDesktop();
    seedAutosave();
    await renderApp();
    await waitFor(() => expect(guardCalls().length).toBeGreaterThan(0));
    expect(guardCalls()).toEqual([['set_update_guard', { dirty: false }]]);
  });

  it('a playing session never reports dirty', async () => {
    asDesktop();
    seedAutosave();
    await renderApp();
    const play = await screen.findByRole('button', { name: 'Play', exact: true });
    const slider = screen.getByRole('slider', { name: 'Playback position' });
    const before = Number((slider as HTMLInputElement).value);
    fireEvent.click(play);
    // Real timers: rAF drives the clock and every frame resets the 600 ms
    // playhead debounce — exactly the window that must never report dirty.
    await waitFor(() => expect(Number((slider as HTMLInputElement).value)).toBeGreaterThan(before), { timeout: 4000 });
    // Pause so t stops changing, then let the debounce actually fire
    // (>600 ms): a playhead-only save must not add a dirty report even
    // after the debounce lands.
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 900));
    });
    expect(guardCalls()).toEqual([['set_update_guard', { dirty: false }]]);
  });

  it('a session whose autosave cannot write reports dirty, and recovers', async () => {
    // Fresh jsdom storage whose setItem refuses (the autosave.test.ts
    // instance-owner pattern); reads still work so the restore succeeds.
    const { JSDOM } = await import('jsdom');
    const dom = new JSDOM('', { url: 'https://localhost/' });
    const store = dom.window.localStorage;
    const realSet = store.setItem.bind(store);
    const owner = Object.hasOwn(store, 'setItem') ? store : dom.window.Storage.prototype;
    const setItem = vi.spyOn(owner, 'setItem').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError');
    });
    vi.stubGlobal('localStorage', store);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const robot = makeSession(parseGhostAuto(SAMPLE, 'straight_run.ghostauto'));
    realSet('pb.lengthUnit', 'm');
    realSet('pb.autosave.v1', serializeSession([robot], 'rebuilt-2026'));

    asDesktop();
    await renderApp();
    // The restore-time save fails in both shapes → dirty until a save lands.
    await waitFor(() => expect(guardCalls()).toContainEqual(['set_update_guard', { dirty: true }]));
    setItem.mockRestore();
    warn.mockRestore();

    dropFile('ghostauto/straight_run.ghostauto');
    await waitFor(() => expect(guardCalls().at(-1)).toEqual(['set_update_guard', { dirty: false }]));
  });

  it('the browser build never reports guard state', async () => {
    // No __TAURI_INTERNALS__ stub: IS_DESKTOP is false, the send no-ops.
    await renderApp();
    dropFile('ghostauto/straight_run.ghostauto');
    await screen.findByRole('group', { name: 'Field construction (welded vs AndyMark-built)' });
    expect(guardCalls()).toEqual([]);
  });
});
