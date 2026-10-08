import { describe, expect, it } from 'vitest';
import {
  autoResolveConflicts,
  deserializeSession,
  REBUILT_2026,
  detectCollisions,
  detectFieldBounds,
  samplePoseAt,
  sequenceEventTimes,
  serializeSession,
  sessionDuration,
} from '@pathblender/core';
import { createWelcomeExample } from '../src/welcome-example';
import { isExampleRobot } from '../src/example-robot';
import { routeName, sameRouteTrajectory } from '../src/route-library';

// The bundled Choreo exports, in natural filename order (see
// assets/welcome-example/<dir>/). The three robots are the team's real
// 2026 machines: the season-long 11019, the post-season 8814, and the
// Houston-built 11019 Champs (now dismantled) — every route annotated
// with that machine's own event vocabulary.
const ROUTES_11019 = [
  'L1', 'L2', 'L3', 'L4', 'L5', 'L6', 'L7', 'L8', 'L9',
  'L10', 'L11', 'L12', 'L13', 'L14', 'L15',
  'M1', 'M2', 'M3', 'M4', 'M5',
];
const ROUTES_8814 = [
  'FCeSt', 'LCeP', 'LCeS', 'LCP', 'LCS', 'LCsS',
  'MSm', 'PCeP', 'PCeR', 'SCsS', 'SmR', 'SR', 'StR',
];
const ROUTES_CHAMPS = [
  'L1', 'L2', 'L3', 'L4', 'L5', 'L6', 'L7', 'L8', 'L9',
  'L10', 'L11', 'L12', 'L13', 'M1', 'M2', 'M3', 'M4', 'M5',
];

