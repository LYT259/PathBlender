/**
 * Main-window toolbar dragging (2026-11-13, Approach B): the window has a
 * visible native title bar, and the toolbar stays an explicit in-content
 * drag surface — left mouse down on the toolbar background or the drag
 * spacer calls getCurrentWindow().startDragging() (static import per
 * ADR-0003). Right-clicks, interactive controls, and browser rendering
 * never start a drag; the native context menu stays untouched.
 */
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ThemeProvider } from '../src/theme';
import type { ComponentType } from 'react';

const native = vi.hoisted(() => ({
  invoke: vi.fn((_c: string, ..._a: unknown[]) => Promise.resolve()),
  startDragging: vi.fn(() => Promise.resolve()),
}));
vi.mock('@tauri-apps/api/core', () => ({ invoke: native.invoke }));
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({ startDragging: native.startDragging }),
}));
const download = vi.hoisted(() => ({ saveText: vi.fn(() => Promise.resolve(true)), saveBytes: vi.fn(() => Promise.resolve(true)) }));
vi.mock('../src/download', () => ({ saveText: download.saveText, saveBytes: download.saveBytes, copyText: vi.fn(), IS_DESKTOP: true }));

// App decides IS_DESKTOP at module load — the marker must be on the window
// BEFORE the module is (re)imported, hence the dynamic import per test.
let App: ComponentType;

beforeEach(async () => {
  localStorage.clear();
  native.startDragging.mockClear();
  (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = { invoke: native.invoke };
  ({ App } = await import('../src/App'));
});

afterEach(() => {
  cleanup();
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
  vi.resetModules();
});

function renderDesktopApp() {
  render(
    <ThemeProvider>
      <App />
    </ThemeProvider>,
  );
}

function toolbar(): HTMLElement {
  const header = document.querySelector('header.workspace-toolbar');
  if (!header) throw new Error('toolbar not rendered');
  return header as HTMLElement;
}

describe('main window toolbar drag (desktop)', () => {
  it('left mouse down on the toolbar background starts a window drag', async () => {
    renderDesktopApp();
    await waitFor(() => expect(toolbar()).toBeTruthy());
    fireEvent.mouseDown(toolbar(), { button: 0 });
    await vi.waitFor(() => expect(native.startDragging).toHaveBeenCalledTimes(1));
  });

  it('left mouse down on the drag spacer starts a window drag', async () => {
    renderDesktopApp();
    await waitFor(() => expect(toolbar()).toBeTruthy());
    const spacer = toolbar().querySelector('.toolbar-spacer')!;
    expect(spacer.getAttribute('data-tauri-drag-region')).not.toBeNull();
    fireEvent.mouseDown(spacer, { button: 0 });
    await vi.waitFor(() => expect(native.startDragging).toHaveBeenCalledTimes(1));
  });

  it('right mouse down never starts a drag', async () => {
    renderDesktopApp();
    await waitFor(() => expect(toolbar()).toBeTruthy());
    fireEvent.mouseDown(toolbar(), { button: 2 });
    fireEvent.mouseDown(toolbar().querySelector('.toolbar-spacer')!, { button: 2 });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(native.startDragging).not.toHaveBeenCalled();
  });

  it('left mouse down on an interactive control never starts a drag', async () => {
    renderDesktopApp();
    await waitFor(() => expect(toolbar()).toBeTruthy());
    // The help and settings tool buttons render in every state (welcome
    // included); a click on them must keep its own meaning.
    const settings = toolbar().querySelector('button[aria-label="Preferences"]')!;
    const help = toolbar().querySelector('button[aria-label="Quick guide"]')!;
    fireEvent.mouseDown(settings, { button: 0 });
    fireEvent.mouseDown(help, { button: 0 });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(native.startDragging).not.toHaveBeenCalled();
  });
});

describe('main window toolbar drag (browser)', () => {
  it('rendering on the web never calls startDragging', async () => {
    // Re-evaluate the App module with the marker off (the outer beforeEach
    // imported it in desktop mode; the reset avoids the cached graph).
    vi.resetModules();
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
    ({ App } = await import('../src/App'));
    render(
      <ThemeProvider>
        <App />
      </ThemeProvider>,
    );
    await waitFor(() => expect(document.querySelector('header')).toBeTruthy());
    fireEvent.mouseDown(document.querySelector('header')!, { button: 0 });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(native.startDragging).not.toHaveBeenCalled();
  });
});
