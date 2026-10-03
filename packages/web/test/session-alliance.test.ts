import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { deserializeSession, detectCollisions, fieldById, makeCustomField, makeSession, parsePathFile, REBUILT_2026, serializeSession } from '@pathblender/core';
import { robotsForAlliance, restoreSessionAlliance } from '../src/session-alliance';

const robot = (name: string) => makeSession(parsePathFile(readFileSync(resolve(__dirname, '../../../samples/ghostauto', name), 'utf8'), name));
const sources = [robot('straight_run.ghostauto'), robot('stop_and_score.ghostauto')];

describe('shared alliance view', () => {
  it('transforms every pose and velocity for every robot without changing source routes or timing', () => {
    const before = structuredClone(sources);
    const red = robotsForAlliance(sources, 'red', REBUILT_2026);
    red.forEach((r, index) => {
      expect(r.trajectory.alliance).toBe('red');
      expect(r.trajectory.id).toBe(sources[index]!.trajectory.id);
      r.trajectory.samples.forEach((s, i) => {
        const p = sources[index]!.trajectory.samples[i]!;
        expect(s.x).toBeCloseTo(REBUILT_2026.lengthM - p.x, 10);
        expect(s.y).toBeCloseTo(REBUILT_2026.widthM - p.y, 10);
        expect(Math.cos(s.heading)).toBeCloseTo(-Math.cos(p.heading), 10);
        expect(Math.sin(s.heading)).toBeCloseTo(-Math.sin(p.heading), 10);
        expect(s.vx).toBe(-p.vx);
        expect(s.vy).toBe(-p.vy);
        expect(s.omega).toBe(p.omega);
        expect(s.t).toBe(p.t);
      });
    });
    expect(sources).toEqual(before);
    expect(robotsForAlliance(sources, 'blue', REBUILT_2026)).toEqual(sources);
    const blueConflicts = detectCollisions(sources);
    const redConflicts = detectCollisions(red);
    expect(redConflicts).toHaveLength(blueConflicts.length);
    redConflicts.forEach((conflict, i) => {
      const original = blueConflicts[i]!;
      expect(conflict.startT).toBe(original.startT);
      expect(conflict.endT).toBe(original.endT);
      expect(conflict.minCenterDistanceM).toBeCloseTo(original.minCenterDistanceM, 10);
      expect(conflict.closestA.x).toBeCloseTo(REBUILT_2026.lengthM - original.closestA.x, 10);
      expect(conflict.closestB.y).toBeCloseTo(REBUILT_2026.widthM - original.closestB.y, 10);
    });
  });

  it('derives red placement from the selected field without accumulating flips', () => {
    for (const field of [REBUILT_2026, fieldById('reefscape-2025'), fieldById('crescendo-2024')]) {
      const red = robotsForAlliance(sources, 'red', field);
      expect(red[0]!.trajectory.samples[0]!.x).toBeCloseTo(field.lengthM - sources[0]!.trajectory.samples[0]!.x, 10);
      expect(robotsForAlliance(sources, 'blue', field)[0]).toBe(sources[0]);
    }
  });

  it('restores red session files without double-flipping and keeps other robot settings', () => {
    const configured = [{ ...sources[0]!, visible: false, startDelayS: 1.5 }, sources[1]!];
    const red = robotsForAlliance(configured, 'red', REBUILT_2026);
    const restored = deserializeSession(serializeSession(red, REBUILT_2026.id));
    const scene = restoreSessionAlliance(restored);
    expect(scene.alliance).toBe('red');
    expect(scene.robots[0]!.visible).toBe(false);
    expect(scene.robots[0]!.startDelayS).toBe(1.5);
    const shown = robotsForAlliance(scene.robots, scene.alliance, REBUILT_2026);
    shown.forEach((r, i) => expect(r.trajectory.samples[0]!.x).toBeCloseTo(red[i]!.trajectory.samples[0]!.x, 10));
  });

  it('uses saved custom-field dimensions when restoring and handles legacy blue and empty sessions', () => {
    const field = makeCustomField({ lengthM: 20, widthM: 10, ppm: 10, marginM: 0, pixelWidth: 200, pixelHeight: 100 });
    const red = robotsForAlliance(sources, 'red', field);
    const scene = restoreSessionAlliance(deserializeSession(serializeSession(red, field.id, field)));
    expect(scene.robots[0]!.trajectory.samples[0]!.x).toBeCloseTo(sources[0]!.trajectory.samples[0]!.x, 10);
    expect(restoreSessionAlliance({ robots: sources, fieldId: REBUILT_2026.id }).alliance).toBe('blue');
    expect(restoreSessionAlliance({ robots: [], fieldId: REBUILT_2026.id })).toEqual({ alliance: 'blue', robots: [] });
  });
});
