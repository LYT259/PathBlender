/**
 * Desktop open-with channel (ADR-0003): the shell evals a
 * `pb-open-files` CustomEvent carrying [name, base64] pairs — both for
 * launch-argument files (double-click / "open with", delivered once the
 * page finishes loading) and for the shell-owned native import picker.
 * The pairs must reach the normal import pipeline (a robot appears); a
 * pre-mount stash must be consumed when React mounts afterwards.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/App';
import { ThemeProvider } from '../src/theme';

const native = vi.hoisted(() => ({ invoke: vi.fn((_c: string, ..._a: unknown[]) => Promise.resolve()) }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: native.invoke }));

beforeEach(() => localStorage.clear());

const SAMPLES = resolve(__dirname, '../../../samples');
const ghostautoB64 = (rel: string): string => {
  const text = readFileSync(resolve(SAMPLES, rel), 'utf-8');
  return btoa(String.fromCharCode(...new TextEncoder().encode(text)));
};

function renderApp() {
  render(
    <ThemeProvider>
      <App />
    </ThemeProvider>,
  );
}

afterEach(() => {
  cleanup();
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
  vi.resetModules();
});

describe('open-with channel', () => {
  it('delivers shell-pushed files through the normal import pipeline', async () => {
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = { invoke: native.invoke };
    renderApp();
    await waitFor(() => expect(document.querySelector('header')).toBeTruthy());

    window.dispatchEvent(
      new CustomEvent('pb-open-files', {
        detail: [['straight_run.ghostauto', ghostautoB64('ghostauto/straight_run.ghostauto')]],
      }),
    );

    await waitFor(() => expect(screen.getByText(/Robots \(1\)/)).toBeInTheDocument());
    expect(screen.getByText('#0001', { selector: '.robot-name' })).toBeInTheDocument();
    // The stash is consumed by the handler, not left on the window.
    expect((window as unknown as Record<string, unknown>).__pbOpenPayload).toBeUndefined();
  });

  it('consumes a payload stashed before React mounted', async () => {
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = { invoke: native.invoke };
    (window as unknown as Record<string, unknown>).__pbOpenPayload = [
      ['side_lane.ghostauto', ghostautoB64('ghostauto/side_lane.ghostauto')],
    ];
    renderApp();

    await waitFor(() => expect(screen.getByText(/Robots \(1\)/)).toBeInTheDocument());
    expect(screen.getByText('#0003', { selector: '.robot-name' })).toBeInTheDocument();
    expect((window as unknown as Record<string, unknown>).__pbOpenPayload).toBeUndefined();
  });

  it('ignores malformed payloads without crashing', async () => {
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = { invoke: native.invoke };
    renderApp();
    await waitFor(() => expect(document.querySelector('header')).toBeTruthy());

    window.dispatchEvent(new CustomEvent('pb-open-files', { detail: 'not-a-pair-list' }));
    window.dispatchEvent(new CustomEvent('pb-open-files', { detail: [[42, null]] }));

    // Still interactive afterwards: a good payload still imports.
    window.dispatchEvent(
      new CustomEvent('pb-open-files', {
        detail: [['stop_and_score.ghostauto', ghostautoB64('ghostauto/stop_and_score.ghostauto')]],
      }),
    );
    await waitFor(() => expect(screen.getByText(/Robots \(1\)/)).toBeInTheDocument());
    expect(screen.getByText('#0002', { selector: '.robot-name' })).toBeInTheDocument();
  });
});
