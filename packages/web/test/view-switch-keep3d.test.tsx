/**
 * Instant 2D→3D switch (user request 2026-10-06, both rounds): the 3D
 * canvas stays mounted but hidden while 2D shows — so switching never
 * rebuilds the WebGL scene and never shows "loading 3D view…" again. The
 * parked canvas is even PREWARMED: once robots exist (and the season has a
 * model) it mounts hidden on idle and renders one warm frame, so the FIRST
 * 3D click of a session is instant too — the follow-up report was that
 * parking alone still left that first click paying the whole build.
 *
 * Same request: the 3D home camera now points along the ViewCube's
 * top–front edge — 45° elevation over the front face at the unchanged home
 * radius — so the toolbar recenter lands exactly where that cube edge
 * click lands. CAM_HOME is the load-bearing number: asserted here to the
 * milliradian (geometry changes carry no such test, no merge).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { SessionTrajectory } from '@pathblender/core';
import { App } from '../src/App';
import { CAM_HOME, CAM_HOME_R } from '../src/field3d-models';

let mount3D = 0;
vi.mock('../src/components/FieldCanvas', async () => {
  const { forwardRef } = await import('react');
  return { FieldCanvas: forwardRef((_props: { robots: SessionTrajectory[] }, _ref) => <div data-testid="field-2d" />) };
});
vi.mock('../src/components/FieldCanvas3D', async () => {
  const { forwardRef, useEffect } = await import('react');
  return {
    FieldCanvas3D: forwardRef((_props: { robots: SessionTrajectory[] }, _ref) => {
      useEffect(() => { mount3D += 1; }, []);
      return <div data-testid="field-3d" />;
    }),
  };
});

const raw = readFileSync(resolve(__dirname, '../../../samples/ghostauto/straight_run.ghostauto'), 'utf8');
const drop = (files: File[]) => fireEvent.drop(window, { dataTransfer: { files } });
const keep3D = () => document.querySelector('.canvas-3d-keep') as HTMLElement | null;

beforeEach(() => { localStorage.clear(); mount3D = 0; vi.clearAllMocks(); });
afterAll(() => new Promise((resolve) => setTimeout(resolve, 2600)));

describe('parked + prewarmed 3D canvas across 2D/3D switches', () => {
  it('prewarms hidden before the first 3D click, which then never remounts', async () => {
    render(<App />);
    drop([new File([raw], 'A.ghostauto')]);
    await waitFor(() => expect(screen.getByTestId('field-2d')).toBeInTheDocument());
    // Robots just landed: nothing mounted YET — the prewarm is idle-deferred.
    expect(screen.queryByTestId('field-3d')).toBeNull();
    expect(keep3D()).toBeNull();

    // After the idle deferral the canvas mounts hidden (prewarm), so the
    // user's first 3D click has a fully built scene waiting for it.
    await waitFor(() => expect(screen.getByTestId('field-3d')).toBeInTheDocument(), { timeout: 4000 });
    expect(keep3D()).toHaveAttribute('hidden');
    expect(mount3D).toBe(1);

    // The first click reveals the SAME instance — no remount, no fallback.
    fireEvent.click(screen.getByRole('button', { name: '3D', exact: true }));
    expect(keep3D()).not.toHaveAttribute('hidden');
    expect(mount3D).toBe(1);

    // Back to 2D: hidden, not unmounted; the return trip is instant.
    fireEvent.click(screen.getByRole('button', { name: '2D', exact: true }));
    expect(screen.getByTestId('field-2d')).toBeInTheDocument();
    expect(keep3D()).toHaveAttribute('hidden');
    expect(screen.getByTestId('field-3d')).toBeInTheDocument();
    expect(mount3D).toBe(1);
    fireEvent.click(screen.getByRole('button', { name: '3D', exact: true }));
    expect(keep3D()).not.toHaveAttribute('hidden');
    expect(mount3D).toBe(1);
  });

  it('unmounts the parked canvas only for seasons without a 3D model', async () => {
    render(<App />);
    drop([new File([raw], 'A.ghostauto')]);
    await waitFor(() => expect(screen.getByTestId('field-2d')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: '3D', exact: true }));
    await screen.findByTestId('field-3d');
    expect(mount3D).toBe(1);

    // Every season shipped in the picker (2022–2026) has an official model,
    // so only the custom field can take field3dAvailable away; its picker
    // entry opens the custom-field panel instead of switching the scene.
    fireEvent.change(screen.getByRole('combobox', { name: 'Game season' }), { target: { value: 'custom' } });
    expect(keep3D()).not.toBeNull(); // picker change only opened the panel
    expect(mount3D).toBe(1);
  });
});

describe('3D home view = ViewCube top–front edge', () => {
  const r = Math.hypot(CAM_HOME[0], CAM_HOME[1], CAM_HOME[2]);
  it('keeps the R13 home radius', () => {
    expect(CAM_HOME_R).toBeCloseTo(Math.hypot(13.5, 10.5), 9);
    expect(r).toBeCloseTo(CAM_HOME_R, 9);
  });
  it('points 45° over the front face, square to it — the cube edge direction', () => {
    // Azimuth 0: directly over the front face (+Z), no sideways drift.
    expect(CAM_HOME[0]).toBe(0);
    expect(Math.atan2(CAM_HOME[0], CAM_HOME[2])).toBe(0);
    // Equal up/front shares: the top–front edge is exactly 45° elevation.
    expect(CAM_HOME[1]).toBeCloseTo(CAM_HOME[2], 12);
    expect(Math.acos(Math.min(1, CAM_HOME[1] / r))).toBeCloseTo(Math.PI / 4, 9);
  });
});
