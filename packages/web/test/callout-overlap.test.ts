import { describe, expect, it } from 'vitest';
import { makeSession, REBUILT_2026, type SessionTrajectory, type Trajectory } from '@pathblender/core';
import { renderFieldFrame } from '../src/canvas2d-render';
import { rectsIntersect, type LayoutRect } from '../src/callout-layout';

/** Stationary robot at (x,y) with the given sustained actions firing at 0.2 s. */
function robotAt(id: string, team: string, x: number, y: number, ...events: string[]): Trajectory {
  return {
    id,
    name: id,
    teamName: 'Team',
    teamNumber: team,
    source: 'ghostauto',
    alliance: 'blue',
    samples: [
      { t: 0, x, y, heading: 0, vx: 0, vy: 0, omega: 0 },
      { t: 8, x, y, heading: 0, vx: 0, vy: 0, omega: 0 },
    ],
    durationS: 8,
    geometry: { lengthM: 0.9, widthM: 0.9, offsetX: 0, offsetY: 0 },
    geometrySource: 'file',
    moduleLocations: [],
    events: events.map((name) => ({ name, t: 0.2 })),
    warnings: [],
  };
}

/** Records every roundRect plate (number badges and action boxes are the
 *  only rounded rects in a frame) — enough to assert label collision
 *  behavior without a rasterizer. */
function plateCtx() {
  const plates: LayoutRect[] = [];
  const ctx = new Proxy({} as CanvasRenderingContext2D, {
    get(target, key) {
      if (key in target) return (target as Record<string, unknown>)[key];
      if (key === 'roundRect')
        return (x: number, y: number, w: number, h: number) => { plates.push({ x, y, w, h }); };
      if (key === 'measureText') return () => ({ width: 10 });
      return () => undefined;
    },
    set(target, key, value) {
      (target as Record<string, unknown>)[key] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, plates };
}

function frame(ctx: CanvasRenderingContext2D, robots: SessionTrajectory[]) {
  renderFieldFrame(ctx, {
    w: 800, h: 400,
    view: { scale: 40, cx: REBUILT_2026.lengthM / 2, cy: REBUILT_2026.widthM / 2 },
    field: REBUILT_2026,
    fieldImg: null, sprite: null,
    robots, currentT: 1, conflicts: [], bounds: [],
  });
}

function assertPairwiseClear(plates: LayoutRect[]) {
  for (let i = 0; i < plates.length; i++) {
    for (let j = i + 1; j < plates.length; j++) {
      expect(rectsIntersect(plates[i], plates[j]), `plates ${i} and ${j} overlap: ${JSON.stringify(plates[i])} vs ${JSON.stringify(plates[j])}`).toBe(false);
    }
  }
}

describe('label collision layout in renderFieldFrame', () => {
  it('disperses the plates of robots bunched at the same spot', () => {
    // Two co-located robots, both mid-action: without collision layout
    // their number badges AND action stacks all wanted the same two
    // diagonals (user screenshot 2026-10-14) — four plates, three covered.
    const { ctx, plates } = plateCtx();
    frame(ctx, [
      makeSession(robotAt('a', '0001', 4, 3, 'intake'), 0),
      makeSession(robotAt('b', '0002', 4, 3, 'align'), 1),
    ]);
    expect(plates).toHaveLength(4);
    assertPairwiseClear(plates);
  });

  it('keeps every label readable for three bunched robots', () => {
    const { ctx, plates } = plateCtx();
    frame(ctx, [
      makeSession(robotAt('a', '0001', 4, 3, 'intake'), 0),
      makeSession(robotAt('b', '0002', 4, 3, 'align'), 1),
      makeSession(robotAt('c', '0003', 4, 3, 'pre_aim'), 2),
    ]);
    expect(plates).toHaveLength(6);
    assertPairwiseClear(plates);
  });

  it('disperses multi-box stacks — the bunched-reef screenshot shape', () => {
    // The user screenshot (2026-10-14): robots piled at a game piece,
    // each running several actions — multi-box stacks landing on each
    // other. A sustained action (ends at the route end) plus a one-shot
    // move (2 s flash) give distinct endings, so two boxes per stack;
    // all six plates must stay pairwise clear.
    const { ctx, plates } = plateCtx();
    frame(ctx, [
      makeSession(robotAt('a', '0001', 4, 3, 'intake', 'close_blocker'), 0),
      makeSession(robotAt('b', '0002', 4, 3, 'align', 'open_blocker'), 1),
    ]);
    expect(plates).toHaveLength(6);
    assertPairwiseClear(plates);
  });

  it('moves nothing when robots are far apart', () => {
    // Robot a alone vs. robot a plus a distant robot: a's plates (number
    // badge + action box, drawn first) land on identical pixels.
    const alone = plateCtx();
    frame(alone.ctx, [makeSession(robotAt('a', '0001', 2, 3, 'intake'), 0)]);
    const together = plateCtx();
    frame(together.ctx, [
      makeSession(robotAt('a', '0001', 2, 3, 'intake'), 0),
      makeSession(robotAt('b', '0002', 12, 3, 'align'), 1),
    ]);
    expect(alone.plates).toHaveLength(2);
    expect(together.plates.slice(0, 2)).toEqual(alone.plates);
  });
});
