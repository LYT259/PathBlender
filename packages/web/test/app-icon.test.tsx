/**
 * App-icon preference provider: an independent preference pair — style
 * (classic / monochrome artwork family, localStorage 'pb.appIconStyle') and
 * appearance mode (system / light / dark, 'pb.appIcon' — NOT the interface
 * theme's key) — with desktop Dock-tile application, cross-window sync over
 * the pref bridge, and restart restore. 'system' mirrors the OS appearance
 * live (explicit artwork re-pushed on every flip); fixed light/dark ignores
 * the OS. Neither choice ever resets the other. The no-echo rule applies: a
 * remotely applied change must never be re-broadcast.
 */
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const native = vi.hoisted(() => ({ invoke: vi.fn((_command: string, ..._args: unknown[]) => Promise.resolve()) }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: native.invoke }));

const bridge = vi.hoisted(() => ({
  desktop: true,
  osDark: false,
  systemChange: undefined as ((event: { matches: boolean }) => void) | undefined,
  broadcasts: [] as [string, string][],
  handler: undefined as ((key: string, value: string) => void) | undefined,
}));
vi.mock('../src/pref-sync', () => ({
  get isDesktop() {
    return bridge.desktop;
  },
  broadcastPref: (key: string, value: string) => {
    if (bridge.desktop) bridge.broadcasts.push([key, value]);
  },
  listenPrefs: (handler: (key: string, value: string) => void) => {
    if (!bridge.desktop) return () => undefined;
    bridge.handler = handler;
    return () => {
      bridge.handler = undefined;
    };
  },
}));

import { AppIconProvider, useAppIcon } from '../src/app-icon';

function Probe() {
  const { mode, style, setMode, setStyle } = useAppIcon();
  return (
    <div>
      <span data-testid="mode">{mode}</span>
      <span data-testid="style">{style}</span>
      <button onClick={() => setMode('light')} data-testid="set-light" />
      <button onClick={() => setMode('dark')} data-testid="set-dark" />
      <button onClick={() => setMode('system')} data-testid="set-system" />
      <button onClick={() => setStyle('classic')} data-testid="set-classic" />
      <button onClick={() => setStyle('monochrome')} data-testid="set-mono" />
    </div>
  );
}

const renderProbe = () => render(<AppIconProvider><Probe /></AppIconProvider>);
const dockCalls = () => native.invoke.mock.calls.filter((args) => args[0] === 'set_dock_icon');
/** Wait out the mount-time dynamic import (vite-node drops .then chains
 * attached to an in-flight import; each invoke carries an absolute value,
 * so production converges regardless). */
const mountSettled = () => vi.waitFor(() => expect(dockCalls().length).toBeGreaterThan(0));

