/**
 * Menu wiring in the app: desktop `pb-menu-*` events drive the same handlers
 * as the workspace buttons; the whole spec is pushed to the shell (`set_menu`);
 * the toolbar Save button is gone — File ▸ Save Session is the entry now.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ThemeProvider } from '../src/theme';
import type { ComponentType } from 'react';

const native = vi.hoisted(() => ({ invoke: vi.fn((_c: string, ..._a: unknown[]) => Promise.resolve()) }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: native.invoke }));
const download = vi.hoisted(() => ({ saveText: vi.fn(() => Promise.resolve(true)), saveBytes: vi.fn(() => Promise.resolve(true)) }));
vi.mock('../src/download', () => ({ saveText: download.saveText, saveBytes: download.saveBytes, copyText: vi.fn(), IS_DESKTOP: true }));

// App decides IS_DESKTOP at module load — the flag must be on the window
// BEFORE the module is (re)imported, hence the dynamic import per test.
let App: ComponentType;

beforeEach(async () => {
  localStorage.clear();
  download.saveText.mockClear();
  download.saveBytes.mockClear();
  native.invoke.mockClear();
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

const SAMPLES = resolve(__dirname, '../../../samples');
const ghostauto = resolve(SAMPLES, 'ghostauto/straight_run.ghostauto');

function b64(path: string): string {
  return btoa(String.fromCharCode(...new Uint8Array(readFileSync(path))));
}

async function importStraightRun() {
  // The same channel the shell's import picker uses (ADR-0003) — it lands in
  // the ordinary importFiles pipeline on desktop.
  window.dispatchEvent(new CustomEvent('pb-open-files', {
    detail: [['straight_run.ghostauto', b64(ghostauto)]],
  }));
  await waitFor(() => expect(screen.getByText(/Robots \(1\)/)).toBeInTheDocument());
}

describe('desktop menu dispatch', () => {
  it('pushes the whole menu spec to the shell via set_menu', async () => {
    renderDesktopApp();
    await waitFor(() => expect(document.querySelector('header')).toBeTruthy());
    await waitFor(() => expect(native.invoke).toHaveBeenCalledWith('set_menu', expect.objectContaining({ payload: expect.objectContaining({ menus: expect.any(Array) }) })));
    const call = native.invoke.mock.calls.find(([c]) => c === 'set_menu')!;
    const payload = (call![1] as { payload: { menus: Array<{ label: string }> } }).payload;
    expect(payload.menus.map((m) => m.label)).toEqual(['PathBlender', 'File', 'Edit', 'View', 'Playback', 'Window', 'Help']);
  });

  it('File ▸ Save Session saves a .pb session file', async () => {
    renderDesktopApp();
    await importStraightRun();
    window.dispatchEvent(new CustomEvent('pb-menu-save'));
    await waitFor(() => expect(download.saveText).toHaveBeenCalled());
    const [name, ext, text] = download.saveText.mock.calls[0]!;
    expect(String(name)).toMatch(/^session-\d{4}-\d{2}-\d{2}\.pb$/);
    expect(ext).toBe('json');
    const parsed = JSON.parse(text as string);
    expect(parsed.app).toBe('pathblender');
  });

  it('Edit ▸ Undo dispatch is wired without crashing on an empty history', () => {
    renderDesktopApp();
    expect(() => window.dispatchEvent(new CustomEvent('pb-menu-undo'))).not.toThrow();
    expect(() => window.dispatchEvent(new CustomEvent('pb-menu-redo'))).not.toThrow();
  });

  it('Export Solution Package with an empty session reports the honest toast', async () => {
    renderDesktopApp();
    await waitFor(() => expect(document.querySelector('header')).toBeTruthy());
    window.dispatchEvent(new CustomEvent('pb-menu-export-package'));
    await waitFor(() => expect(screen.getByText('Import paths before exporting a solution package')).toBeInTheDocument());
    expect(download.saveBytes).not.toHaveBeenCalled();
  });

  it('the toolbar no longer carries the Save button (moved to the File menu)', async () => {
    renderDesktopApp();
    await importStraightRun();
    expect(document.querySelector('.save-action')).toBeNull();
    expect(screen.queryByText('Save', { selector: 'header button' })).toBeNull();
  });

  it('Playback ▸ Play/Pause flips the playing state', async () => {
    renderDesktopApp();
    await importStraightRun();
    window.dispatchEvent(new CustomEvent('pb-menu-play-pause'));
    await waitFor(() => expect(document.querySelector('[aria-label="Pause"]')).toBeTruthy());
    window.dispatchEvent(new CustomEvent('pb-menu-play-pause'));
    await waitFor(() => expect(document.querySelector('[aria-label="Play"]')).toBeTruthy());
  });
});

describe('web menubar (no Tauri)', () => {
  async function renderWebApp() {
    // Re-evaluate the App module with the flag off (the outer beforeEach
    // already imported it in desktop mode; without the reset the cached
    // module graph would keep IS_DESKTOP = true).
    vi.resetModules();
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
    ({ App } = await import('../src/App'));
    render(
      <ThemeProvider>
        <App />
      </ThemeProvider>,
    );
  }

  it('renders a DOM menubar with File|Edit|View|Playback|Help (no native menu exists)', async () => {
    await renderWebApp();
    const tops = Array.from(document.querySelectorAll('.menu-top')).map((el) => el.textContent);
    expect(tops).toEqual(['File', 'Edit', 'View', 'Playback', 'Help']);
    // The macOS-only sections stay native-only on desktop builds.
    expect(tops).not.toContain('PathBlender');
    expect(tops).not.toContain('Window');
  });

  it('a menu command reaches the shared handler table on the web too', async () => {
    await renderWebApp();
    await importStraightRun();
    fireEvent.click(screen.getByText('File', { selector: '.menu-top' }));
    fireEvent.click(screen.getByText('Save session'));
    await waitFor(() => expect(download.saveText).toHaveBeenCalled());
  });
});
