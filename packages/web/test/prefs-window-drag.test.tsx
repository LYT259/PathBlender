/**
 * Settings window under the native title bar (2026-11-13, Approach B): the
 * window ships a visible native macOS title bar, so AppKit owns dragging and
 * the window menu — the web side renders no drag layer and never calls
 * startDragging itself. Escape still closes via the Tauri window API.
 */
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const native = vi.hoisted(() => ({
  startDragging: vi.fn(() => Promise.resolve()),
  close: vi.fn(() => Promise.resolve()),
}));
vi.mock('../src/update-check', () => ({
  runUpdateCheck: vi.fn(),
  checkForUpdate: vi.fn(),
  installPendingUpdate: vi.fn(),
}));
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(() => Promise.resolve()) }));
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({ startDragging: native.startDragging, close: native.close }),
}));

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.resetModules();
  native.startDragging.mockClear();
  native.close.mockClear();
});

async function renderPrefsWindow() {
  const [{ PrefsWindow }, { ThemeProvider }, { AppIconProvider }, { UpdateChannelProvider }, { I18nProvider }] = await Promise.all([
    import('../src/prefs-window'),
    import('../src/theme'),
    import('../src/app-icon'),
    import('../src/update-channel'),
    import('../src/i18n'),
  ]);
  return render(
    <ThemeProvider>
      <AppIconProvider>
        <UpdateChannelProvider>
          <I18nProvider>
            <PrefsWindow />
          </I18nProvider>
        </UpdateChannelProvider>
      </AppIconProvider>
    </ThemeProvider>,
  );
}

describe('settings window native chrome', () => {
  it('renders the panel with no drag layer — the native title bar owns dragging', async () => {
    const { container } = await renderPrefsWindow();
    expect(container.querySelector('.preferences-panel')).not.toBeNull();
    expect(container.querySelector('.prefs-drag-layer')).toBeNull();
  });

  it('mouse down on the window content never calls startDragging', async () => {
    const { container } = await renderPrefsWindow();
    const panel = container.querySelector('.preferences-panel')!;
    fireEvent.mouseDown(panel, { button: 0 });
    fireEvent.mouseDown(container.querySelector('.preferences-window')!, { button: 0 });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(native.startDragging).not.toHaveBeenCalled();
  });

  it('Escape still closes the window through the Tauri API', async () => {
    await renderPrefsWindow();
    fireEvent.keyDown(window, { key: 'Escape' });
    await vi.waitFor(() => expect(native.close).toHaveBeenCalledTimes(1));
  });
});