describe('welcome example', () => {
  it('is the team’s three real robots, in display order, all on the blue alliance', () => {
    const { robots } = createWelcomeExample();
    expect(robots).toHaveLength(3);
    expect(robots.map((r) => r.trajectory.teamNumber)).toEqual(['11019', '8814', '11019']);
    // You only ever hold path data for your own side — no red robots here.
    expect(robots.every((r) => r.trajectory.alliance === 'blue')).toBe(true);
    expect(robots.map((r) => r.routeOptions?.length)).toEqual([20, 13, 18]);
    expect(robots.map((r) => r.trajectory.displayName)).toEqual([undefined, undefined, '11019 Champs']);
    // Route names mirror the bundled file names one to one, naturally sorted.
    expect(robots[0]!.routeOptions!.map(routeName)).toEqual(ROUTES_11019);
    expect(robots[1]!.routeOptions!.map(routeName)).toEqual(ROUTES_8814);
    expect(robots[2]!.routeOptions!.map(routeName)).toEqual(ROUTES_CHAMPS);
  });

  it('keeps the demo-robot contract: stable welcome-example ids and no routeId', () => {
    const { robots } = createWelcomeExample();
    expect(robots.map((r) => r.trajectory.id)).toEqual(['welcome-example-a', 'welcome-example-b', 'welcome-example-c']);
    expect(robots.every((r) => r.routeId === undefined)).toBe(true);
    expect(robots.every(isExampleRobot)).toBe(true);
  });

  it('opens each robot on its first naturally sorted route, like a folder import', () => {
    const { robots } = createWelcomeExample();
    expect(robots.map((r) => r.trajectory.name)).toEqual(['L1', 'FCeSt', 'L1']);
    for (const robot of robots) {
      expect(robot.trajectory.samples).toEqual(robot.routeOptions![0]!.trajectory.samples);
    }
  });

  it('carries the Champs display name on every library route, so switches never drop it', () => {
    const { robots } = createWelcomeExample();
    const champs = robots[2]!;
    expect(champs.trajectory.displayName).toBe('11019 Champs');
    for (const option of champs.routeOptions!) {
      expect(option.trajectory.displayName).toBe('11019 Champs');
    }
    // The other two robots badge their bare team numbers.
    expect(robots[0]!.trajectory.displayName).toBeUndefined();
    expect(robots[1]!.trajectory.displayName).toBeUndefined();
  });

  it('parses every bundled route cleanly: ordered finite samples, file geometry, no warnings', () => {
    const { robots } = createWelcomeExample();
    for (const robot of robots) {
      for (const option of robot.routeOptions!) {
        const traj = option.trajectory;
        expect(traj.name).toBe(routeName(option));
        expect(traj.samples.length).toBeGreaterThan(1);
        expect(traj.warnings).toEqual([]);
        expect(traj.geometrySource).toBe('file');
        expect(traj.geometry.lengthM).toBeGreaterThan(0);
        expect(traj.geometry.widthM).toBeGreaterThan(0);
        // Folder names carry the team number (11019-champs derives 11019).
        expect(traj.teamNumber).toBe(robot.trajectory.teamNumber);
        for (let i = 0; i < traj.samples.length; i++) {
          const sample = traj.samples[i]!;
          expect(Object.values(sample).every(Number.isFinite)).toBe(true);
          if (i > 0) expect(sample.t).toBeGreaterThan(traj.samples[i - 1]!.t);
        }
      }
    }
  });

  it('lights up event annotations on every route except the confirmed action-free ones', () => {
    const { robots } = createWelcomeExample();
    const zeroAction = new Set(['8814/SmR', '11019/L15']);
    for (const robot of robots) {
      for (const option of robot.routeOptions!) {
        const key = `${robot.trajectory.teamNumber === '11019' && robot.trajectory.displayName ? 'champs' : robot.trajectory.teamNumber === '8814' ? '8814' : '11019'}/${routeName(option)}`;
        const events = option.trajectory.events;
        if (zeroAction.has(key)) {
          expect(events, `${key} should carry no annotations`).toEqual([]);
        } else {
          expect(events.length, `${key} should be annotated`).toBeGreaterThan(0);
          for (const event of events) {
            expect(event.name).toMatch(/^[a-z][a-z_]*$/); // the frozen vocabulary form
          }
        }
      }
    }
    // Opening routes demonstrate all three vocabularies from t=0.
    expect(sequenceEventTimes(robots[0]!).map((e) => e.name)).toEqual(['intake', 'pass', 'align']);
    expect(sequenceEventTimes(robots[1]!).map((e) => e.name)).toEqual(['intake', 'close_blocker', 'half_open_blocker', 'shoot']);
    expect(sequenceEventTimes(robots[2]!).map((e) => e.name)).toEqual(['intake', 'deploy_extension', 'pre_aim']);
  });

  it('shows three genuine collisions: every pair opens from the same start pose', () => {
    const { robots } = createWelcomeExample();
    const conflicts = detectCollisions(robots);
    expect(conflicts).toHaveLength(3);
    expect(conflicts.every((c) => c.startT === 0)).toBe(true);
    // No start delay untangles robots parked on the same spot — the
    // example teaches moving a start, not delaying it.
    expect(detectCollisions(autoResolveConflicts(robots))).toHaveLength(3);
    // All three opening routes begin with a bumper hair over the line (real
    // Choreo data, millimetre-level) — inside BOUNDS_TOLERANCE_M
    // (2026-10-04), so the boundary check reports nothing.
    expect(detectFieldBounds(robots, REBUILT_2026)).toHaveLength(0);
  });

  it('creates every example fresh: calls are equal and edits never leak across', () => {
    const first = createWelcomeExample();
    const second = createWelcomeExample();
    expect(first).toEqual(second);
    first.robots[0]!.startDelayS = 5;
    first.robots[0]!.trajectory.samples[0]!.x = -1;
    first.robots[0]!.routeOptions![1]!.trajectory.samples[0]!.x = -1;
    expect(second).toEqual(createWelcomeExample());
  });

  it('round-trips through the saved-session format with routes, ids, names and collisions', () => {
    const example = createWelcomeExample();
    const restored = deserializeSession(serializeSession(example.robots, 'rebuilt-2026'));
    expect(restored.robots).toHaveLength(3);
    expect(restored.robots.map((r) => r.trajectory.id)).toEqual(['welcome-example-a', 'welcome-example-b', 'welcome-example-c']);
    expect(restored.robots.map((r) => r.routeOptions?.length)).toEqual([20, 13, 18]);
    expect(restored.robots.map((r) => r.trajectory.displayName)).toEqual([undefined, undefined, '11019 Champs']);
    expect(restored.robots.every(isExampleRobot)).toBe(true);
    expect(detectCollisions(restored.robots)).toHaveLength(3);
    // Save/load breaks shared object references; the picker's current-route
    // match still recognizes each robot's route among its options.
    for (const robot of restored.robots) {
      expect(robot.routeOptions!.some((option) => sameRouteTrajectory(option.trajectory, robot.trajectory))).toBe(true);
    }
    expect(sessionDuration(restored.robots)).toBe(sessionDuration(example.robots));
    for (let i = 0; i < restored.robots.length; i++) {
      const original = example.robots[i]!;
      const back = restored.robots[i]!;
      expect(back.trajectory.samples).toEqual(original.trajectory.samples);
      for (const t of [0, 1, 2, 3]) expect(samplePoseAt(back, t)).toEqual(samplePoseAt(original, t));
    }
  });
});
