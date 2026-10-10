/**
 * The unload flush: the autosave debounces, so a close right after an edit
 * only survives if `beforeunload` writes synchronously (browser path — on
 * desktop WKWebView fires neither `beforeunload` nor a Tauri window-close
 * event when the app quits, measured against the WebKit store 2026-10-06;
 * the scene-op save above is what keeps desktop work safe).
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { App } from '../src/App';

async function openExample() {
  fireEvent.click(screen.getByRole('button', { name: 'Try an example' }));
  await screen.findByText('11019', { selector: '.robot-name' }, { timeout: 10000 });
}

const stored = () => JSON.parse(localStorage.getItem('pb.autosave.v1')!) as {
  robots: { id: string }[];
  ui?: { selectedId?: string | null };
};

beforeEach(() => localStorage.clear());

describe('autosave flush on unload', () => {
  it('writes the session when the page unloads', async () => {
    render(<App />);
    await openExample();
    localStorage.removeItem('pb.autosave.v1');

    fireEvent(window, new Event('beforeunload'));
    expect(stored().robots).toHaveLength(3);
  });

  it('writes the state as of the flush, not as of mount', async () => {
    render(<App />);
    await openExample();
    // Select the second robot, then close without waiting for the debounce.
    fireEvent.click(screen.getAllByText('8814', { selector: '.robot-name' })[0]!);
    const selectedId = stored().robots[1]!.id;
    localStorage.removeItem('pb.autosave.v1');

    fireEvent(window, new Event('beforeunload'));
    expect(stored().ui?.selectedId).toBe(selectedId);
  });
});
