/**
 * Quit-time persistence. The autosave debounces 600 ms, so the last edit
 * before a Cmd+Q only survives if the close path flushes synchronously —
 * and on desktop that path is the Tauri window close event, not
 * `beforeunload` (WKWebView fires no unload event when the app quits;
 * measured 2026-10-06 against the WebKit store on disk).
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/App';

const registry = vi.hoisted(() => ({ handlers: new Map<symbol, () => void>() }));

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    onCloseRequested: (handler: (event: unknown) => void) => {
      const key = Symbol('close-requested');
      registry.handlers.set(key, () => handler({ preventDefault: () => {} }));
      return Promise.resolve(() => registry.handlers.delete(key));
    },
  }),
}));

async function openExample() {
  fireEvent.click(screen.getByRole('button', { name: 'Try an example' }));
  await screen.findByText('#8814', { selector: '.robot-name' }, { timeout: 10000 });
}

const fireClose = async () => {
  for (const run of [...registry.handlers.values()]) run();
  await new Promise((r) => setTimeout(r, 0));
};

const stored = () => JSON.parse(localStorage.getItem('pb.autosave.v1')!) as {
  savedAt: string;
  ui?: { selectedId?: string | null };
};

beforeEach(() => {
  localStorage.clear();
  registry.handlers.clear();
});

describe('autosave flush on quit', () => {
  it('writes the session when the desktop window close is requested', async () => {
    render(<App />);
    await openExample();
    expect(registry.handlers.size).toBeGreaterThan(0);
    localStorage.removeItem('pb.autosave.v1');

    await fireClose();
    expect(stored().robots).toHaveLength(2);
  });

  it('flushes the state as of the close, not as of mount', async () => {
    render(<App />);
    await openExample();
    // Select the second robot, then quit without waiting for the debounce.
    fireEvent.click(screen.getAllByText('#11019', { selector: '.robot-name' })[0]!);
    const selectedId = JSON.parse(localStorage.getItem('pb.autosave.v1')!).robots[1].id;
    localStorage.removeItem('pb.autosave.v1');

    await fireClose();
    expect(stored().ui?.selectedId).toBe(selectedId);
  });

  it('keeps flushing on the browser unload path', async () => {
    render(<App />);
    await openExample();
    localStorage.removeItem('pb.autosave.v1');

    fireEvent(window, new Event('beforeunload'));
    expect(stored().robots).toHaveLength(2);
  });
});
