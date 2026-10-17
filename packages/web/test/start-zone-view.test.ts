import { describe, expect, it } from 'vitest';
import { makeSession, type FieldPackage, type SessionTrajectory, type Trajectory } from '@pathblender/core';
import { applySequenceSegments } from '../src/auto-sequence-state';
import { dimmedPathRobotIds, previewDimsPath } from '../src/start-zone-view';
import { robotsForAlliance } from '../src/session-alliance';

/** Straight drive from (x,y) over 2 s — only the FIRST sample faces the
 * zone verdict. */
function routeAt(id: string, x: number, y: number): Trajectory {
  return {
    id,
    name: id,
    teamName: 'Team',
    teamNumber: '0000',
    source: 'ghostauto',
    alliance: 'blue',
    samples: [
      { t: 0, x, y, heading: 0, vx: 0, vy: 0, omega: 0 },
      { t: 2, x: x + 2, y, heading: 0, vx: 0, vy: 0, omega: 0 },
    ],
    durationS: 2,
    geometry: { lengthM: 0.9, widthM: 0.9, offsetX: 0, offsetY: 0 },
    geometrySource: 'file',
    moduleLocations: [],
    events: [],
    warnings: [],
  };
}

const zone = [{ xMinM: 0, xMaxM: 1, yMinM: 0, yMaxM: 1 }];

describe('dimmedPathRobotIds', () => {
  it('gates nothing without a starting region', () => {
    const robot = makeSession(routeAt('r', 9, 9));
    expect(dimmedPathRobotIds([robot], undefined)).toEqual(new Set());
  });

  it('dims a legacy robot whose imported route starts outside', () => {
    const legal = makeSession(routeAt('ok', 0.5, 0.5));
    const illegal = makeSession(routeAt('bad', 9, 9));
    expect(dimmedPathRobotIds([legal, illegal], zone)).toEqual(new Set(['bad']));
  });

  it('judges a composed robot by its first segment only', () => {
    const first = makeSession(routeAt('a', 0.2, 0.2));
    first.routeOptions = [
      { id: 'a', relPath: 'a.ghostauto', trajectory: routeAt('a', 0.2, 0.2) },
      { id: 'b', relPath: 'b.ghostauto', trajectory: routeAt('b', 9, 9) },
    ];
    first.routeId = 'a';
    const continued = applySequenceSegments(first, [
      { id: 's1', routeId: 'a', waitBeforeS: 0 },
      { id: 's2', routeId: 'b', waitBeforeS: 0.5 },
    ]);
    // Second leg starts far outside — continuation, not an illegal start.
    expect(dimmedPathRobotIds([continued], zone)).toEqual(new Set());

    const illegalFirst = applySequenceSegments(first, [{ id: 's1', routeId: 'b', waitBeforeS: 0 }]);
    expect(dimmedPathRobotIds([illegalFirst], zone)).toEqual(new Set([illegalFirst.trajectory.id]));
  });

  it('keeps the verdict frame-invariant under the alliance view (2026-10-17 regression)', () => {
    // What App feeds the field canvas: slots pushed through the alliance
    // derivation, so under red every sample is 180°-flipped.
    const field = { lengthM: 10, widthM: 10 } as FieldPackage;
    const legal = makeSession(routeAt('ok', 0.5, 0.5));
    const illegal = makeSession(routeAt('bad', 8, 8));
    for (const alliance of ['red', 'blue'] as const) {
      const view = robotsForAlliance([legal, illegal], alliance, field);
      expect(view[0]!.trajectory.alliance).toBe(alliance);
      expect(dimmedPathRobotIds(view, zone, field)).toEqual(new Set(['bad']));
    }
  });
});

describe('previewDimsPath', () => {
  it('stays colored when any input is missing', () => {
    const target = makeSession(routeAt('t', 0.5, 0.5));
    expect(previewDimsPath(undefined, target, zone)).toBe(false);
    expect(previewDimsPath(target, undefined, zone)).toBe(false);
    expect(previewDimsPath(target, target, undefined)).toBe(false);
  });

  it('dims an out-of-zone route only while the picker would gate it as a first leg', () => {
    const target = makeSession(routeAt('t', 0.5, 0.5));
    target.routeOptions = [
      { id: 't', relPath: 't.ghostauto', trajectory: target.trajectory },
      { id: 'far', relPath: 'far.ghostauto', trajectory: routeAt('far', 9, 9) },
    ];
    target.routeId = 't';
    const farRoute = { ...target, trajectory: routeAt('far', 9, 9) };

    // Empty arrangement: the picker's first-leg gate is live → preview grays.
    const emptied = applySequenceSegments(target, []);
    expect(previewDimsPath(emptied, farRoute, zone)).toBe(true);

    // Legacy robot (no explicit arrangement): the pseudo initial leg
    // occupies the lane, the picker does not gate → the field must not
    // disagree with the row being hovered.
    expect(previewDimsPath(target, farRoute, zone)).toBe(false);

    // Clips exist: continuity governs → preview stays colored.
    const placed = applySequenceSegments(target, [{ id: 's1', routeId: 't', waitBeforeS: 0 }]);
    expect(previewDimsPath(placed, farRoute, zone)).toBe(false);
  });
});
