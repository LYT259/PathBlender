/**
 * Language staging in Preferences + cross-window sync (2026-10-11).
 *
 * Draft semantics: picking a row in the LanguagePicker only stages
 * `languageDraft` — neither 'pb.lang' nor the UI language move until Save.
 * Save applies, clears dirty and KEEPS the window open; Cancel/close drops
 * the draft. A fresh mount reads the saved choice back into the picker.
 *
 * Cross-window sync (desktop shell only): a saved language broadcasts
 * { key: 'lang' } over the Tauri 'pref' event so the other window applies it
 * instantly, and an incoming remote event is written to storage + state
 * WITHOUT re-broadcasting — the no-echo rule that stops the two windows
 * ping-ponging the preference forever. Off the desktop the bridge degrades
 * to a no-op, so a web Save emits nothing.
 *
 * The desktop tests stub `window.__TAURI_INTERNALS__` itself (the seam the
 * real shell fills; menu-dispatch/open-with/prefs-channel do the same)
 * rather than vi.mock-ing '@tauri-apps/api/event': under vitest 4 a module
 * mock of that externalized package proved unreliable for pref-sync's
 * dynamic import() — `listen` reached the mock but the `emit` from a click
 * handler never surfaced. Driving the real event module through the IPC
 * stub exercises the actual emit/listen serialization instead of a mock of
 * it.
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { de } from '../src/i18n/de';

/** Microtask + macrotask drain, so fire-and-forget dynamic imports settle. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  localStorage.clear();
  // Pin the OS appearance to light so 'system' theme/icon resolve deterministically.
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
});

afterEach(() => {
  cleanup();
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
  delete (window as unknown as Record<string, unknown>).__TAURI_EVENT_PLUGIN_INTERNALS__;
  vi.unstubAllGlobals();
  vi.resetModules();
});

/** Web-context panel: no Tauri marker, so the pref bridge stays a no-op. */
async function renderPanel(onClose: () => void = () => {}) {
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
  const [{ PreferencesPanel }, { ThemeProvider }, { AppIconProvider }, { UpdateChannelProvider }, i18n] = await Promise.all([
    import('../src/components/PreferencesPanel'),
    import('../src/theme'),
    import('../src/app-icon'),
    import('../src/update-channel'),
    import('../src/i18n'),
  ]);
  const { I18nProvider, LANGUAGES } = i18n;
  render(
    <ThemeProvider>
      <AppIconProvider>
        <UpdateChannelProvider>
          <I18nProvider>
            <PreferencesPanel desktop={false} onClose={onClose} />
          </I18nProvider>
        </UpdateChannelProvider>
      </AppIconProvider>
    </ThemeProvider>,
  );
  return { LANGUAGES };
}

/**
 * A stand-in for the runtime the desktop shell injects into every webview:
 * `invoke` records IPC calls; `transformCallback` files the event callback
 * away so the test can later play the backend and deliver a remote event.
 */
function installTauriRuntime() {
  const callbacks = new Map<number, (raw: unknown) => void>();
  let nextCallbackId = 0;
  const invoke = vi.fn((cmd: string, _args: unknown) =>
    // The listen handshake resolves with an event id; emit resolves empty.
    Promise.resolve(cmd === 'plugin:event|listen' ? 1 : undefined));
  (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {
    invoke,
    transformCallback: (cb: (raw: unknown) => void) => {
      const id = ++nextCallbackId;
      callbacks.set(id, cb);
      return id;
    },
    unregisterCallback: (id: number) => { callbacks.delete(id); },
  };
  // The event plugin's unlisten path touches these on provider unmount.
  (window as unknown as Record<string, unknown>).__TAURI_EVENT_PLUGIN_INTERNALS__ = {
    registerListener: vi.fn(),
    unregisterListener: vi.fn(),
  };
  return { invoke, callbacks };
}

describe('language staging in Preferences', () => {
  it('drafts the choice, applies it on Save with the window staying open, and discards it on Cancel', async () => {
    const onClose = vi.fn();
    const { LANGUAGES } = await renderPanel(onClose);

    // First visit: nothing saved, the picker shows the pinned system row.
    const trigger = screen.getByRole('button', { expanded: false });
    expect(trigger).toHaveTextContent('Follow system');
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();

    // Open the picker: the system row plus every registered language row.
    fireEvent.click(trigger);
    expect(await screen.findAllByRole('option')).toHaveLength(LANGUAGES.length);
    fireEvent.click(screen.getByRole('option', { name: /^Deutsch/ }));

    // Staged only: the trigger previews the draft and Save lights up, but
    // neither storage nor the surrounding (English) UI have moved.
    expect(trigger).toHaveTextContent('Deutsch');
    expect(localStorage.getItem('pb.lang')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Preferences' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();

    // Save applies: pb.lang persists, the UI switches to German, dirty clears
    // and the window stays open.
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(localStorage.getItem('pb.lang')).toBe('de');
    expect(await screen.findByRole('button', { name: de['prefs.save'] })).toBeDisabled();
    expect(onClose).not.toHaveBeenCalled();

    // Reopen: a fresh mount reads the saved choice back into the picker.
    cleanup();
    const onClose2 = vi.fn();
    await renderPanel(onClose2);
    const reopened = screen.getByRole('button', { expanded: false });
    expect(reopened).toHaveTextContent('Deutsch');
    expect(screen.getByRole('button', { name: de['prefs.save'] })).toBeDisabled();

    // Stage French, then Cancel: the draft dies, the saved German stands.
    fireEvent.click(reopened);
    fireEvent.click(await screen.findByRole('option', { name: /^Français/ }));
    expect(localStorage.getItem('pb.lang')).toBe('de');
    expect(screen.getByRole('button', { name: de['prefs.save'] })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: de['prefs.cancel'] }));
    expect(onClose2).toHaveBeenCalledOnce();
    expect(localStorage.getItem('pb.lang')).toBe('de');
  });
});

