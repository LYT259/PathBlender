/**
 * Colorblind-palette consistency across the entry points where robots
 * enter the session state (user-approved muted palette, 2026-10-05):
 *
 * - a path import while the preference is already on lands in colorblind
 *   colors (the toggle effect alone only fires when the preference flips);
 * - an autosaved session written with a PRE-migration default color
 *   restores migrated AND colorblind-mapped;
 * - the welcome example lands in colorblind colors while enabled;
 * - in a plain browser shell (no Tauri broadcast), Save in the embedded
 *   preferences panel applies the palette immediately.
 *
 * Band dots are the DOM surface every UI spot reads `robot.color` through,
 * so the assertions travel with whatever the list, timeline and canvases
 * render.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/App';
import { makeSession, parseGhostAuto, serializeSession } from '@pathblender/core';

const SAMPLES = resolve(__dirname, '../../../samples');
const read = (rel: string): string => readFileSync(resolve(SAMPLES, rel), 'utf-8');

const file = (rel: string): File =>
  new File([read(rel)], rel.split('/').pop() as string, { type: 'application/json' });

function dropFiles(files: File[]): void {
  fireEvent.drop(window, { dataTransfer: { files } });
}

/** First robot's band dot color, lowercased — hex and rgb() both accepted. */
function firstDotColor(): string {
  const dot = document.querySelector('.band-dot') as HTMLElement;
  expect(dot).not.toBeNull();
  return (dot.style.backgroundColor || dot.style.background).toLowerCase();
}

// The example route set is ~1.6 MB of lazy-imported text. Transforming it
// at click time regularly blew waitFor's 1 s default under parallel-session
// load (the acceptance round caught this as a deterministic flake); loading
// it once up front makes the app's dynamic import() resolve from the module
// cache, so the assertions time the state update, not the transform.
beforeAll(async () => {
  await import('../src/welcome-example');
});
beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('pb.lengthUnit', 'm');
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('colorblind palette across session entry points', () => {
  it('importing while the preference is already on lands in colorblind colors', async () => {
    localStorage.setItem('pb.colorblind', '1');
    render(<App />);
    dropFiles([file('ghostauto/straight_run.ghostauto')]);
    await waitFor(() => expect(document.querySelector('.band-dot')).not.toBeNull());
    expect(firstDotColor()).toMatch(/#0072b2|rgb\(0, 114, 178\)/);
  });

  it('restoring an old-default-color autosave migrates AND colorblind-maps', async () => {
    // Build the autosave the way a pre-2026-10-05 build wrote it: the robot
    // carries the former slot-1 default '#FF6EC7'. Renamed to a non-example
    // identity so the restore does not swap in a freshly colored demo.
    const robot = makeSession(parseGhostAuto(read('ghostauto/straight_run.ghostauto'), 'routes/run.ghostauto'));
    robot.trajectory = { ...robot.trajectory, id: 'restore-fixture-robot', name: 'run.ghostauto' };
    const session = JSON.parse(serializeSession([robot], 'rebuilt-2026'));
    session.robots[0].color = '#FF6EC7';
    localStorage.setItem('pb.autosave.v1', JSON.stringify(session));
    localStorage.setItem('pb.colorblind', '1');
    render(<App />);
    await waitFor(() => expect(document.querySelector('.band-dot')).not.toBeNull());
    // Skipping the core migration leaves the unmapped pink; skipping the
    // entry-point alignment leaves the muted gold. Only both steps together
    // land on the first colorblind slot.
    expect(firstDotColor()).toMatch(/#0072b2|rgb\(0, 114, 178\)/);
  });

  it('the welcome example lands in colorblind colors while enabled', async () => {
    localStorage.setItem('pb.colorblind', '1');
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Try an example' }));
    // The example is a lazy chunk that parses ~1.6 MB of route text; on a
    // loaded machine that outlasts waitFor's 1 s default (seen at load 100+).
    // The beforeAll preload below removes the transform from the timing, and
    // the generous timeout stays as belt-and-braces (PR #265 raised it for
    // the same root cause).
    await waitFor(() => expect(document.querySelector('.band-dot')).not.toBeNull(), { timeout: 20000 });
    expect(firstDotColor()).toMatch(/#0072b2|rgb\(0, 114, 178\)/);
  }, 30000);

  it('Save in the embedded panel applies the palette in a plain browser shell', async () => {
    render(<App />);
    dropFiles([file('ghostauto/straight_run.ghostauto')]);
    await waitFor(() => expect(document.querySelector('.band-dot')).not.toBeNull());
    expect(firstDotColor()).toMatch(/#c5a16a|rgb\(197, 161, 106\)/);
    fireEvent.click(screen.getByRole('button', { name: 'Preferences' }));
    const box = await screen.findByRole('checkbox', { name: 'Colorblind palette' });
    fireEvent.click(box);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(firstDotColor()).toMatch(/#0072b2|rgb\(0, 114, 178\)/));
  });
});
