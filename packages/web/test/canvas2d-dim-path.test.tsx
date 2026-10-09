import { describe, expect, it } from 'vitest';
import { makeSession, REBUILT_2026, type SessionTrajectory, type Trajectory } from '@pathblender/core';
import { renderFieldFrame } from '../src/canvas2d-render';

/** Straight drive from (x,y) — only the first sample faces the zone verdict. */
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

/** Records every stroke()'s style — enough to assert which color a robot's
 * path tape got without a real rasterizer. */
function recordingCtx() {
  const strokes: string[] = [];
  const ctx = new Proxy({} as CanvasRenderingContext2D, {
    get(target, key) {
      if (key in target) return (target as Record<string, unknown>)[key];
      if (key === 'stroke') return () => { strokes.push(String((ctx as Record<string, unknown>).strokeStyle)); };
      if (key === 'measureText') return () => ({ width: 10 });
      return () => undefined;
    },
    set(target, key, value) {
      (target as Record<string, unknown>)[key] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, strokes };
}

function frame(ctx: CanvasRenderingContext2D, robots: SessionTrajectory[], dimPathIds?: ReadonlySet<string>) {
  renderFieldFrame(ctx, {
    w: 800, h: 400,
    view: { scale: 40, cx: REBUILT_2026.lengthM / 2, cy: REBUILT_2026.widthM / 2 },
    field: REBUILT_2026,
    fieldImg: null, sprite: null,
    robots, currentT: 0, conflicts: [], bounds: [],
    dimPathIds,
  });
}

describe('renderFieldFrame path dimming', () => {
  it('paints an in-zone path with the robot color and an out-of-zone path gray', () => {
    const legal = makeSession(routeAt('ok', 1.5, 4));
    const illegal = makeSession(routeAt('bad', 12, 4));
    const { ctx, strokes } = recordingCtx();
    frame(ctx, [legal, illegal], new Set(['bad']));
    // jsdom has no theme tokens, so the gray resolves to the fallback.
    expect(strokes).toContain('#a1a1aa');
    expect(strokes).toContain(legal.color);
    // Without the dim set the same robot paints its team color.
    const plain = recordingCtx();
    frame(plain.ctx, [illegal]);
    expect(plain.strokes).not.toContain('#a1a1aa');
    expect(plain.strokes).toContain(illegal.color);
  });
});
