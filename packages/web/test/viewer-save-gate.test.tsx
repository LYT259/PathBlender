/**
 * The hosted website is a viewer build: it must not write session files.
 * Hiding the menu item alone was not enough — the window Ctrl/Cmd+S
 * accelerator kept calling saveSession, so pathblender.pages.dev downloaded a
 * .pb with no button anywhere (found 2026-10-06 by scripts/viewer-check.mjs).
 * These two cases pin both directions: the full build still saves, the viewer
 * build refuses, whichever key combination is used.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/App';

const mode = vi.hoisted(() => ({ viewerOnly: false }));
const saveText = vi.hoisted(() => vi.fn().mockResolvedValue(true));

vi.mock('../src/viewer', async (importActual) => ({
  ...(await importActual<Record<string, unknown>>('../src/viewer')),
  get VIEWER_ONLY() { return mode.viewerOnly; },
}));
vi.mock('../src/download', () => ({
  saveText,
  saveBytes: vi.fn().mockResolvedValue(true),
  copyText: vi.fn().mockResolvedValue(true),
}));

const sample = readFileSync(resolve(__dirname, '../../../samples/ghostauto/straight_run.ghostauto'), 'utf8');

/** Drop one real sample in through the window drop target, as a user would. */
async function loadRobot() {
  render(<App />);
  fireEvent.drop(window, { dataTransfer: { files: [new File([sample], 'straight_run.ghostauto')] } });
  await screen.findByText('#0001', { selector: '.robot-name' });
}

beforeEach(() => {
  localStorage.clear();
  saveText.mockClear();
  mode.viewerOnly = false;
});

describe('viewer build session gate', () => {
  it('writes a session file from the keyboard on the full build', async () => {
    await loadRobot();
    fireEvent.keyDown(window, { key: 's', ctrlKey: true });
    await waitFor(() => expect(saveText).toHaveBeenCalledTimes(1));
    expect(saveText.mock.calls[0]![0]).toMatch(/^session-\d{4}-\d{2}-\d{2}\.pb$/);
  });

  it('refuses to write one on the website build, by any accelerator', async () => {
    mode.viewerOnly = true;
    await loadRobot();
    // The session is really there (the import path is not gated) — only the
    // save door is closed.
    fireEvent.keyDown(window, { key: 's', ctrlKey: true });
    fireEvent.keyDown(window, { key: 's', metaKey: true });
    await waitFor(() => expect(screen.getByText('#0001', { selector: '.robot-name' })).toBeInTheDocument());
    expect(saveText).not.toHaveBeenCalled();
    expect(document.querySelector('.welcome-folder-import')).toBeNull();
  });
});
