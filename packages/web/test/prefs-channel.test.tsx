/**
 * Update-channel staging in the in-app Preferences (user report 2026-09-30):
 * switching the channel must NOT apply immediately — it stages like language
 * and theme; Save enables and applies; Cancel discards. And a failed update
 * check must show the ERROR toast, not the green success box.
 *
 * The settings window's "Check for updates" button is a real two-step flow:
 * checkForUpdate only queries the feed (the mock below records the channel
 * and holds the event callback so tests drive results explicitly), and a
 * found update installs ONLY via the separate "Install and relaunch"
 * button (installPendingUpdate). Checks always use the SAVED channel —
 * an unsaved channel draft only shows a hint.
 *
 * Also home of the app-icon appearance staging tests (0.1.6-beta.61): the
 * icon choice is an independent preference ('pb.appIcon', own storage key)
 * that drives the running app's Dock tile via the set_dock_icon shell
 * command — fixed light/dark pins artwork, 'system' pushes the artwork
 * matching the current OS appearance (re-pushed on every OS flip) — and
 * the interface theme no longer touches the Dock icon at all.
 *
 * The channel row is desktop-only (IS_DESKTOP at import time), so the Tauri
 * marker is stubbed before the lazy App import; the Tauri core module is
 * mocked. Menu commands arrive as shell-dispatched `pb-menu-*` DOM
 * CustomEvents (ADR-0003) — dispatching one drives the real check→toast
 * chain (the pref bridge itself is a web no-op in jsdom).
 */
import { act, fireEvent, render, screen, waitFor, cleanup, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const native = vi.hoisted(() => ({ invoke: vi.fn((_command: string, ..._args: unknown[]) => Promise.resolve()), close: vi.fn(() => Promise.resolve()) }));
const emit = vi.hoisted(() => ({ checks: [] as string[] }));
const prefsCheck = vi.hoisted(() => ({
  calls: [] as string[],
  onEvent: null as null | ((e: { kind: string; version?: string }) => void),
  install: vi.fn(() => Promise.resolve()),
}));
vi.mock('../src/update-check', () => ({
  runUpdateCheck: (channel: string, onEvent: (e: { kind: string }) => void) => {
    emit.checks.push(channel);
    onEvent({ kind: 'failed' });
    return Promise.resolve();
  },
  checkForUpdate: (channel: string, onEvent: (e: { kind: string; version?: string }) => void) => {
    prefsCheck.calls.push(channel);
    prefsCheck.onEvent = onEvent;
    return Promise.resolve();
  },
  installPendingUpdate: prefsCheck.install,
}));
vi.mock('@tauri-apps/api/core', () => ({ invoke: native.invoke }));
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => ({ close: native.close }) }));

