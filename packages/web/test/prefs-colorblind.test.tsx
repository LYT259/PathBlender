/**
 * Colorblind-palette staging (user request 2026-10-04): the checkbox only
 * drafts the choice — like language, theme and the update channel, nothing
 * is persisted to localStorage ('pb.colorblind') or broadcast to the other
 * window until Save; closing without Save keeps the saved value.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The updates section is never visited, but the panel imports the module —
// keep its Tauri updater chain out of jsdom.
vi.mock('../src/update-check', () => ({
  runUpdateCheck: vi.fn(),
  checkForUpdate: vi.fn(),
  installPendingUpdate: vi.fn(),
}));
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(() => Promise.resolve()) }));
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => ({ close: vi.fn(() => Promise.resolve()) }) }));

beforeEach(() => {
  localStorage.clear();
  // Pin the OS appearance to light so 'system' resolves deterministically.
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.resetModules();
});

async function renderPanel(onClose = vi.fn()) {
  const [{ PreferencesPanel }, { ThemeProvider }, { AppIconProvider }, { UpdateChannelProvider }, { I18nProvider }] = await Promise.all([
    import('../src/components/PreferencesPanel'),
    import('../src/theme'),
    import('../src/app-icon'),
    import('../src/update-channel'),
    import('../src/i18n'),
  ]);
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
}

describe('colorblind palette staging', () => {
  it('drafts the toggle and applies it only on Save', async () => {
    localStorage.setItem('pb.colorblind', '0');
    await renderPanel();
    const box = await screen.findByRole('checkbox', { name: 'Colorblind palette' });
    const save = screen.getByRole('button', { name: 'Save' });
    expect(box).not.toBeChecked();
    expect(save).toBeDisabled();
    fireEvent.click(box);
    expect(box).toBeChecked();
    // Staged only: nothing persisted yet, Save is now enabled.
    expect(localStorage.getItem('pb.colorblind')).toBe('0');
    expect(save).toBeEnabled();
    fireEvent.click(save);
    expect(localStorage.getItem('pb.colorblind')).toBe('1');
    expect(save).toBeDisabled();
    // Toggling back stages again; without another Save the stored value stands.
    fireEvent.click(box);
    expect(box).not.toBeChecked();
    expect(localStorage.getItem('pb.colorblind')).toBe('1');
    expect(save).toBeEnabled();
  });

  it('starts from the saved value', async () => {
    localStorage.setItem('pb.colorblind', '1');
    await renderPanel();
    expect(await screen.findByRole('checkbox', { name: 'Colorblind palette' })).toBeChecked();
  });
});
