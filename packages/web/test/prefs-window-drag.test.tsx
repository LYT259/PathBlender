/**
 * Settings-window dragging (user report 2026-10-04): the overlay title bar
 * leaves no native drag area, so the transparent top layer must start the
 * drag. Besides the injected data-tauri-drag-region attribute path, the
 * layer calls getCurrentWindow().startDragging() directly on mouse down —
 * the deterministic path that keeps the window draggable. Right-clicks and
 * clicks on the panel below must NOT start a drag.
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

describe('settings window drag layer', () => {
  it('left mouse down on the drag layer calls startDragging, and the layer stays a drag region for the injected handler', async () => {
    const { container } = await renderPrefsWindow();
    const layer = container.querySelector('.prefs-drag-layer');
    expect(layer).not.toBeNull();
    expect(layer!.getAttribute('data-tauri-drag-region')).not.toBeNull();
    fireEvent.mouseDown(layer!, { button: 0 });
    await vi.waitFor(() => expect(native.startDragging).toHaveBeenCalledTimes(1));
  });

  it('ignores non-left buttons and clicks below the layer', async () => {
    const { container } = await renderPrefsWindow();
    const layer = container.querySelector('.prefs-drag-layer')!;
    fireEvent.mouseDown(layer, { button: 2 });
    const panel = container.querySelector('.preferences-panel')!;
    fireEvent.mouseDown(panel, { button: 0 });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(native.startDragging).not.toHaveBeenCalled();
  });
});
