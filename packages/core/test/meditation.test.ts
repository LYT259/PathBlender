/**
 * Meditation editing + derived-copy exports (report v1.4 §6.3).
 * The export tests are the local half of the interop regression: every
 * export must re-import through our own parsers with the edited values
 * intact (the original-tool GUI check rides the release checklist).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  addPpWaypoint,
  adjustedName,
  exportGhostAuto,
  exportPathPlannerPath,
  exportTraj,
  moveChoreoWaypoint,
  movePpWaypoint,
  reparameterize,
  removePpWaypoint,
} from '../src';
import { parseGhostAuto } from '../src/parsers/ghostauto';
import { parseTraj } from '../src/parsers/traj';
import { parsePathFile } from '../src/parsers';

const read = (rel: string): string =>
  readFileSync(resolve(__dirname, '../../../samples', rel), 'utf-8');

describe('PathPlanner waypoint meditation', () => {
  it('moving an anchor reparameterizes through the ported generator', () => {
    const traj = parsePathFile(read('pathplanner/Pickup.path'), 'Pickup.path');
    const endBefore = traj.samples[traj.samples.length - 1]!;
    const moved = reparameterize(
      movePpWaypoint(traj, 1, { anchor: { x: 7.5, y: 2.8 } }),
    );
    expect(moved.editable?.kind).toBe('pathplanner');
    const wp = (moved.editable as { path: { waypoints: { anchor: { x: number } }[] } })
      .path.waypoints[1]!;
    expect(wp.anchor.x).toBeCloseTo(7.5, 9);
    const endAfter = moved.samples[moved.samples.length - 1]!;
    expect(endAfter.x).toBeCloseTo(7.5, 1);
    expect(endBefore.x).not.toBeCloseTo(7.5, 1);
  });

  it('add/remove waypoints keep ≥2 and regenerate', () => {
    const traj = parsePathFile(read('pathplanner/Pickup.path'), 'Pickup.path');
    const added = addPpWaypoint(traj, 0);
    expect(
      (added.editable as { path: { waypoints: unknown[] } }).path.waypoints,
    ).toHaveLength(3);
    const regenerated = reparameterize(added);
    expect(regenerated.samples.length).toBeGreaterThan(2);

    const removed = removePpWaypoint(added, 1);
    expect(
      (removed.editable as { path: { waypoints: unknown[] } }).path.waypoints,
    ).toHaveLength(2);
    // Removing below 2 is a no-op.
    const floor = removePpWaypoint(removed, 0);
    expect(
      (floor.editable as { path: { waypoints: unknown[] } }).path.waypoints,
    ).toHaveLength(2);
  });

  it('export → re-import round-trips the edited waypoints', () => {
    const traj = parsePathFile(read('pathplanner/Pickup.path'), 'Pickup.path');
    const moved = reparameterize(
      movePpWaypoint(traj, 1, { anchor: { x: 6.0, y: 3.0 } }),
    );
    const json = exportPathPlannerPath(moved);
    const back = parsePathFile(json, 'Pickup-adjusted.path');
    expect(back.name).toBe('Pickup-adjusted');
    expect(back.editable?.kind).toBe('pathplanner');
    const wp = (back.editable as { path: { waypoints: { anchor: { x: number; y: number } }[] } })
      .path.waypoints[1]!;
    expect(wp.anchor.x).toBeCloseTo(6.0, 6);
    expect(wp.anchor.y).toBeCloseTo(3.0, 6);
    expect(back.samples.length).toBeGreaterThan(5);
  });

  it('.path export throws for non-PathPlanner trajectories', () => {
    const traj = parseTraj(read('traj/v3_swerve.traj'), 's.traj');
    expect(() => exportPathPlannerPath(traj)).toThrow(/no editable PathPlanner/);
  });
});

describe('Choreo waypoint meditation', () => {
  it('remaps geometry, keeps timing, and warns', () => {
    const traj = parseTraj(read('traj/v3_swerve.traj'), 'v3.traj');
    const times = traj.samples.map((s) => s.t);
    const moved = reparameterize(
      moveChoreoWaypoint(traj, 1, { x: 5.5, y: 0.5 }),
    );
    expect(moved.samples.map((s) => s.t)).toEqual(times);
    expect(moved.warnings.some((w) => w.includes('original timing'))).toBe(true);
    const e = moved.editable as { waypoints: { x: number; y: number }[] };
    expect(e.waypoints[1]!.x).toBeCloseTo(5.5, 9);
    // Start/end waypoints are untouched by a middle move.
    expect(moved.samples[0]!.x).toBeCloseTo(traj.samples[0]!.x, 6);
  });

  it('export → re-import round-trips the edited waypoints', () => {
    const traj = parseTraj(read('traj/v3_swerve.traj'), 'v3.traj');
    const moved = reparameterize(
      moveChoreoWaypoint(traj, 1, { x: 5.5, y: 0.5 }),
    );
    const json = exportTraj(moved);
    const back = parseTraj(json, 'back.traj');
    const e = back.editable as { waypoints: { x: number; y: number }[] };
    expect(e.waypoints[1]!.x).toBeCloseTo(5.5, 6);
    expect(e.waypoints[1]!.y).toBeCloseTo(0.5, 6);
    expect(back.samples.length).toBe(moved.samples.length);
  });
});

describe('ghostauto export', () => {
  it('round-trips states, geometry, and team metadata', () => {
    const traj = parseGhostAuto(read('ghostauto/straight_run.ghostauto'), 's.ghostauto');
    const json = exportGhostAuto(traj);
    const back = parseGhostAuto(json, 'back.ghostauto');
    expect(back.name).toBe('Straight Run-adjusted');
    expect(back.teamName).toBe(traj.teamName);
    expect(back.teamNumber).toBe(traj.teamNumber);
    expect(back.geometry.lengthM).toBeCloseTo(traj.geometry.lengthM, 9);
    expect(back.samples.length).toBe(traj.samples.length);
    expect(back.samples[3]!.x).toBeCloseTo(traj.samples[3]!.x, 3);
  });
});

describe('adjustedName', () => {
  it('appends once', () => {
    expect(adjustedName('Pickup')).toBe('Pickup-adjusted');
    expect(adjustedName('Pickup-adjusted')).toBe('Pickup-adjusted');
  });
});
