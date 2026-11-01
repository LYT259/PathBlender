import { describe, expect, it } from 'vitest';
import {
  REMEMBERED_SLACK_PX, anchorClearRect, placeRobotLabel, plateHeightCap, pruneRobotLabelMemory,
  type RobotLabelFrame, type RobotLabelMemory,
} from '../src/robot-label-layout';
import { rectsIntersect, type LayoutRect } from '../src/callout-layout';

const viewport = { w: 800, h: 450 };
const size = { w: 100, h: 50 };
const frameWith = (hard: LayoutRect[] = [], corridors: LayoutRect[] = []): RobotLabelFrame => ({ hard: [...hard], corridors: [...corridors] });

describe('shared robot card placement (2D and 3D)', () => {
  it('first sight: the anchor half picks the side, the plate lifts clear of the body', () => {
    const anchor = { x: 300, y: 200 };
    const p = placeRobotLabel({ anchor, clear: 22, size, viewport, frame: frameWith([anchorClearRect(anchor, 22)]) });
    expect(p.side).toBe(-1);
    expect(p.rect).toEqual({ x: 300 - 30 - 100, y: 200 - 50 - 32, w: 100, h: 50 });
    expect(p.memory).toEqual({ side: -1, dx: -130, dy: -82 });
    const right = placeRobotLabel({ anchor: { x: 500, y: 200 }, clear: 22, size, viewport, frame: frameWith() });
    expect(right.side).toBe(1);
    expect(right.rect.x).toBe(530);
  });

  it('registers the plate and its leader corridors for the robots drawn after, unless told not to (ghosts)', () => {
    const frame = frameWith();
    const p = placeRobotLabel({ anchor: { x: 300, y: 200 }, clear: 22, size, viewport, frame });
    expect(frame.hard).toEqual([p.rect]);
    expect(frame.corridors).toEqual(p.leader.segments);
    const ghostFrame = frameWith();
    placeRobotLabel({ anchor: { x: 300, y: 200 }, clear: 22, size, viewport, frame: ghostFrame, register: false });
    expect(ghostFrame.hard).toEqual([]);
    expect(ghostFrame.corridors).toEqual([]);
  });

  it('keeps the remembered side across the midline, and the remembered offset while the ideal is contested', () => {
    const remembered: RobotLabelMemory = { side: -1, dx: -130, dy: -82 };
    const anchor = { x: 520, y: 200 }; // right half now — the memory says left
    const p = placeRobotLabel({ anchor, clear: 22, size, viewport, remembered, frame: frameWith() });
    expect(p.side).toBe(-1);
    expect(p.rect.x).toBe(520 - 130);
    // The ideal (390,118) is contested by another plate. The fresh slide
    // below it lands at y=140 (22 px off ideal); the remembered spot at
    // y=150 is only 10 px farther — inside the slack, so it holds still.
    const blocker: LayoutRect = { x: 380, y: 110, w: 60, h: 20 };
    const q = placeRobotLabel({ anchor, clear: 22, size, viewport, remembered: { side: -1, dx: -130, dy: -50 }, frame: frameWith([blocker]) });
    expect(q.rect).toEqual({ x: 390, y: 150, w: 100, h: 50 });
  });

  it('lets a far remembered spot go when a clear spot much nearer the ideal opens up', () => {
    // Memory from a congested first sight: 250 px below-right of the anchor.
    const remembered: RobotLabelMemory = { side: 1, dx: 166, dy: 155 };
    const anchor = { x: 300, y: 100 };
    // The ideal (right side, lifted) is blocked by a sliver; one slide down is free.
    const sliver: LayoutRect = { x: 331, y: 10, w: 10, h: 10 };
    const p = placeRobotLabel({ anchor, clear: 22, size, viewport, remembered, frame: frameWith([sliver]) });
    const idealY = 100 - 50 - 32;
    expect(p.rect.y).toBe(sliver.y + sliver.h + 10); // the near slide, not 255 px away
    expect(Math.abs(p.rect.y - idealY)).toBeLessThan(155 - REMEMBERED_SLACK_PX);
    expect(p.memory).toEqual({ side: 1, dx: p.rect.x - anchor.x, dy: p.rect.y - anchor.y });
  });

  it('does not jitter: a fresh spot only marginally nearer leaves the remembered one in place', () => {
    const anchor = { x: 300, y: 300 };
    const idealY = 300 - 50 - 32;
    // Remembered one slide down; the ideal is blocked by a thin bar whose
    // free side above is just a hair nearer than the remembered slot below.
    const bar: LayoutRect = { x: 0, y: idealY - 2, w: 800, h: 54 };
    const remembered: RobotLabelMemory = { side: 1, dx: 30, dy: (bar.y + bar.h + 10) - 300 };
    const p = placeRobotLabel({ anchor, clear: 22, size, viewport, remembered, frame: frameWith([bar]) });
    expect(p.rect.y).toBe(bar.y + bar.h + 10);
  });

  it('never trades a clear remembered spot for a fresh spot that overlaps something', () => {
    const anchor = { x: 400, y: 225 };
    // Wall everything except one remembered pocket far below.
    const wall: LayoutRect = { x: 0, y: 0, w: 800, h: 330 };
    const remembered: RobotLabelMemory = { side: 1, dx: 30, dy: 130 };
    const p = placeRobotLabel({ anchor, clear: 22, size, viewport, remembered, frame: frameWith([wall]) });
    expect(rectsIntersect(p.rect, wall)).toBe(false);
    expect(p.rect).toEqual({ x: 430, y: 355, w: 100, h: 50 });
  });

  it('folds at 45% of the viewport with a 132 px floor, never past the viewport itself', () => {
    expect(plateHeightCap(900)).toBe(405);
    expect(plateHeightCap(200)).toBe(132);
    expect(plateHeightCap(140)).toBe(116);
    expect(plateHeightCap(50)).toBe(60);
  });

  it('prunes memory for robots that left', () => {
    const memory = new Map<string, RobotLabelMemory>([['a', { side: 1, dx: 0, dy: 0 }], ['b', { side: -1, dx: 0, dy: 0 }]]);
    pruneRobotLabelMemory(memory, ['b']);
    expect([...memory.keys()]).toEqual(['b']);
  });
});
