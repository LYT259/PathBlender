import { describe, expect, it } from 'vitest';
import { makeSession, REBUILT_2026, type CollisionInterval, type SessionTrajectory, type Trajectory } from '@pathblender/core';
import { renderFieldFrame } from '../src/canvas2d-render';
import { rectsIntersect, type LayoutRect } from '../src/callout-layout';
import { leaderGeometry } from '../src/robot-label-leader';
import { anchorClearRect, type RobotLabelMemory } from '../src/robot-label-layout';

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

/** Records every roundRect plate (unified robot cards are the
 *  only rounded rects in a frame) with the alpha it was drawn at, plus the
 *  texts — enough to assert label collision behavior without a rasterizer.
 *  save/restore keep a real stack so a ghost's faded alpha stays its own. */
function plateCtx() {
  const plates: LayoutRect[] = [];
  const texts: { text: string; alpha: number }[] = [];
  const state: Record<string, unknown> = { globalAlpha: 1 };
  const stack: Record<string, unknown>[] = [];
  const ctx = new Proxy(state as unknown as CanvasRenderingContext2D, {
    get(target, key) {
      if (key === 'save') return () => { stack.push({ ...state }); };
      if (key === 'restore') return () => { const s = stack.pop(); if (s) { for (const k of Object.keys(state)) delete state[k]; Object.assign(state, s); } };
      if (key in target) return (target as Record<string, unknown>)[key as string];
      if (key === 'roundRect')
        return (x: number, y: number, w: number, h: number) => { plates.push({ x, y, w, h, alpha: state.globalAlpha as number } as LayoutRect); };
      if (key === 'fillText') return (text: string) => { texts.push({ text, alpha: state.globalAlpha as number }); };
      if (key === 'measureText') return () => ({ width: 10 });
      return () => undefined;
    },
    set(target, key, value) {
      (target as Record<string, unknown>)[key as string] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, plates, texts };
}

function frame(ctx: CanvasRenderingContext2D, robots: SessionTrajectory[], opts: {
  w?: number; h?: number; scale?: number; labelMemory?: Map<string, RobotLabelMemory>; conflicts?: CollisionInterval[];
} = {}) {
  renderFieldFrame(ctx, {
    w: opts.w ?? 800, h: opts.h ?? 400,
    view: { scale: opts.scale ?? 40, cx: REBUILT_2026.lengthM / 2, cy: REBUILT_2026.widthM / 2 },
    field: REBUILT_2026,
    fieldImg: null, sprite: null,
    robots, currentT: 1, conflicts: opts.conflicts ?? [], bounds: [],
    labelMemory: opts.labelMemory,
  });
}

/** Screen anchor of a stationary, unrotated, zero-offset fixture robot. */
function anchorOf(x: number, y: number, opts: { w?: number; h?: number; scale?: number } = {}) {
  const scale = opts.scale ?? 40;
  return {
    x: (opts.w ?? 800) / 2 + (x - REBUILT_2026.lengthM / 2) * scale,
    y: (opts.h ?? 400) / 2 - (y - REBUILT_2026.widthM / 2) * scale,
  };
}

/** The drawn plate is the half-pixel-inset stroke path; widen it back. */
const outer = (p: LayoutRect): LayoutRect => ({ x: p.x - 0.5, y: p.y - 0.5, w: p.w + 1, h: p.h + 1 });

function assertPairwiseClear(plates: LayoutRect[]) {
  for (let i = 0; i < plates.length; i++) {
    for (let j = i + 1; j < plates.length; j++) {
      expect(rectsIntersect(plates[i], plates[j]), `plates ${i} and ${j} overlap: ${JSON.stringify(plates[i])} vs ${JSON.stringify(plates[j])}`).toBe(false);
    }
  }
}

describe('label collision layout in renderFieldFrame', () => {
  it('disperses the plates of robots bunched at the same spot', () => {
    // Two co-located robots each get one full card, with no overlap.
    const { ctx, plates } = plateCtx();
    frame(ctx, [
      makeSession(robotAt('a', '0001', 4, 3, 'intake'), 0),
      makeSession(robotAt('b', '0002', 4, 3, 'align'), 1),
    ]);
    expect(plates).toHaveLength(2);
    assertPairwiseClear(plates);
  });

  it('keeps every label readable for three bunched robots', () => {
    const { ctx, plates } = plateCtx();
    frame(ctx, [
      makeSession(robotAt('a', '0001', 4, 3, 'intake'), 0),
      makeSession(robotAt('b', '0002', 4, 3, 'align'), 1),
      makeSession(robotAt('c', '0003', 4, 3, 'pre_aim'), 2),
    ]);
    expect(plates).toHaveLength(3);
    assertPairwiseClear(plates);
  });

  it('disperses complete multi-action cards', () => {
    // Distinct end times share a single card per robot.
    const { ctx, plates } = plateCtx();
    frame(ctx, [
      makeSession(robotAt('a', '0001', 4, 3, 'intake', 'close_blocker'), 0),
      makeSession(robotAt('b', '0002', 4, 3, 'align', 'open_blocker'), 1),
    ]);
    expect(plates).toHaveLength(2);
    assertPairwiseClear(plates);
  });

  it('keeps cards off robot anchors even when their ideal position is clamped near an edge', () => {
    const { ctx, plates } = plateCtx();
    frame(ctx, [
      makeSession(robotAt('a', '0001', 4, 7, 'intake'), 0),
      makeSession(robotAt('b', '0002', 5, 7, 'align'), 1),
    ]);
    for (const x of [4, 5]) {
      const anchor = { x: 400 + (x - REBUILT_2026.lengthM / 2) * 40, y: 200 - (7 - REBUILT_2026.widthM / 2) * 40 };
      for (const plate of plates) {
        expect(rectsIntersect(plate, { x: anchor.x - 1, y: anchor.y - 1, w: 2, h: 2 })).toBe(false);
      }
    }
    assertPairwiseClear(plates);
  });

  it('moves nothing when robots are far apart', () => {
    // A distant robot does not move the first robot's card.
    const alone = plateCtx();
    frame(alone.ctx, [makeSession(robotAt('a', '0001', 2, 3, 'intake'), 0)]);
    const together = plateCtx();
    frame(together.ctx, [
      makeSession(robotAt('a', '0001', 2, 3, 'intake'), 0),
      makeSession(robotAt('b', '0002', 12, 3, 'align'), 1),
    ]);
    expect(alone.plates).toHaveLength(1);
    expect(together.plates.slice(0, 1)).toEqual(alone.plates);
  });

  it('keeps six bunched cards clear of every body, every card and every earlier leader when the canvas has room', () => {
    // Six robots inside ~1 m at field center, several of them annotated, on a
    // roomy 1600×900 canvas at 60 px/m. With room to spare the soft leader
    // corridors must hold too — a later card never sits on an earlier line.
    const size = { w: 1600, h: 900, scale: 60 };
    const L = REBUILT_2026.lengthM / 2;
    const W = REBUILT_2026.widthM / 2;
    const spots: [number, number, string[]][] = [
      [L, W, ['intake', 'close_blocker']], [L + 0.5, W, ['align']], [L - 0.5, W, []],
      [L, W + 0.5, ['pre_aim']], [L + 0.4, W - 0.5, ['shoot', 'open_blocker']], [L - 0.4, W - 0.5, ['intake']],
    ];
    const { ctx, plates } = plateCtx();
    frame(ctx, spots.map(([x, y, events], i) => makeSession(robotAt(`r${i}`, `000${i}`, x, y, ...events), i)), size);
    expect(plates).toHaveLength(6);
    const rects = plates.map(outer);
    const anchors = spots.map(([x, y]) => anchorOf(x, y, size));
    const bodyR = Math.hypot(0.9, 0.9) * size.scale / 2;
    assertPairwiseClear(rects);
    rects.forEach((plate, j) => {
      for (const anchor of anchors) {
        expect(rectsIntersect(plate, anchorClearRect(anchor, bodyR)), `card ${j} parks on a robot body`).toBe(false);
      }
      for (let i = 0; i < j; i++) {
        for (const segment of leaderGeometry(anchors[i]!, rects[i]!).segments) {
          expect(rectsIntersect(plate, segment), `card ${j} crosses the leader of card ${i}`).toBe(false);
        }
      }
    });
  });

  it('keeps a card on its first side across frames while the robot crosses the midline — only with the caller\'s memory', () => {
    const L = REBUILT_2026.lengthM / 2;
    const left = (x: number) => makeSession(robotAt('mover', '0007', x, 3, 'intake'), 0);
    const memory = new Map<string, RobotLabelMemory>();
    const first = plateCtx();
    frame(first.ctx, [left(L - 0.1)], { labelMemory: memory });
    const firstAnchor = anchorOf(L - 0.1, 3);
    expect(first.plates[0]!.x + first.plates[0]!.w).toBeLessThanOrEqual(firstAnchor.x); // left of the anchor at first sight
    expect(memory.get('mover')?.side).toBe(-1);

    const second = plateCtx();
    frame(second.ctx, [left(L + 0.3)], { labelMemory: memory });
    const secondAnchor = anchorOf(L + 0.3, 3);
    expect(secondAnchor.x).toBeGreaterThan(400); // now on the right half…
    expect(second.plates[0]!.x + second.plates[0]!.w).toBeLessThanOrEqual(secondAnchor.x); // …yet the card stays left
    expect(memory.get('mover')?.side).toBe(-1);

    // A stateless frame (the still-image export) decides from scratch — and twice the same.
    const fresh = plateCtx();
    frame(fresh.ctx, [left(L + 0.3)]);
    expect(fresh.plates[0]!.x).toBeGreaterThanOrEqual(secondAnchor.x);
    const again = plateCtx();
    frame(again.ctx, [left(L + 0.3)]);
    expect(again.plates).toEqual(fresh.plates);
  });

  it('forgets robots that leave the frame (hidden, deleted or replaced)', () => {
    const memory = new Map<string, RobotLabelMemory>();
    frame(plateCtx().ctx, [
      makeSession(robotAt('a', '0001', 4, 3, 'intake'), 0),
      makeSession(robotAt('b', '0002', 9, 3, 'align'), 1),
    ], { labelMemory: memory });
    expect([...memory.keys()].sort()).toEqual(['a', 'b']);
    frame(plateCtx().ctx, [makeSession(robotAt('a', '0001', 4, 3, 'intake'), 0)], { labelMemory: memory });
    expect([...memory.keys()]).toEqual(['a']);
    frame(plateCtx().ctx, [], { labelMemory: memory });
    expect(memory.size).toBe(0);
  });

  it('draws a tolerance ghost as a faded identity-only card that neither blocks nor moves the solid cards', () => {
    const a = makeSession(robotAt('a', '0001', 4, 3, 'intake'), 0);
    const b = makeSession(robotAt('b', '0002', 6, 3, 'align'), 1);
    const slip: CollisionInterval = {
      aId: 'a', bId: 'b', startT: 0.5, endT: 2, minCenterDistanceM: 0.4, closestT: 1,
      closestA: { x: 4, y: 3, heading: 0 }, closestB: { x: 6, y: 3, heading: 0 }, kind: 'tolerance', offsetS: 0.5,
    };
    const plain = plateCtx();
    frame(plain.ctx, [a, b]);
    const ghosted = plateCtx();
    frame(ghosted.ctx, [a, b], { conflicts: [slip] });
    const alphaOf = (p: LayoutRect) => (p as LayoutRect & { alpha: number }).alpha;
    expect(ghosted.plates).toHaveLength(3);
    const ghost = ghosted.plates.find((p) => alphaOf(p) < 1)!;
    expect(alphaOf(ghost)).toBeCloseTo(0.35);
    // The two solid cards land exactly where they do without the ghost: it
    // registers no obstacle and no memory (the old faded-identity behavior).
    expect(ghosted.plates.filter((p) => alphaOf(p) === 1)).toEqual(plain.plates);
    // The ghost names the slipped robot and nothing else — no action rows,
    // no countdown — while the solid cards keep theirs.
    expect(ghosted.texts.filter((t) => t.alpha < 1).map((t) => t.text)).toEqual(['0002']);
    expect(ghosted.texts.filter((t) => t.alpha === 1).map((t) => t.text)).toEqual(plain.texts.map((t) => t.text));
    expect(plain.texts.map((t) => t.text)).toContain('align');
  });
});
