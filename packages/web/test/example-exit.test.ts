import { describe, expect, it } from 'vitest';
import { deserializeSession, serializeSession } from '@pathblender/core';
import { createWelcomeExample } from '../src/welcome-example';
import { isExampleRobot, refreshExampleRobots } from '../src/example-robot';

describe('isExampleRobot (End-example affordance)', () => {
  it('recognizes fresh demo robots', () => {
    const { robots } = createWelcomeExample();
    expect(robots).toHaveLength(3);
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

describe('refreshExampleRobots (stale-example swap on restore, 2026-10-04)', () => {
  it('replaces current-generation demo robots with a fresh example set', () => {
    const { robots } = createWelcomeExample();
    // A stale copy from an older build: same stable ids, old identity/routes.
    const stale = robots.map((r, i) => ({
      ...r,
      routeOptions: [],
      trajectory: { ...r.trajectory, teamNumber: `000${i + 1}` },
    }));
    const out = refreshExampleRobots(stale, createWelcomeExample().robots);
    expect(out.map((r) => r.trajectory.teamNumber)).toEqual(['11019', '8814', '11019']);
    expect(out.map((r) => r.routeOptions?.length)).toEqual([20, 13, 18]);
    expect(out.every(isExampleRobot)).toBe(true);
  });

  it('keeps what the user decided on a refreshed example robot', () => {
    const { robots } = createWelcomeExample();
    const edited: typeof robots = robots.map((r, i) => ({
      ...r,
      // A stale trajectory under a still-current id: this is what must refresh.
      trajectory: { ...r.trajectory, teamNumber: `000${i + 1}` },
      visible: i !== 0,
      color: '#123456',
      startDelayS: 2.5,
      mirrored: true,
      profileId: r.profileOptions?.[0]?.id ?? r.profileId,
      sequence: r.sequence,
    }));
    const out = refreshExampleRobots(edited, createWelcomeExample().robots);
    // Demo payload refreshed...
    expect(out.map((r) => r.trajectory.teamNumber)).toEqual(['11019', '8814', '11019']);
    expect(out.map((r) => r.routeOptions?.length)).toEqual([20, 13, 18]);
    // ...the user's own state carried over (user report 2026-10-06: a hidden
    // example robot came back visible after a relaunch).
    expect(out.map((r) => r.visible)).toEqual([false, true, true]);
    expect(out.every((r) => r.color === '#123456')).toBe(true);
    expect(out.every((r) => r.startDelayS === 2.5)).toBe(true);
    expect(out.every((r) => r.mirrored === true)).toBe(true);
  });

  it('matches the pre-rename generation (0001/0002) by example ordinal', () => {
    const { robots } = createWelcomeExample();
    const legacy = robots.map((r, i) => ({
      ...r,
      trajectory: {
        ...r.trajectory,
        id: crypto.randomUUID(),
        name: i === 0 ? '示例路径 A' : 'Example path B',
        teamNumber: `000${i + 1}`,
      },
    }));
    const out = refreshExampleRobots(legacy, createWelcomeExample().robots);
    expect(out.map((r) => r.trajectory.teamNumber)).toEqual(['11019', '8814', '11019']);
    expect(out.map((r) => r.routeOptions?.length)).toEqual([20, 13, 18]);
    expect(out.every(isExampleRobot)).toBe(true);
  });

  it('swaps only the example robot in a mixed session', () => {
    const { robots } = createWelcomeExample();
    const legacyExample = {
      ...robots[0]!,
      trajectory: { ...robots[0]!.trajectory, id: crypto.randomUUID(), name: '示例路径 A', teamNumber: '0001' },
    };
    // Adopted robot (routeId set): user work, never touched.
    const mine = {
      ...robots[1]!,
      routeId: 'route-1',
      trajectory: { ...robots[1]!.trajectory, id: 'my-robot', teamNumber: '1234' },
    };
    const out = refreshExampleRobots([legacyExample, mine], createWelcomeExample().robots);
    expect(out).toHaveLength(2);
    expect(out[0]!.trajectory.teamNumber).toBe('11019');
    expect(out[1]).toBe(mine);
  });

  it('leaves surplus stale robots untouched rather than dropping them', () => {
    const { robots } = createWelcomeExample();
    const third = {
      ...robots[0]!,
      trajectory: { ...robots[0]!.trajectory, id: crypto.randomUUID(), name: 'Example path B', teamNumber: '0003' },
    };
    const out = refreshExampleRobots([...robots, third], createWelcomeExample().robots);
    expect(out).toHaveLength(4);
    expect(out[3]).toBe(third);
  });
});
