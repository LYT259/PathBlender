import { describe, expect, it } from 'vitest';
import {
  autoResolveConflicts,
  deserializeSession,
  REBUILT_2026,
  detectCollisions,
  detectFieldBounds,
  fieldById,
  samplePoseAt,
  serializeSession,
  sessionDuration,
} from '@pathblender/core';
import { createWelcomeExample } from '../src/welcome-example';

const names = { a: 'Example A', b: 'Example B' };

describe('welcome example', () => {
  it('demonstrates one genuine collision that a start delay can resolve, without leaving the field', () => {
    const { robots } = createWelcomeExample(names);
    const field = REBUILT_2026; // routes are field-agnostic; verify on the default field
    const conflicts = detectCollisions(robots);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]!.startT).toBeGreaterThan(0);
    expect(conflicts[0]!.closestT).toBeCloseTo(10, 2);
    expect(conflicts[0]!.endT).toBeLessThan(sessionDuration(robots));
    expect(detectFieldBounds(robots, field)).toEqual([]);
    const adjusted = autoResolveConflicts(robots);
    expect(detectCollisions(adjusted)).toEqual([]);
    expect(detectFieldBounds(adjusted, field)).toEqual([]);
  });

  it('has finite, ordered samples, explicit geometry, and a twenty-second playback', () => {
    const { robots } = createWelcomeExample(names);
    expect(sessionDuration(robots)).toBe(20);
    expect(robots).toHaveLength(2);
    for (const { trajectory, startDelayS, visible } of robots) {
      expect(trajectory.teamName).toBe('');
      // Demo robots carry plain team numbers on the bumper (user request
      // 2026-10-03): 00001 / 00002 instead of "示例路径 A/B".
      expect(['00001', '00002']).toContain(trajectory.teamNumber);
      expect(trajectory.geometrySource).toBe('file');
      expect(trajectory.geometry.lengthM).toBe(0.8);
      expect(trajectory.geometry.widthM).toBe(0.8);
      expect(trajectory.warnings).toEqual([]);
      expect(startDelayS).toBe(0);
      expect(visible).toBe(true);
      expect(trajectory.samples[0]!.t).toBe(0);
      expect(trajectory.samples.at(-1)!.t).toBe(20);
      for (let i = 0; i < trajectory.samples.length; i++) {
        const sample = trajectory.samples[i]!;
        expect(Object.values(sample).every(Number.isFinite)).toBe(true);
        if (i > 0) expect(sample.t).toBeGreaterThan(trajectory.samples[i - 1]!.t);
      }
      for (const sample of [trajectory.samples[0]!, trajectory.samples.at(-1)!]) {
        expect(sample.vx).toBe(0);
        expect(sample.vy).toBe(0);
      }
    }
  });

  it('uses unique deterministic ids and keeps every new example independent of edits', () => {
    const first = createWelcomeExample(names);
    const second = createWelcomeExample(names);
    expect(first).toEqual(second);
    const ids = first.robots.map((robot) => robot.trajectory.id);
    expect(new Set(ids).size).toBe(2);
    expect(ids.every((id) => id.startsWith('welcome-example-'))).toBe(true);
    first.robots[0]!.startDelayS = 5;
    first.robots[0]!.trajectory.samples[0]!.x = -1;
    first.robots[0]!.trajectory.geometry.lengthM = 1.2;
    first.robots[0]!.trajectory.events.push({ name: 'edited', t: 0 });
    first.robots[0]!.trajectory.moduleLocations.push({ x: 1, y: 1 });
    first.robots[0]!.trajectory.warnings.push('edited');
    expect(second).toEqual(createWelcomeExample(names));
    expect(first.robots[1]).toEqual(second.robots[1]);
    expect(createWelcomeExample({ a: '示例 A', b: '示例 B' }).robots.map((r) => r.trajectory.name))
      .toEqual(['示例 A', '示例 B']);
  });

  it('round-trips through the normal saved-session format with the same playback and collision', () => {
    const example = createWelcomeExample(names);
    const restored = deserializeSession(serializeSession(example.robots, example.fieldId));
    expect(restored.fieldId).toBe(example.fieldId);
    expect(restored.robots).toHaveLength(2);
    expect(sessionDuration(restored.robots)).toBe(20);
    expect(detectCollisions(restored.robots)).toHaveLength(1);
    expect(detectFieldBounds(restored.robots, fieldById(restored.fieldId))).toEqual([]);
    for (let i = 0; i < restored.robots.length; i++) {
      const original = example.robots[i]!;
      const back = restored.robots[i]!;
      expect(back.trajectory.name).toBe(original.trajectory.name);
      expect(back.trajectory.geometry).toEqual(original.trajectory.geometry);
      expect(back.trajectory.geometrySource).toBe('file');
      expect(back.trajectory.samples).toEqual(original.trajectory.samples);
      for (const t of [0, 5, 10, 15, 20]) expect(samplePoseAt(back, t)).toEqual(samplePoseAt(original, t));
    }
  });
});
