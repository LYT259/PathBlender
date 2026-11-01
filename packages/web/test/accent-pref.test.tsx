/**
 * Interface-accent preference behavior (2026-10-17): the third independent
 * appearance axis (theme mode / app icon / accent). Covers the storage
 * contract ('pb.accent', missing/invalid → blue, blue stays keyless), the
 * <html data-accent> attribute that drives the CSS variant blocks, the
 * session-only fallback when storage is unavailable, and the desktop pref
 * bridge — a remote accent applies without re-broadcasting (the echo loop
 * guard), and never touches the theme mode.
 */
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ThemeProvider, useTheme } from '../src/theme';

const evt = vi.hoisted(() => ({
  handlers: [] as Array<(e: { payload: { key: string; value: string } }) => void>,
  emitted: [] as Array<{ key: string; value: string }>,
}));
vi.mock('@tauri-apps/api/event', () => ({
  emit: (_name: string, payload: { key: string; value: string }) => {
    evt.emitted.push(payload);
    return Promise.resolve();
  },
  listen: (
    _name: string,
    handler: (e: { payload: { key: string; value: string } }) => void,
  ) => {
    evt.handlers.push(handler);
    return Promise.resolve(() => undefined);
  },
}));

/** Renders the live context values and lets tests drive both setters. */
function Probe() {
  const { accent, mode, setAccent, setMode } = useTheme();
  return (
    <div>
      <span data-testid="accent">{accent}</span>
      <span data-testid="mode">{mode}</span>
      <button type="button" onClick={() => setAccent('red')}>to-red</button>
      <button type="button" onClick={() => setAccent('blue')}>to-blue</button>
      <button type="button" onClick={() => setMode('light')}>to-light</button>
    </div>
  );
}

const mount = () => render(<ThemeProvider><Probe /></ThemeProvider>);
const accentOf = () => document.querySelector('[data-testid="accent"]')!.textContent;

beforeEach(() => {
  localStorage.clear();
  evt.handlers.length = 0;
  evt.emitted.length = 0;
  // Desktop shell marker so listenPrefs/broadcastPref run their real paths.
  (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = { invoke: vi.fn() };
});
afterEach(() => {
  cleanup();
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
  delete document.documentElement.dataset.accent;
});

describe('accent preference storage', () => {
  it('defaults to blue and writes data-accent on <html>', () => {
    mount();
    expect(accentOf()).toBe('blue');
    expect(document.documentElement.dataset.accent).toBe('blue');
  });

  it('restores every saved accent id from pb.accent', () => {
    for (const id of ['red', 'steel', 'bronze', 'silver']) {
      cleanup();
      localStorage.clear();
      localStorage.setItem('pb.accent', id);
      mount();
      expect(accentOf()).toBe(id);
      expect(document.documentElement.dataset.accent).toBe(id);
    }
  });

  it('falls back to blue on an invalid stored value', () => {
    localStorage.setItem('pb.accent', 'green');
    mount();
    expect(accentOf()).toBe('blue');
  });

  it('persists a choice and removes the key when returning to blue', () => {
    mount();
    const toRed = [...document.querySelectorAll('button')].find((b) => b.textContent === 'to-red')!;
    const toBlue = [...document.querySelectorAll('button')].find((b) => b.textContent === 'to-blue')!;
    act(() => { toRed.click(); });
    expect(localStorage.getItem('pb.accent')).toBe('red');
    expect(document.documentElement.dataset.accent).toBe('red');
    act(() => { toBlue.click(); });
    expect(localStorage.getItem('pb.accent')).toBeNull(); // default stays keyless
    expect(document.documentElement.dataset.accent).toBe('blue');
  });

  it('keeps working session-only when storage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('quota');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('quota');
    });
    mount();
    expect(accentOf()).toBe('blue'); // read failure → default, not a crash
    const toRed = [...document.querySelectorAll('button')].find((b) => b.textContent === 'to-red')!;
    act(() => { toRed.click(); });
    expect(accentOf()).toBe('red'); // state + attribute apply without storage
    expect(document.documentElement.dataset.accent).toBe('red');
    vi.restoreAllMocks();
  });

  it('stays independent from the theme mode', () => {
    localStorage.setItem('pb.theme', 'dark');
    mount();
    const toLight = [...document.querySelectorAll('button')].find((b) => b.textContent === 'to-light')!;
    act(() => { toLight.click(); });
    expect(document.querySelector('[data-testid="mode"]')!.textContent).toBe('light');
    expect(accentOf()).toBe('blue');
    expect(localStorage.getItem('pb.theme')).toBe('light');
    expect(localStorage.getItem('pb.accent')).toBeNull();
  });
});

describe('accent preference bridge (desktop)', () => {
  // isDesktop is evaluated at pref-sync import time, so the desktop marker
  // must be in place BEFORE the module loads — reset and lazily import a
  // fresh copy (same pattern as prefs-channel.test.tsx).
  async function mountDesktop() {
    vi.resetModules();
    const { ThemeProvider: FreshTheme, useTheme: FreshUseTheme } = await import('../src/theme');
    function FreshProbe() {
      const { accent, setAccent } = FreshUseTheme();
      return (
        <div>
          <span data-testid="accent">{accent}</span>
          <button type="button" onClick={() => setAccent('red')}>to-red</button>
        </div>
      );
    }
    return render(<FreshTheme><FreshProbe /></FreshTheme>);
  }

  it('broadcasts local changes under the accent key', async () => {
    await mountDesktop();
    await act(async () => {}); // let listenPrefs' dynamic import register
    const toRed = [...document.querySelectorAll('button')].find((b) => b.textContent === 'to-red')!;
    await act(async () => { toRed.click(); });
    await act(async () => {}); // flush broadcastPref's dynamic import chain
    expect(evt.emitted).toContainEqual({ key: 'accent', value: 'red' });
  });

  it('applies a remote accent without re-broadcasting (no echo loop)', async () => {
    await mountDesktop();
    await act(async () => {}); // let listenPrefs' dynamic import register
    expect(evt.handlers.length).toBeGreaterThan(0);
    await act(async () => {
      for (const handler of evt.handlers) handler({ payload: { key: 'accent', value: 'silver' } });
    });
    expect(accentOf()).toBe('silver');
    expect(localStorage.getItem('pb.accent')).toBe('silver');
    // The receiving window must not echo: zero new broadcasts since mount.
    expect(evt.emitted).toEqual([]);
  });

  it('maps an invalid remote value back to blue', async () => {
    await mountDesktop();
    await act(async () => {});
    await act(async () => {
      for (const handler of evt.handlers) handler({ payload: { key: 'accent', value: 'purple' } });
    });
    expect(accentOf()).toBe('blue');
  });
});
