/**
 * The hosted website is meant to import the way the app does — a whole folder
 * included. Until 2026-10-06 the folder picker was trimmed out of the website
 * build while folder DRAG-AND-DROP shipped untouched, so the site had the
 * capability without the control: invisible to visitors, unasserted by any
 * harness. These cases pin the intended shape: on the viewer build the folder
 * entry renders and a folder really imports.
 *
 * The mirror case — what the website must still NOT do — lives in
 * viewer-save-gate.test.tsx.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fireEvent, render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/App';

const mode = vi.hoisted(() => ({ viewerOnly: false }));

vi.mock('../src/viewer', async (importActual) => ({
  ...(await importActual<Record<string, unknown>>('../src/viewer')),
  get VIEWER_ONLY() { return mode.viewerOnly; },
}));

const samples = resolve(__dirname, '../../../samples');

/** A file the way a directory upload delivers it: named by its path below the root. */
function folderFile(samplePath: string, relPath: string) {
  const file = new File([readFileSync(resolve(samples, samplePath), 'utf8')], relPath.split('/').at(-1)!, {
    type: 'application/json',
  });
  Object.defineProperty(file, 'webkitRelativePath', { value: relPath });
  return file;
}

function picker(): HTMLInputElement {
  const input = document.querySelector<HTMLInputElement>('input[webkitdirectory]');
  if (!input) throw new Error('the website build mounts no directory input');
  return input;
}

beforeEach(() => {
  localStorage.clear();
  mode.viewerOnly = true;
});

describe('website build folder import', () => {
  it('renders the folder entry on the welcome screen and mounts the directory input', () => {
    render(<App />);
    expect(document.querySelector('.welcome-folder-import')).not.toBeNull();
    expect(document.querySelector('input[webkitdirectory]')).not.toBeNull();
  });

  it('imports a picked folder as a folder, not as loose files', async () => {
    render(<App />);
    fireEvent.click(document.querySelector('.welcome-folder-import')!);
    const input = picker();
    Object.defineProperty(input, 'files', {
      value: [
        folderFile('traj/v3_swerve.traj', '254/autos/L1.traj'),
        folderFile('ghostauto/straight_run.ghostauto', '254/autos/straight_run.ghostauto'),
      ],
      configurable: true,
      writable: true,
    });
    fireEvent.change(input);
    // One team named after the folder root, the other route kept in the library.
    await waitFor(() => expect(document.querySelectorAll('.robot-library-row')).toHaveLength(1));
    expect(document.querySelector('.import-banner')).toBeNull();
    expect(document.querySelector('.robot-name')?.textContent).toContain('254');
  });

  it('keeps a dropped folder working, same as the picker', async () => {
    render(<App />);
    fireEvent.drop(window, {
      dataTransfer: {
        files: [
          folderFile('ghostauto/straight_run.ghostauto', 'teamA/straight_run.ghostauto'),
          folderFile('ghostauto/stop_and_score.ghostauto', 'teamA/stop_and_score.ghostauto'),
        ],
      },
    });
    await waitFor(() => expect(document.querySelectorAll('.robot-library-row').length).toBeGreaterThan(0));
    expect(document.querySelector('.import-banner')).toBeNull();
  });
});
