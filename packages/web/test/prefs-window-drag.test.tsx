import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const native = vi.hoisted(() => ({
  invoke: vi.fn((_c: string, ..._a: unknown[]) => Promise.resolve()),
  startDragging: vi.fn(() => Promise.resolve()),
  close: vi.fn(() => Promise.resolve()),
}));
vi.mock('../src/update-check', () => ({
  runUpdateCheck: vi.fn(),
  checkForUpdate: vi.fn(),
  installPendingUpdate: vi.fn(),
}));
vi.mock('@tauri-apps/api/core', () => ({ invoke: native.invoke }));
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({ startDragging: native.startDragging, close: native.close }),
}));

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = { invoke: native.invoke };
  document.body.classList.add('desktop-macos');
  native.invoke.mockClear();
  native.startDragging.mockClear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.resetModules();
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
  document.body.classList.remove('desktop-macos');
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

  it('enables native background dragging on entry and disables it on exit', async () => {
    const { container } = await renderPrefsWindow();
    const layer = container.querySelector('.prefs-drag-layer')!;
    fireEvent.pointerOver(layer);
    await vi.waitFor(() => expect(native.invoke).toHaveBeenCalledWith('set_window_background_movable', { movable: true }));
    fireEvent.pointerLeave(layer);
    await vi.waitFor(() => expect(native.invoke).toHaveBeenCalledWith('set_window_background_movable', { movable: false }));
  });
});