describe('cross-window language sync (desktop shell)', () => {
  async function renderDesktopProbe() {
    // The runtime stub must be in place BEFORE pref-sync is evaluated — the
    // desktop check reads the marker once at module scope, hence the reset +
    // fresh dynamic import.
    const ipc = installTauriRuntime();
    vi.resetModules();
    const { I18nProvider, useI18n } = await import('../src/i18n');
    function Probe() {
      const { lang, langChoice, setLang } = useI18n();
      return <div>
        <output data-testid="lang">{lang}</output>
        <output data-testid="choice">{langChoice}</output>
        <button type="button" onClick={() => setLang('de')}>set-de</button>
      </div>;
    }
    render(<I18nProvider><Probe /></I18nProvider>);
    return ipc;
  }

  it('setLang persists the choice and broadcasts it to the other window', async () => {
    const ipc = await renderDesktopProbe();
    fireEvent.click(screen.getByRole('button', { name: 'set-de' }));
    expect(localStorage.getItem('pb.lang')).toBe('de');
    expect(screen.getByTestId('choice')).toHaveTextContent('de');
    // The real event module serializes emit('pref', payload) into this IPC
    // (invoke's third options argument is left undefined).
    await waitFor(() => expect(ipc.invoke).toHaveBeenCalledWith(
      'plugin:event|emit',
      { event: 'pref', payload: { key: 'lang', value: 'de' } },
      undefined,
    ));
  });

  it('applies a remote lang event to storage and state — without echoing it back', async () => {
    const ipc = await renderDesktopProbe();
    // The provider subscribed on mount: the listen handshake carries the
    // callback id the backend would use to deliver events to this window.
    const listenArgs = await waitFor(() => {
      const call = ipc.invoke.mock.calls.find(([cmd]) => cmd === 'plugin:event|listen');
      expect(call).toBeDefined();
      return call![1] as { event: string; handler: number };
    });
    expect(listenArgs.event).toBe('pref');

    ipc.invoke.mockClear();
    const deliver = ipc.callbacks.get(listenArgs.handler)!;
    act(() => deliver({ event: 'pref', id: 1, payload: { key: 'lang', value: 'fr' } }));
    expect(localStorage.getItem('pb.lang')).toBe('fr');
    expect(screen.getByTestId('choice')).toHaveTextContent('fr');
    expect(screen.getByTestId('lang')).toHaveTextContent('fr');
    // No echo: applying the remote value must not re-broadcast, or the two
    // windows would bounce the same preference back and forth forever.
    await settle();
    expect(ipc.invoke.mock.calls.filter(([cmd]) => cmd === 'plugin:event|emit')).toEqual([]);
  });

  it('off the desktop shell the bridge is a no-op — it never reaches IPC', async () => {
    // No marker at import time: the web build fixes the bridge to no-op.
    vi.resetModules();
    const { broadcastPref, listenPrefs } = await import('../src/pref-sync');
    // Even if Tauri internals show up afterwards, a web-context helper must
    // not touch them (the gate was already evaluated).
    const invoke = vi.fn(() => Promise.resolve(undefined));
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = { invoke };
    expect(() => broadcastPref('lang', 'de')).not.toThrow();
    const unlisten = listenPrefs(() => { throw new Error('must never be called off-desktop'); });
    await settle();
    expect(invoke).not.toHaveBeenCalled();
    expect(() => unlisten()).not.toThrow();
  });
});
