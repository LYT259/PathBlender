/**
 * App-level regression tests for the .hoot gate wiring (Task 7, fix round 1).
 * The pure gate is not enough: importFiles must also drop .hoot from the
 * text-import list, or a browser .hoot drop double-reports (explicit notice
 * plus a generic parse failure) and a desktop hoot-only folder falsely
 * answers "no parseable route files". Stubs are synthetic — no real CTRE
 * sample exists (plan, external unverifiable #1).
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { HOOT_COMPLIANCY_OFFSET } from '@pathblender/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ThemeProvider } from '../src/theme';

const native = vi.hoisted(() => ({ invoke: vi.fn((_c: string, ..._a: unknown[]) => Promise.resolve()) }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: native.invoke }));

afterEach(() => {
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
  vi.resetModules();
});

/** Synthetic .hoot stub (zero bytes, compliancy byte set) with a drop path. */
function hootStubFile(name: string, compliancy: number, relPath: string): File {
  const bytes = new Uint8Array(HOOT_COMPLIANCY_OFFSET + 1);
  bytes[HOOT_COMPLIANCY_OFFSET] = compliancy;
  const file = new File([bytes], name);
  Object.defineProperty(file, 'webkitRelativePath', { value: relPath });
  return file;
}

describe('App .hoot routing', () => {
  it('a browser .hoot drop reports exactly the web notice — no generic parse failure', async () => {
    const { App } = await import('../src/App');
    render(<ThemeProvider><App /></ThemeProvider>);
    fireEvent.drop(window, { dataTransfer: { files: [hootStubFile('Log.hoot', 9, 'Log.hoot')] } });
    // The banner answers with ONE entry: the desktop/Phoenix-Tuner notice.
    await waitFor(() => expect(screen.getByText('1 file(s) failed to import:')).toBeTruthy(), { timeout: 3000 });
    expect(screen.getByText(/converted by the official CTRE tool/)).toBeTruthy();
    // The text parsers must never see the file: no "unrecognized format".
    expect(screen.queryByText(/unrecognized format/)).toBeNull();
  });

  it('a desktop hoot-only folder queues silently — no folderNoRoutes verdict', async () => {
    // IS_DESKTOP is read at module load, so the marker must exist before
    // the dynamic import below.
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = { invoke: native.invoke };
    const { App } = await import('../src/App');
    render(<ThemeProvider><App /></ThemeProvider>);
    fireEvent.drop(window, { dataTransfer: { files: [hootStubFile('Log.hoot', 9, 'hootdir/Log.hoot')] } });
    // The queue is invisible until Task 8 mounts its flow; the drop itself
    // must produce no error banner. The pipeline is microtask-bound, so one
    // macrotask is a safe settle bound before asserting absence.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.queryByText(/no parseable route files/)).toBeNull();
    expect(document.querySelector('.import-banner')).toBeNull();
  });
});
