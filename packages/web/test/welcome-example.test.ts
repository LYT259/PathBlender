import { describe, expect, it } from 'vitest';
import {
  autoResolveConflicts,
  deserializeSession,
  REBUILT_2026,
  detectCollisions,
  detectFieldBounds,
  samplePoseAt,
  serializeSession,
  sessionDuration,
} from '@pathblender/core';
import { createWelcomeExample } from '../src/welcome-example';
import { isExampleRobot } from '../src/example-robot';
import { routeName, sameRouteTrajectory } from '../src/route-library';

// The bundled Choreo exports, in natural filename order (see
// assets/welcome-example/<team>/). L16 and Test1 exist only on the 8814 side.
const ROUTES_8814 = [
  'L1', 'L2', 'L3', 'L4', 'L5', 'L6', 'L7', 'L8', 'L9',
  'L10', 'L11', 'L12', 'L13', 'L14', 'L15', 'L16',
  'M1', 'M2', 'M3', 'M4', 'M5', 'Test1',
];
const ROUTES_11019 = [
  'L1', 'L2', 'L3', 'L4', 'L5', 'L6', 'L7', 'L8', 'L9',
  'L10', 'L11', 'L12', 'L13', 'L14', 'L15',
  'M1', 'M2', 'M3', 'M4', 'M5',
];

describe('welcome example', () => {
  it('is two real FRC teams: 8814 with its 22 routes and 11019 with its 20', () => {
    const { robots } = createWelcomeExample();
    expect(robots).toHaveLength(2);
    expect(robots.map((r) => r.trajectory.teamNumber)).toEqual(['8814', '11019']);
    expect(robots.map((r) => r.routeOptions?.length)).toEqual([22, 20]);
    // Route names mirror the bundled file names one to one, naturally sorted.
    expect(robots[0]!.routeOptions!.map(routeName)).toEqual(ROUTES_8814);
    expect(robots[1]!.routeOptions!.map(routeName)).toEqual(ROUTES_11019);
    expect(ROUTES_11019).not.toContain('L16');
    expect(ROUTES_11019).not.toContain('Test1');
  });

  it('keeps the demo-robot contract: stable welcome-example ids and no routeId', () => {
    const { robots } = createWelcomeExample();
    expect(robots.map((r) => r.trajectory.id)).toEqual(['welcome-example-a', 'welcome-example-b']);
    expect(robots.every((r) => r.routeId === undefined)).toBe(true);
    expect(robots.every(isExampleRobot)).toBe(true);
  });

  it('opens each team on its first naturally sorted route, like a folder import', () => {
    const { robots } = createWelcomeExample();
    expect(robots.map((r) => r.trajectory.name)).toEqual(['L1', 'L1']);
    for (const robot of robots) {
      expect(robot.trajectory.samples).toEqual(robot.routeOptions![0]!.trajectory.samples);
    }
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
        expect(traj.teamNumber).toBe(robot.trajectory.teamNumber);
        for (let i = 0; i < traj.samples.length; i++) {
          const sample = traj.samples[i]!;
          expect(Object.values(sample).every(Number.isFinite)).toBe(true);
          if (i > 0) expect(sample.t).toBeGreaterThan(traj.samples[i - 1]!.t);
        }
      }
    }
  });

  it('shows one genuine collision: both teams open their L1 from the same start pose', () => {
    const { robots } = createWelcomeExample();
    const conflicts = detectCollisions(robots);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]!.startT).toBe(0);
    // No start delay untangles two robots parked on the same spot — the
    // example teaches moving a start, not delaying it.
    expect(detectCollisions(autoResolveConflicts(robots))).toHaveLength(1);
    // Both autos begin with a bumper hair over the line (real Choreo data).
    const bounds = detectFieldBounds(robots, REBUILT_2026);
    expect(bounds).toHaveLength(2);
    for (const issue of bounds) expect(issue.maxPenetrationM).toBeLessThan(0.005);
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

  it('round-trips through the saved-session format with routes, ids and the same collision', () => {
    const example = createWelcomeExample();
    const restored = deserializeSession(serializeSession(example.robots, 'rebuilt-2026'));
    expect(restored.robots).toHaveLength(2);
    expect(restored.robots.map((r) => r.trajectory.id)).toEqual(['welcome-example-a', 'welcome-example-b']);
    expect(restored.robots.map((r) => r.routeOptions?.length)).toEqual([22, 20]);
    expect(restored.robots.every(isExampleRobot)).toBe(true);
    expect(detectCollisions(restored.robots)).toHaveLength(1);
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
