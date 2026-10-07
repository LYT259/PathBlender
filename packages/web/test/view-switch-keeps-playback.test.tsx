/**
 * A running playback must survive a view switch (user request 2026-10-06):
 * switching alliance, 2D ⇄ 3D, the season (including an older one), the
 * schematic ⇄ rendered artwork, or a team's left/right mirror used to stop
 * the clock — alliance and mirror called setPlaying(false) outright, and the
 * rest are asserted here so no future view toggle can quietly re-add one.
 * What stays running is the SAME playhead, not a restart from 0.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionTrajectory } from '@pathblender/core';
import { App } from '../src/App';

vi.mock('../src/components/FieldCanvas', async () => {
  const { forwardRef } = await import('react');
  return { FieldCanvas: forwardRef((_props: { robots: SessionTrajectory[] }, _ref) => <div data-testid="field-2d" />) };
});
vi.mock('../src/components/FieldCanvas3D', async () => {
  const { forwardRef } = await import('react');
  return { FieldCanvas3D: forwardRef((_props: { robots: SessionTrajectory[] }, _ref) => <div data-testid="field-3d" />) };
});

const raw = readFileSync(resolve(__dirname, '../../../samples/ghostauto/straight_run.ghostauto'), 'utf8');

// Deterministic clock: the transport loop reads the timestamp its rAF
// callback is handed, so frames are pumped by hand and never depend on the
// machine this test runs on.
let now = 0;
let callbacks = new Map<number, FrameRequestCallback>();
const pump = (wallMs: number, frameMs = 1000 / 60) => {
  for (let elapsed = 0; elapsed < wallMs; elapsed += frameMs) {
    now += frameMs;
    const batch = [...callbacks.values()];
    callbacks.clear();
    act(() => { for (const cb of batch) cb(now); });
  }
};

const keep3D = () => document.querySelector(".canvas-3d-keep") as HTMLElement | null;
const playing = () => screen.queryByRole('button', { name: 'Pause', exact: true }) !== null;
const clockT = () => Number.parseFloat(screen.getByText(/\d+\.\d\d\s*\/\s*\d+\.\d\d\s*s/).textContent!.trim());

/** Import → press play → let it run a little. Returns the playhead read. */
async function bootPlaying() {
  render(<App />);
  fireEvent.drop(window, { dataTransfer: { files: [new File([raw], 'A.ghostauto')] } });
  await waitFor(() => expect(screen.getByTestId('field-2d')).toBeInTheDocument());
  fireEvent.click(screen.getByRole('button', { name: 'Play', exact: true }));
  pump(300);
  expect(playing()).toBe(true);
  return clockT();
}

beforeEach(() => {
  localStorage.clear();
  now = 0;
  callbacks = new Map();
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    const id = callbacks.size + 1;
    callbacks.set(id, cb);
    return id;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => { callbacks.delete(id); });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

const cases: Array<[string, () => void]> = [
  ['blue ⇄ red alliance', () => {
    fireEvent.click(within(screen.getByRole('group', { name: 'alliance' })).getByRole('button', { name: 'Red' }));
    fireEvent.click(within(screen.getByRole('group', { name: 'alliance' })).getByRole('button', { name: 'Blue' }));
  }],
  ['2D → 3D', () => {
    fireEvent.click(screen.getByRole('button', { name: '3D', exact: true }));
    expect(keep3D()).not.toHaveAttribute('hidden');
  }],
  ['3D → 2D', () => {
    fireEvent.click(screen.getByRole('button', { name: '3D', exact: true }));
    expect(keep3D()).not.toHaveAttribute('hidden');
    fireEvent.click(screen.getByRole('button', { name: '2D', exact: true }));
    expect(keep3D()).toHaveAttribute('hidden');
  }],
  ['another season', () => {
    fireEvent.change(screen.getByRole('combobox', { name: 'Game season' }), { target: { value: 'chargedup-2023' } });
  }],
  ['an older season', () => {
    fireEvent.change(screen.getByRole('combobox', { name: 'Game season' }), { target: { value: 'rapidreact-2022' } });
  }],
  ['schematic → rendered artwork', () => {
    fireEvent.click(within(screen.getByRole('group', { name: 'Field artwork style (schematic vs rendered)' })).getByRole('button', { name: 'Rendered' }));
  }],
  ['rendered → schematic artwork', () => {
    const group = () => within(screen.getByRole('group', { name: 'Field artwork style (schematic vs rendered)' }));
    fireEvent.click(group().getByRole('button', { name: 'Rendered' }));
    fireEvent.click(group().getByRole('button', { name: 'Schematic' }));
  }],
  ['field construction (welded ⇄ AndyMark)', () => {
    const group = within(screen.getByRole('group', { name: /Field construction/ }));
    fireEvent.click(group.getByRole('button', { name: 'AndyMark' }));
    fireEvent.click(group.getByRole('button', { name: 'Welded' }));
  }],
  ['occupancy heatmap on and off', () => {
    const group = within(screen.getByRole('group', { name: 'Overlays' }));
    const box = group.getByRole('button', { name: 'Heatmap' });
    fireEvent.click(box);
    expect(box).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(box);
    expect(box).toHaveAttribute('aria-pressed', 'true');
  }],
  ['mirroring a team on and off', () => {
    const mirror = document.querySelector('.robot-mirror-button') as HTMLButtonElement;
    fireEvent.click(mirror);
    expect(mirror).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(mirror);
    expect(mirror).toHaveAttribute('aria-pressed', 'false');
  }],
];

describe('view switches during playback', () => {
  it.each(cases)('keeps playing from the same playhead through %s', async (_name, run) => {
    const before = await bootPlaying();
    await run();
    pump(300);
    expect(playing(), `${_name} stopped the transport`).toBe(true);
    const after = clockT();
    // The clock moved on past the switch instead of restarting or freezing.
    expect(after).toBeGreaterThan(before);
    expect(after).toBeLessThan(before + 1.2);
  });
});