beforeEach(() => {
  localStorage.clear();
  native.invoke.mockClear();
  bridge.desktop = true;
  bridge.osDark = false;
  bridge.systemChange = undefined;
  bridge.broadcasts.length = 0;
  bridge.handler = undefined;
  vi.stubGlobal('matchMedia', () => ({
    matches: bridge.osDark,
    addEventListener: (_: string, cb: typeof bridge.systemChange) => {
      bridge.systemChange = cb;
    },
    removeEventListener: vi.fn(),
  }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('app icon appearance provider', () => {
  it('defaults to system and applies the OS-matching artwork on mount', async () => {
    const { getByTestId } = renderProbe();
    expect(getByTestId('mode').textContent).toBe('system');
    await vi.waitFor(() => expect(dockCalls()).toEqual([['set_dock_icon', { dark: false, style: 'classic' }]]));
    expect(localStorage.getItem('pb.appIcon')).toBeNull();
  });

  it('fixed dark persists under its own key, applies natively, broadcasts', async () => {
    const { getByTestId } = renderProbe();
    await mountSettled();
    act(() => getByTestId('set-dark').click());
    expect(getByTestId('mode').textContent).toBe('dark');
    expect(localStorage.getItem('pb.appIcon')).toBe('dark');
    expect(localStorage.getItem('pb.theme')).toBeNull(); // never the theme key
    await vi.waitFor(() => expect(dockCalls()).toContainEqual(['set_dock_icon', { dark: true, style: 'classic' }]));
    expect(bridge.broadcasts).toEqual([['appIcon', 'dark']]);
  });

  it('back to system removes the stored key and re-mirrors the OS', async () => {
    const { getByTestId } = renderProbe();
    await mountSettled();
    act(() => getByTestId('set-dark').click());
    await vi.waitFor(() => expect(dockCalls()).toContainEqual(['set_dock_icon', { dark: true, style: 'classic' }]));
    act(() => getByTestId('set-system').click());
    expect(localStorage.getItem('pb.appIcon')).toBeNull();
    await vi.waitFor(() => expect(dockCalls().at(-1)).toEqual(['set_dock_icon', { dark: false, style: 'classic' }]));
    expect(bridge.broadcasts).toEqual([['appIcon', 'dark'], ['appIcon', 'system']]);
  });

  it('restart restores the saved fixed choice and re-applies it', async () => {
    localStorage.setItem('pb.appIcon', 'dark');
    const { getByTestId } = renderProbe();
    expect(getByTestId('mode').textContent).toBe('dark');
    await vi.waitFor(() => expect(dockCalls()).toEqual([['set_dock_icon', { dark: true, style: 'classic' }]]));
  });

  it('corrupted storage falls back to system (never throws)', () => {
    localStorage.setItem('pb.appIcon', 'purple');
    const { getByTestId } = renderProbe();
    expect(getByTestId('mode').textContent).toBe('system');
  });

  it('system mode follows OS appearance flips live; fixed modes ignore them', async () => {
    const { getByTestId, unmount } = renderProbe();
    await mountSettled();
    expect(dockCalls().at(-1)).toEqual(['set_dock_icon', { dark: false, style: 'classic' }]); // OS light
    act(() => bridge.systemChange?.({ matches: true })); // OS goes dark
    await vi.waitFor(() => expect(dockCalls().at(-1)).toEqual(['set_dock_icon', { dark: true, style: 'classic' }]));
    unmount();

    // Fixed light must NOT follow the OS (an idempotent re-apply of the same
    // artwork is fine — it must never flip to dark).
    localStorage.setItem('pb.appIcon', 'light');
    native.invoke.mockClear();
    renderProbe();
    await mountSettled();
    expect(dockCalls().at(-1)).toEqual(['set_dock_icon', { dark: false, style: 'classic' }]);
    act(() => bridge.systemChange?.({ matches: true }));
    await new Promise((r) => setTimeout(r, 50)); // let any (wrong) call land
    expect(dockCalls()).not.toContainEqual(['set_dock_icon', { dark: true, style: 'classic' }]);
  });

  it('applies a change from the other window WITHOUT re-broadcasting', async () => {
    const { getByTestId } = renderProbe();
    await mountSettled();
    act(() => bridge.handler?.('appIcon', 'dark'));
    expect(getByTestId('mode').textContent).toBe('dark');
    expect(localStorage.getItem('pb.appIcon')).toBe('dark');
    await vi.waitFor(() => expect(dockCalls()).toContainEqual(['set_dock_icon', { dark: true, style: 'classic' }]));
    expect(bridge.broadcasts).toEqual([]); // no echo loop
  });

  it('ignores unrelated pref keys on the bridge', () => {
    const { getByTestId } = renderProbe();
    act(() => bridge.handler?.('theme', 'dark'));
    expect(getByTestId('mode').textContent).toBe('system');
    expect(localStorage.getItem('pb.appIcon')).toBeNull();
  });

  it('browser context: state and storage work, native and bridge stay silent', () => {
    bridge.desktop = false;
    const { getByTestId } = renderProbe();
    act(() => getByTestId('set-dark').click());
    expect(getByTestId('mode').textContent).toBe('dark');
    expect(localStorage.getItem('pb.appIcon')).toBe('dark');
    expect(dockCalls()).toEqual([]);
    expect(bridge.broadcasts).toEqual([]);
    // the same choice lands on the tab icon instead of the Dock tile
    expect(
      document
        .querySelector<HTMLLinkElement>('head link[rel~="icon"]')
        ?.getAttribute('href'),
    ).toContain('favicon-night');
  });
});

describe('app icon style preference', () => {
  it('defaults to classic, absent storage never writes the key', async () => {
    const { getByTestId } = renderProbe();
    expect(getByTestId('style').textContent).toBe('classic');
    await vi.waitFor(() => expect(dockCalls()).toEqual([['set_dock_icon', { dark: false, style: 'classic' }]]));
    expect(localStorage.getItem('pb.appIconStyle')).toBeNull();
  });

  it('monochrome persists under its own key, applies natively, broadcasts — mode untouched', async () => {
    const { getByTestId } = renderProbe();
    await mountSettled();
    act(() => getByTestId('set-mono').click());
    expect(getByTestId('style').textContent).toBe('monochrome');
    expect(getByTestId('mode').textContent).toBe('system'); // style never resets appearance
    expect(localStorage.getItem('pb.appIconStyle')).toBe('monochrome');
    expect(localStorage.getItem('pb.appIcon')).toBeNull(); // and appearance keeps its own key
    await vi.waitFor(() =>
      expect(dockCalls().at(-1)).toEqual(['set_dock_icon', { dark: false, style: 'monochrome' }]));
    expect(bridge.broadcasts).toEqual([['appIconStyle', 'monochrome']]);
  });

  it('back to classic removes the stored key; an appearance change keeps the style', async () => {
    const { getByTestId } = renderProbe();
    await mountSettled();
    // One waitFor per step: vite-node drops .then chains attached while an
    // import is in flight (see file header), so pace the three changes.
    act(() => getByTestId('set-mono').click());
    await vi.waitFor(() =>
      expect(dockCalls().at(-1)).toEqual(['set_dock_icon', { dark: false, style: 'monochrome' }]));
    act(() => getByTestId('set-dark').click());
    expect(bridge.broadcasts).toEqual([['appIconStyle', 'monochrome'], ['appIcon', 'dark']]);
    await vi.waitFor(() =>
      expect(dockCalls().at(-1)).toEqual(['set_dock_icon', { dark: true, style: 'monochrome' }]));
    act(() => getByTestId('set-classic').click());
    expect(localStorage.getItem('pb.appIconStyle')).toBeNull();
    expect(localStorage.getItem('pb.appIcon')).toBe('dark'); // mode survived the style round-trip
    expect(getByTestId('style').textContent).toBe('classic');
    await vi.waitFor(() =>
      expect(dockCalls().at(-1)).toEqual(['set_dock_icon', { dark: true, style: 'classic' }]));
  });

  it('restart restores a saved monochrome style alongside a saved appearance', async () => {
    localStorage.setItem('pb.appIconStyle', 'monochrome');
    localStorage.setItem('pb.appIcon', 'light');
    const { getByTestId } = renderProbe();
    expect(getByTestId('style').textContent).toBe('monochrome');
    expect(getByTestId('mode').textContent).toBe('light');
    await vi.waitFor(() =>
      expect(dockCalls()).toEqual([['set_dock_icon', { dark: false, style: 'monochrome' }]]));
  });

  it('corrupted or unknown style values fall back to classic (never throws)', () => {
    localStorage.setItem('pb.appIconStyle', 'neon');
    const { getByTestId } = renderProbe();
    expect(getByTestId('style').textContent).toBe('classic');
    act(() => bridge.handler?.('appIconStyle', 'neon'));
    expect(getByTestId('style').textContent).toBe('classic');
  });

  it('system-mode OS flips re-push the monochrome artwork live; fixed modes ignore them', async () => {
    localStorage.setItem('pb.appIconStyle', 'monochrome');
    const { getByTestId, unmount } = renderProbe();
    await mountSettled();
    expect(dockCalls().at(-1)).toEqual(['set_dock_icon', { dark: false, style: 'monochrome' }]);
    act(() => bridge.systemChange?.({ matches: true }));
    await vi.waitFor(() =>
      expect(dockCalls().at(-1)).toEqual(['set_dock_icon', { dark: true, style: 'monochrome' }]));
    unmount();
  });

  it('applies a style saved in the other window WITHOUT re-broadcasting', async () => {
    const { getByTestId } = renderProbe();
    await mountSettled();
    act(() => bridge.handler?.('appIconStyle', 'monochrome'));
    expect(getByTestId('style').textContent).toBe('monochrome');
    expect(localStorage.getItem('pb.appIconStyle')).toBe('monochrome');
    await vi.waitFor(() =>
      expect(dockCalls().at(-1)).toEqual(['set_dock_icon', { dark: false, style: 'monochrome' }]));
    expect(bridge.broadcasts).toEqual([]); // no echo loop
  });

  it('browser context: style works in storage but the tab icon stays classic — no browser entry', () => {
    bridge.desktop = false;
    const { getByTestId } = renderProbe();
    act(() => getByTestId('set-mono').click());
    expect(localStorage.getItem('pb.appIconStyle')).toBe('monochrome');
    expect(
      document
        .querySelector<HTMLLinkElement>('head link[rel~="icon"]')
        ?.getAttribute('href'),
    ).toContain('favicon-day'); // classic favicons — the site has no style entry
  });
});
