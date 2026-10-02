/**
 * Update-channel staging in the in-app Preferences (user report 2026-09-30):
 * switching the channel must NOT apply immediately — it stages like language
 * and theme; Save enables and applies; Cancel discards. And a failed update
 * check must show the ERROR toast, not the green success box.
 *
 * The channel row is desktop-only (IS_DESKTOP at import time), so the Tauri
 * marker is stubbed before the lazy App import; the Tauri event/core modules
 * are mocked — the menu handler capture is how the test drives the real
 * check→toast chain (the pref bridge itself is a web no-op in jsdom).
 */
import { fireEvent, render, screen, waitFor, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const native = vi.hoisted(() => ({ invoke: vi.fn((_command: string, ..._args: unknown[]) => Promise.resolve()), close: vi.fn(() => Promise.resolve()) }));
const emit = vi.hoisted(() => ({ checks: [] as string[] }));
const menuHandlers = vi.hoisted(() => ({} as Record<string, (e: unknown) => void>));
vi.mock('../src/update-check', () => ({
  runUpdateCheck: (channel: string, onEvent: (e: { kind: string }) => void) => {
    emit.checks.push(channel);
    onEvent({ kind: 'failed' });
    return Promise.resolve();
  },
}));
vi.mock('@tauri-apps/api/event', () => ({
  listen: (name: string, cb: (e: unknown) => void) => {
    menuHandlers[name] = cb;
    return Promise.resolve(() => undefined);
  },
}));
vi.mock('@tauri-apps/api/core', () => ({ invoke: native.invoke }));
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => ({ close: native.close }) }));

beforeEach(() => {
  localStorage.clear();
  native.invoke.mockClear();
  native.close.mockClear();
  emit.checks.length = 0;
  Object.keys(menuHandlers).forEach((k) => delete menuHandlers[k]);
  (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = { invoke: native.invoke };
});
afterEach(() => {
  cleanup();
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
  vi.resetModules();
});

async function renderApp() {
  // main.tsx nests ThemeProvider > UpdateChannelProvider > I18nProvider > App;
  // without the channel provider the context default no-ops setChannel.
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

async function renderPreferences() {
  const [{ PrefsWindow }, { UpdateChannelProvider }, { ThemeProvider }, { I18nProvider }] = await Promise.all([
    import('../src/prefs-window'), import('../src/update-channel'), import('../src/theme'), import('../src/i18n'),
  ]);
  return render(<ThemeProvider><UpdateChannelProvider><I18nProvider><PrefsWindow /></I18nProvider></UpdateChannelProvider></ThemeProvider>);
}

function openUpdates() {
  fireEvent.click(screen.getByRole('tab', { name: 'Updates' }));
  return screen.getByRole('combobox', { name: 'Update channel' });
}

describe('shared desktop preferences', () => {
  it('opens the native settings window from the toolbar', async () => {
    await renderApp();
    fireEvent.click(screen.getByRole('button', { name: 'Preferences' }));
    await vi.dynamicImportSettled();
    await waitFor(() => expect(native.invoke.mock.calls.some((args) => args[0] === 'open_preferences')).toBe(true));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('stages the channel: Save applies, Cancel discards', async () => {
    const first = await renderPreferences();
    fireEvent.change(openUpdates(), { target: { value: 'beta' } });
    expect(localStorage.getItem('ghpb.updateChannel')).toBeNull();
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(native.close).toHaveBeenCalledOnce());
    first.unmount();
    expect(localStorage.getItem('ghpb.updateChannel')).toBeNull();

    await renderPreferences();
    expect(openUpdates()).toHaveValue('stable');
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    fireEvent.change(screen.getByRole('combobox', { name: 'Update channel' }), { target: { value: 'beta' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(native.close).toHaveBeenCalledTimes(2));
    expect(localStorage.getItem('ghpb.updateChannel')).toBe('beta');
  });

  it('retains appearance drafts across sections and applies only on Save', async () => {
    await renderPreferences();
    fireEvent.click(screen.getByRole('radio', { name: 'Dark', exact: true }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Language' }), { target: { value: 'zh' } });
    const general = screen.getByRole('tab', { name: 'General' });
    general.focus();
    fireEvent.keyDown(general, { key: 'End' });
    expect(screen.getByRole('tab', { name: 'About' })).toHaveFocus();
    expect(screen.getByRole('heading', { name: 'Recent changes' })).toBeInTheDocument();
    expect(localStorage.getItem('ghpb.theme')).toBeNull();
    fireEvent.keyDown(screen.getByRole('tab', { name: 'About' }), { key: 'Home' });
    expect(screen.getByRole('radio', { name: 'Dark', exact: true })).toBeChecked();
    expect(screen.getByRole('combobox', { name: 'Language' })).toHaveValue('zh');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(native.close).toHaveBeenCalledOnce());
    expect(localStorage.getItem('ghpb.theme')).toBe('dark');
    expect(localStorage.getItem('ghpb.lang')).toBe('zh');
  });

  it('a failed update check shows the error toast, not the green success box', async () => {
    await renderApp();
    // The native menu's "Check for Updates…" drives the real chain:
    // checkForUpdates → (mocked) runUpdateCheck emits failed → toast.
    await waitFor(() => expect(menuHandlers['menu-check-update']).toBeTruthy());
    menuHandlers['menu-check-update']!(undefined);

    await waitFor(() => {
      const toast = document.querySelector('.toast');
      if (!toast) throw new Error('no toast');
      expect(toast.classList.contains('error')).toBe(true);
      expect(toast.textContent).toMatch(/failed|网络|網絡|network/i);
    });
  });
});
