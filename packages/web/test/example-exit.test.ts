import { describe, expect, it } from 'vitest';
import { deserializeSession, serializeSession } from '@pathblender/core';
import { createWelcomeExample } from '../src/welcome-example';
import { isExampleRobot } from '../src/example-robot';

describe('isExampleRobot (End-example affordance)', () => {
  it('recognizes fresh demo robots', () => {
    const { robots } = createWelcomeExample();
    expect(robots).toHaveLength(2);
    expect(robots.every(isExampleRobot)).toBe(true);
  });

  it('keeps recognizing the demo after a session save/load round-trip', () => {
    const { robots } = createWelcomeExample();
    const restored = deserializeSession(serializeSession(robots, 'rebuilt-2026'));
    expect(restored.robots.map((r) => r.trajectory.id)).toEqual(
      robots.map((r) => r.trajectory.id),
    );
    expect(restored.robots.every(isExampleRobot)).toBe(true);
  });

  it('recognizes pre-rename demos that only carry legacy localized names', () => {
    const { robots } = createWelcomeExample();
    // A demo autosaved before the 2026-10-03 rename: localized legacy name,
    // no team number, and a fresh random id after the restore.
    const legacy = robots.map((r, i) => ({
      ...r,
      trajectory: {
        ...r.trajectory,
        id: crypto.randomUUID(),
        name: i === 0 ? '示例路径 A' : 'Example path B',
        teamNumber: '',
      },
    }));
    expect(legacy.every(isExampleRobot)).toBe(true);
  });

  it('never treats the user\'s own robots as demo robots', () => {
    const { robots } = createWelcomeExample();
    const adopted = { ...robots[0]!, routeId: 'route-1' };
    expect(isExampleRobot(adopted)).toBe(false);
    const realSameName = {
      ...robots[0]!,
      routeId: 'route-1',
      trajectory: { ...robots[0]!.trajectory, id: crypto.randomUUID() },
    };
    expect(isExampleRobot(realSameName)).toBe(false);
  });
});
