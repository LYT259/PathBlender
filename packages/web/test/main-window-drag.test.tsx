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

let App: ComponentType;

beforeEach(async () => {
  localStorage.clear();
  native.invoke.mockClear();
  native.startDragging.mockClear();
  (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = { invoke: native.invoke };
  document.body.classList.add('desktop-macos');
  ({ App } = await import('../src/App'));
});

afterEach(() => {
  cleanup();
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
  document.body.classList.remove('desktop-macos');
  vi.resetModules();
});

function renderDesktopApp() {
  render(<ThemeProvider><App /></ThemeProvider>);
}

function toolbar(): HTMLElement {
  const header = document.querySelector('header.workspace-toolbar');
  if (!header) throw new Error('toolbar not rendered');
  return header as HTMLElement;
}

function movableCalls(): unknown[] {
  return native.invoke.mock.calls.filter(([name]) => name === 'set_window_background_movable').map(([, args]) => args);
}

describe('main window toolbar drag (macOS desktop)', () => {
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
    const settings = toolbar().querySelector('button[aria-label="Preferences"]')!;
    const help = toolbar().querySelector('button[aria-label="Quick guide"]')!;
    fireEvent.mouseDown(settings, { button: 0 });
    fireEvent.mouseDown(help, { button: 0 });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(native.startDragging).not.toHaveBeenCalled();
  });

  it('blank chrome enables native background dragging, controls disable it, and leaving disables it', async () => {
    renderDesktopApp();
    await waitFor(() => expect(toolbar()).toBeTruthy());
    const spacer = toolbar().querySelector('.toolbar-spacer')!;
    const settings = toolbar().querySelector('button[aria-label="Preferences"]')!;
    fireEvent.pointerOver(spacer);
    await vi.waitFor(() => expect(movableCalls()).toEqual([{ movable: true }]));
    fireEvent.pointerOver(settings);
    await vi.waitFor(() => expect(movableCalls()).toEqual([{ movable: true }, { movable: false }]));
    fireEvent.pointerOver(spacer);
    fireEvent.pointerLeave(toolbar());
    await vi.waitFor(() => expect(movableCalls()).toEqual([
      { movable: true }, { movable: false }, { movable: true }, { movable: false },
    ]));
  });
});

describe('main window toolbar drag (browser)', () => {
  it('rendering on the web never calls native dragging', async () => {
    vi.resetModules();
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
    document.body.classList.remove('desktop-macos');
    ({ App } = await import('../src/App'));
    render(<ThemeProvider><App /></ThemeProvider>);
    await waitFor(() => expect(document.querySelector('header')).toBeTruthy());
    fireEvent.pointerOver(document.querySelector('header')!);
    fireEvent.mouseDown(document.querySelector('header')!, { button: 0 });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(native.startDragging).not.toHaveBeenCalled();
    expect(native.invoke).not.toHaveBeenCalledWith('set_window_background_movable', expect.anything());
  });
});
