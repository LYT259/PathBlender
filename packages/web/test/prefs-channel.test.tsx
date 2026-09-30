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
vi.mock('@tauri-apps/api/core', () => ({ invoke: () => Promise.resolve() }));

beforeEach(() => {
  localStorage.clear();
  emit.checks.length = 0;
  Object.keys(menuHandlers).forEach((k) => delete menuHandlers[k]);
  (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
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

const prefsModal = () => document.querySelector('.prefs-modal');
const saveBtn = () => prefsModal()!.querySelector('.btn.small.accent') as HTMLButtonElement;
const cancelBtn = () => prefsModal()!.querySelector('.prefs-row.btns .btn.small:not(.accent)') as HTMLButtonElement;
// The channel select is the LAST one in the modal (after language & theme).
const channelSelect = () => {
  const all = prefsModal()!.querySelectorAll('select');
  return all[all.length - 1] as HTMLSelectElement;
};

async function openPrefs() {
  fireEvent.click(screen.getByRole('button', { name: 'Preferences' }));
  await waitFor(() => expect(prefsModal()).not.toBeNull());
}

describe('update channel staging (user report 2026-09-30)', () => {
  it('stages the channel: Save enables and applies, Cancel discards', async () => {
    await renderApp();
    await openPrefs();

    // Default is stable; switching to beta must NOT write anything yet.
    fireEvent.change(channelSelect(), { target: { value: 'beta' } });
    expect(localStorage.getItem('ghpb.updateChannel')).toBeNull();
    expect(saveBtn().disabled).toBe(false);

    // Cancel closes the modal and discards the draft.
    fireEvent.click(cancelBtn());
    await waitFor(() => expect(prefsModal()).toBeNull());
    expect(localStorage.getItem('ghpb.updateChannel')).toBeNull();

    // Re-open: select shows the persisted stable, Save disabled again.
    await openPrefs();
    await waitFor(() => expect(channelSelect().value).toBe('stable'));
    expect(saveBtn().disabled).toBe(true);

    // Save applies the staged channel.
    fireEvent.change(channelSelect(), { target: { value: 'beta' } });
    fireEvent.click(saveBtn());
    await waitFor(() => expect(prefsModal()).toBeNull());
    expect(localStorage.getItem('ghpb.updateChannel')).toBe('beta');
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