beforeEach(() => {
  localStorage.clear();
  native.invoke.mockClear();
  native.close.mockClear();
  emit.checks.length = 0;
  prefsCheck.calls.length = 0;
  prefsCheck.onEvent = null;
  prefsCheck.install.mockClear();
  (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = { invoke: native.invoke };
  // Pin the OS appearance to light so 'system' resolves deterministically.
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
});
afterEach(() => {
  cleanup();
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
  vi.unstubAllGlobals();
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
  // main.tsx nests ThemeProvider > AppIconProvider > UpdateChannelProvider >
  // I18nProvider; the icon provider is what applies/persists the saved app
  // icon choice in the prefs window.
  const [{ PrefsWindow }, { UpdateChannelProvider }, { ThemeProvider }, { I18nProvider }, { AppIconProvider }] = await Promise.all([
    import('../src/prefs-window'), import('../src/update-channel'), import('../src/theme'), import('../src/i18n'), import('../src/app-icon'),
  ]);
  return render(<ThemeProvider><AppIconProvider><UpdateChannelProvider><I18nProvider><PrefsWindow /></I18nProvider></UpdateChannelProvider></AppIconProvider></ThemeProvider>);
}

function openUpdates() {
  fireEvent.click(screen.getByRole('tab', { name: 'Updates' }));
  return screen.getByRole('combobox', { name: 'Update channel' });
}

describe('shared desktop preferences', () => {
  it('stages the app icon choice: Save applies and persists, relaunch restores', async () => {
    const view = await renderPreferences();
    const icons = () => screen.getByRole('group', { name: 'App icon' });
    expect(within(icons()).getByRole('radio', { name: 'Follow system' })).toBeChecked();
    // Default 'system' mirrors the OS appearance with matching artwork
    // (matchMedia stubbed to light above).
    await waitFor(() => expect(native.invoke).toHaveBeenCalledWith('set_dock_icon', { dark: false }));
    // The preview-only note is gone; the hint now states the real scope.
    expect(screen.getByText('Applies to the Dock icon while the app is running. Finder and Launchpad always follow the system appearance.')).toBeInTheDocument();
    expect(screen.queryByText(/Preview only/)).not.toBeInTheDocument();

    // Staging a draft enables Save but touches neither storage nor native.
    native.invoke.mockClear();
    const storage = JSON.stringify(localStorage);
    fireEvent.click(within(icons()).getByRole('radio', { name: 'Dark', exact: true }));
    expect(within(icons()).getByRole('radio', { name: 'Dark', exact: true })).toBeChecked();
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
    expect(JSON.stringify(localStorage)).toBe(storage);
    expect(native.invoke).not.toHaveBeenCalled();
    // The icon draft does not move the interface theme.
    expect(within(screen.getByRole('group', { name: 'Theme' })).getByRole('radio', { name: 'Follow system' })).toBeChecked();

    // Save applies: own storage key, native pin, window stays open.
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(localStorage.getItem('pb.appIcon')).toBe('dark'));
    expect(localStorage.getItem('pb.theme')).toBeNull();
    await waitFor(() => expect(native.invoke).toHaveBeenCalledWith('set_dock_icon', { dark: true }));
    expect(native.close).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();

    // Relaunch: the saved choice comes back and is re-applied on mount.
    view.unmount();
    native.invoke.mockClear();
    await renderPreferences();
    expect(within(icons()).getByRole('radio', { name: 'Dark', exact: true })).toBeChecked();
    await waitFor(() => expect(native.invoke).toHaveBeenCalledWith('set_dock_icon', { dark: true }));
  });

  it('discards an unsaved app icon choice on Cancel', async () => {
    const view = await renderPreferences();
    const icons = () => screen.getByRole('group', { name: 'App icon' });
    fireEvent.click(within(icons()).getByRole('radio', { name: 'Light', exact: true }));
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(native.close).toHaveBeenCalledOnce());
    view.unmount();
    expect(localStorage.getItem('pb.appIcon')).toBeNull();

    await renderPreferences();
    expect(within(icons()).getByRole('radio', { name: 'Follow system' })).toBeChecked();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('theme changes no longer drive the Dock icon (decoupled)', async () => {
    await renderPreferences();
    const icons = () => screen.getByRole('group', { name: 'App icon' });
    // Pin the icon first…
    fireEvent.click(within(icons()).getByRole('radio', { name: 'Dark', exact: true }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(native.invoke).toHaveBeenCalledWith('set_dock_icon', { dark: true }));

    // …then move the interface theme: the icon must not follow.
    native.invoke.mockClear();
    fireEvent.click(within(screen.getByRole('group', { name: 'Theme', exact: true })).getByRole('radio', { name: 'Light', exact: true }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(localStorage.getItem('pb.theme')).toBe('light'));
    expect(localStorage.getItem('pb.appIcon')).toBe('dark');
    expect(native.invoke.mock.calls.filter((args) => args[0] === 'set_dock_icon')).toEqual([]);
    expect(within(icons()).getByRole('radio', { name: 'Dark', exact: true })).toBeChecked();
  });

  it('checks for updates in the settings window: click → checking → up to date, and shows the full version only in About', async () => {
    await renderPreferences();
    openUpdates();
    const { APP_VERSION } = await import('../src/version-info');
    expect(screen.queryByText(`Version ${APP_VERSION}`)).not.toBeInTheDocument();
    const button = screen.getByRole('button', { name: 'Check for updates' });
    expect(button).toBeEnabled();
    fireEvent.click(button);
    expect(prefsCheck.calls).toEqual(['stable']);
    expect(button).toBeDisabled(); // checking in flight
    act(() => prefsCheck.onEvent!({ kind: 'upToDate' }));
    expect(await screen.findByText("You're up to date")).toBeInTheDocument();
    expect(button).toBeEnabled();
    // The settings check never routes through the one-shot menu runner…
    expect(emit.checks).toEqual([]);
    // …and never installs or relaunches on its own.
    expect(prefsCheck.install).not.toHaveBeenCalled();
    // The full version still shows only in About.
    fireEvent.click(screen.getByRole('tab', { name: 'About' }));
    expect(document.querySelector('.preferences-version')).toHaveTextContent(`Version ${APP_VERSION}`);
    expect(document.querySelector('.preferences-product code')).toBeNull();
  });

  it('a found update shows the version plus an Install and relaunch button — only that button installs', async () => {
    await renderPreferences();
    openUpdates();
    fireEvent.click(screen.getByRole('button', { name: 'Check for updates' }));
    act(() => prefsCheck.onEvent!({ kind: 'found', version: '9.9.9' }));
    expect(await screen.findByText('Version 9.9.9 is available.')).toBeInTheDocument();
    // Clicking Check alone must NOT have installed or relaunched anything.
    expect(prefsCheck.install).not.toHaveBeenCalled();
    const install = screen.getByRole('button', { name: 'Install and relaunch' });
    expect(install).not.toHaveClass('accent'); // secondary action, distinct from the accent check button
    fireEvent.click(install);
    expect(prefsCheck.install).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('Found v9.9.9, downloading and relaunching…')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Install and relaunch' })).not.toBeInTheDocument();
  });

  it('a failed check shows the update error inside the settings window', async () => {
    await renderPreferences();
    openUpdates();
    fireEvent.click(screen.getByRole('button', { name: 'Check for updates' }));
    act(() => prefsCheck.onEvent!({ kind: 'failed' }));
    expect(await screen.findByText('Update check failed — check your connection and try again')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Check for updates' })).toBeEnabled();
    expect(prefsCheck.install).not.toHaveBeenCalled();
  });

  it('ignores extra clicks while a check is in flight — one native request', async () => {
    await renderPreferences();
    openUpdates();
    const button = screen.getByRole('button', { name: 'Check for updates' });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(prefsCheck.calls).toEqual(['stable']);
    act(() => prefsCheck.onEvent!({ kind: 'upToDate' }));
    expect(await screen.findByText("You're up to date")).toBeInTheDocument();
  });

  it('checks use the SAVED channel, not the draft — and says so next to the button', async () => {
    await renderPreferences();
    fireEvent.change(openUpdates(), { target: { value: 'beta' } });
    expect(await screen.findByText('Update checks use the saved channel: Stable.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Check for updates' }));
    expect(prefsCheck.calls).toEqual(['stable']);
    act(() => prefsCheck.onEvent!({ kind: 'upToDate' }));
    expect(await screen.findByText("You're up to date")).toBeInTheDocument();
  });

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
    expect(localStorage.getItem('pb.updateChannel')).toBeNull();
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(native.close).toHaveBeenCalledOnce());
    first.unmount();
    expect(localStorage.getItem('pb.updateChannel')).toBeNull();

    await renderPreferences();
    expect(openUpdates()).toHaveValue('stable');
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    fireEvent.change(screen.getByRole('combobox', { name: 'Update channel' }), { target: { value: 'beta' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    // Save applies but KEEPS the window open (user request 2026-10-02):
    // still only the one close from the Cancel above.
    await waitFor(() => expect(localStorage.getItem('pb.updateChannel')).toBe('beta'));
    expect(native.close).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('retains appearance drafts across sections and applies only on Save', async () => {
    await renderPreferences();
    fireEvent.click(within(screen.getByRole('group', { name: 'Theme', exact: true })).getByRole('radio', { name: 'Dark', exact: true }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Language' }), { target: { value: 'zh' } });
    const general = screen.getByRole('tab', { name: 'General' });
    general.focus();
    fireEvent.keyDown(general, { key: 'End' });
    expect(screen.getByRole('tab', { name: 'About' })).toHaveFocus();
    expect(screen.getByRole('heading', { name: 'Recent changes' })).toBeInTheDocument();
    expect(localStorage.getItem('pb.theme')).toBeNull();
    fireEvent.keyDown(screen.getByRole('tab', { name: 'About' }), { key: 'Home' });
    expect(within(screen.getByRole('group', { name: 'Theme', exact: true })).getByRole('radio', { name: 'Dark', exact: true })).toBeChecked();
    expect(screen.getByRole('combobox', { name: 'Language' })).toHaveValue('zh');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(localStorage.getItem('pb.theme')).toBe('dark'));
    expect(localStorage.getItem('pb.lang')).toBe('zh');
    // Save applies without closing the settings window.
    expect(native.close).not.toHaveBeenCalled();
  });

  it('a failed update check shows the error toast, not the green success box', async () => {
    await renderApp();
    await waitFor(() => expect(document.querySelector('header')).toBeTruthy());
    // The native menu's "Check for Updates…" now arrives as a shell-dispatched
    // DOM event (ADR-0003): dispatch it to drive the real chain
    // checkForUpdates → (mocked) runUpdateCheck emits failed → toast.
    window.dispatchEvent(new CustomEvent('pb-menu-check-update'));

    await waitFor(() => {
      const toast = document.querySelector('.toast');
      if (!toast) throw new Error('no toast');
      expect(toast.classList.contains('error')).toBe(true);
      expect(toast.textContent).toMatch(/failed|网络|網絡|network/i);
    });
  });
});
