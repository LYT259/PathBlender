import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type FieldPackage, type SessionTrajectory } from '@pathblender/core';
import { FieldCanvas } from '../src/components/FieldCanvas';
import { I18nProvider } from '../src/i18n';

/**
 * 2D robot drawing regression tests: the bumper ring fills only its four
 * perimeter bands (base plate stays transparent), and the team number rides
 * a leader callout anchored at the robot's visible footprint center.
 *
 * Scene math (all asserted below): 440×240 canvas fits the 10×5 field at
 * exactly 40 px/m (center 220,120). The fixture robot is an explicit 35 in
 * square (0.889 m → L=W=35.56 px, bounding radius reach=25.1433 px) with
 * 4 in bumpers (0.1016 m → 4.064 px) — a literal value, independent of the
 * season rule-max default. A robot at (2, 2.5) heading 0 lands at
 * screen (100,120); the leader runs 45° up-right and the badge top-left
 * sits (reach+20)/√2 ≈ 31.9221 px from the center, snapped to device
 * pixels (132,76) at dpr 1, glyphs at (139,88). jsdom resolves no CSS
 * custom properties, so theme tokens fall back: alliance red #c8323e /
 * blue #2264cf, badge plate #ffffff.
 */

const field: FieldPackage = { id: 'test', name: 'Test field', year: 2026, lengthM: 10, widthM: 5 };

type Call = { name: string; args: unknown[]; style: Record<string, unknown> };

let calls: Call[];
let frames: Map<number, FrameRequestCallback>;
let observed: Element | undefined;
let notifyResize: () => void;

const styleKeys = ['fillStyle', 'strokeStyle', 'lineWidth', 'textAlign', 'textBaseline', 'lineCap', 'lineJoin'] as const;

function record(name: string, args: unknown[]) {
  calls.push({ name, args, style: { ...currentStyle } });
}

const currentStyle: Record<string, unknown> = {};

beforeEach(() => {
  calls = [];
  for (const key of styleKeys) delete currentStyle[key];
  frames = new Map();
  let nextFrame = 0;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++nextFrame, callback);
    return nextFrame;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: () => void) { notifyResize = callback; }
    observe(element: Element) { observed = element; }
    disconnect() { observed = undefined; }
  });
  const context = new Proxy(
    { measureText: (text: string) => ({ width: String(text).length * 8 }) },
    {
      get: (target, property: string) => {
        if (property in target) return Reflect.get(target, property);
        return (...args: unknown[]) => record(property, args);
      },
      set: (_target, property: string, value) => {
        currentStyle[property] = value;
        return true;
      },
    },
  ) as unknown as CanvasRenderingContext2D;
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

interface RobotOpts {
  y?: number;
  alliance?: 'red' | 'blue';
  heading?: number;
  offsetX?: number;
  offsetY?: number;
}

function robot(x: number, teamNumber = '11019', opts: RobotOpts = {}): SessionTrajectory {
  const heading = opts.heading ?? 0;
  const y = opts.y ?? 2.5;
  return {
    trajectory: {
      id: `r-${x}`,
      name: 'Route',
      teamName: 'Test team',
      teamNumber,
      source: 'ghostauto',
      alliance: opts.alliance ?? 'red',
      samples: [
        { t: 0, x, y, heading, vx: 0, vy: 0, omega: 0 },
        { t: 1, x, y, heading, vx: 0, vy: 0, omega: 0 },
      ],
      durationS: 1,
      geometry: { lengthM: 0.889, widthM: 0.889, offsetX: opts.offsetX ?? 0, offsetY: opts.offsetY ?? 0 },
      geometrySource: 'file',
      moduleLocations: [],
      events: [],
      warnings: [],
    },
    startDelayS: 0,
    color: '#00E5FF',
    visible: true,
  };
}

function makeScene(robots: SessionTrajectory[], t = 0, showTrail = false) {
  return (
    <I18nProvider>
      <FieldCanvas field={field} robots={robots} currentT={t} conflicts={[]} bounds={[]} showTrail={showTrail} />
    </I18nProvider>
  );
}

function sizeWrap() {
  expect(observed).toBeDefined();
  Object.defineProperties(observed!, {
    clientWidth: { configurable: true, value: 440 },
    clientHeight: { configurable: true, value: 240 },
  });
  act(() => notifyResize());
}

function runFrames() {
  const pending = [...frames.values()];
  frames.clear();
  act(() => pending.forEach((callback) => callback(16)));
}

function paint(robots: SessionTrajectory[], opts: { currentT?: number; showTrail?: boolean } = {}) {
  render(makeScene(robots, opts.currentT ?? 0, opts.showTrail ?? false));
  sizeWrap();
  runFrames();
}

/** Path command groups: each entry is the commands between beginPath and one fill/stroke. */
function paths(end: 'fill' | 'stroke'): Call[][] {
  const out: Call[][] = [];
  let current: Call[] = [];
  for (const call of calls) {
    if (call.name === 'beginPath') current = [];
    else if (call.name === end) { out.push(current); current = []; }
    else current.push(call);
  }
  return out;
}

function expectArgs(call: Call, expected: number[]) {
  expected.forEach((value, i) => expect(call.args[i]).toBeCloseTo(value, 4));
}

/** The callout's anchor dot: single-arc path, filled after its plate ring stroke. */
function dotFill() {
  const idx = calls.findIndex((c) => c.name === 'arc');
  expect(idx).toBeGreaterThanOrEqual(0);
  expect(calls[idx + 1]!.name).toBe('stroke'); // plate ring around the dot
  expect(calls[idx + 2]!.name).toBe('fill');
  return { arc: calls[idx]!, fill: calls[idx + 2]! };
}

/**
 * Index of the leader's moveTo. The heading wedge also opens with moveTo,
 * so match the callout's exact shape: moveTo → lineTo → stroke (plate
 * under-stroke) → stroke (alliance line).
 */
function leaderIndex() {
  const idx = calls.findIndex((c, i) =>
    c.name === 'moveTo' && calls[i + 1]?.name === 'lineTo' && calls[i + 2]?.name === 'stroke');
  expect(idx).toBeGreaterThanOrEqual(0);
  return idx;
}

describe('2D robot bumper and team-number callout', () => {
  it('fills one continuous square bumper ring with the alliance color, never the base plate', () => {
    paint([robot(2)]);
    const fills = paths('fill');
    // One fill path holds the ring: outer square + inner square punched
    // with the even-odd rule (2026-10-04, second pass: bands went from
    // four separate trapezoids to a single seamless closed ring).
    const ring = fills.find((p) => p.length === 2 && p.every((c) => c.name === 'rect'));
    expect(ring).toBeDefined();
    expect(ring![0]!.style.fillStyle).toBe('#c8323e');
    const h = 17.78; // L/2 = W/2 (35.56 px square)
    const i = 13.716; // h − bd (4.064 px)
    expectArgs(ring![0]!, [-h, -h, 2 * h, 2 * h]);
    expectArgs(ring![1]!, [-i, -i, 2 * i, 2 * i]);
    // The hole only opens with the even-odd fill rule.
    expect(calls.some((c) => c.name === 'fill' && c.args[0] === 'evenodd')).toBe(true);
    // The base plate is never solid-filled: no fill path is a lone
    // full-outline rect.
    const filled = fills.some((p) =>
      p.length === 1 && p[0]!.name === 'rect' && Math.abs((p[0]!.args[2] as number) - 35.56) < 1e-6 && Math.abs((p[0]!.args[3] as number) - 35.56) < 1e-6);
    expect(filled).toBe(false);
    const strokes = paths('stroke');
    const outline = strokes.find((p) => p.length === 1 && p[0]!.name === 'rect' && Math.abs((p[0]!.args[2] as number) - 35.56) < 1e-6);
    expect(outline).toBeDefined();
  });

  it('anchors the leader at the footprint center and badges the number up-right', () => {
    paint([robot(2)]);
    // Leader: robot center (100,120) → badge edge (132,88), drawn as a 1 px
    // alliance line over a 3 px opaque plate under-stroke (legibility halo).
    const li = leaderIndex();
    expectArgs(calls[li]!, [100, 120]);
    expect(calls[li + 1]!.name).toBe('lineTo');
    expectArgs(calls[li + 1]!, [132, 88]);
    expect(calls[li + 2]!.name).toBe('stroke');
    expect(calls[li + 2]!.style.strokeStyle).toBe('#ffffff'); // plate under-stroke
    expect(calls[li + 2]!.style.lineWidth).toBe(3);
    expect(calls[li + 3]!.name).toBe('stroke');
    expect(calls[li + 3]!.style.strokeStyle).toBe('#c8323e'); // alliance line
    expect(calls[li + 3]!.style.lineWidth).toBe(1);
    // Anchor dot on the footprint center, alliance-filled with a plate ring.
    const { arc, fill } = dotFill();
    expectArgs(arc, [100, 120, 3, 0, Math.PI * 2]);
    expect(fill.style.fillStyle).toBe('#c8323e');
    // Solid rounded badge: plate fill + hairline border, snapped integers.
    const bi = calls.findIndex((c) => c.name === 'roundRect');
    expect(bi).toBeGreaterThanOrEqual(0);
    expectArgs(calls[bi]!, [132, 76, 54, 24, 6]);
    expect(calls[bi + 1]!.name).toBe('fill');
    expect(calls[bi + 1]!.style.fillStyle).toBe('#ffffff');
    // One number, alliance-colored, pixel-aligned — and never strokeText
    // outlines, which muddy the small glyph counters.
    const texts = calls.filter((c) => c.name === 'fillText' && c.args[0] === '11019');
    expect(texts).toHaveLength(1);
    expect(texts[0]!.args[1]).toBe(139);
    expect(texts[0]!.args[2]).toBe(88);
    expect(texts[0]!.style.fillStyle).toBe('#c8323e');
    expect(texts[0]!.style.textAlign).toBe('left');
    expect(texts[0]!.style.textBaseline).toBe('middle');
    expect(calls.some((c) => c.name === 'strokeText')).toBe(false);
  });

  it('mirrors the badge to up-left near the right canvas edge', () => {
    paint([robot(9)]);
    // cx = 220+(9−5)·40 = 380; right side no longer fits → badge flips left.
    const { arc, fill } = dotFill();
    expectArgs(arc, [380, 120, 3, 0, Math.PI * 2]);
    expect(fill.style.fillStyle).toBe('#c8323e');
    const li = leaderIndex();
    expectArgs(calls[li]!, [380, 120]);
    expectArgs(calls[li + 1]!, [348, 88]); // badge right edge (294+54)
    const bi = calls.findIndex((c) => c.name === 'roundRect');
    expectArgs(calls[bi]!, [294, 76, 54, 24, 6]);
    const texts = calls.filter((c) => c.name === 'fillText' && c.args[0] === '11019');
    expect(texts).toHaveLength(1);
    expect(texts[0]!.args[1]).toBe(301); // snapped badge x + padding
    expect(texts[0]!.args[1] as number).toBeLessThan(380);
  });

  it('clamps the badge inside the canvas near the top edge', () => {
    paint([robot(9.9, '11019', { y: 4.9 })]);
    // Center (416,24): the 45° slot would put the badge at y=−20 → clamped
    // to the 6 px margin; the leader still lands on the badge edge.
    const bi = calls.findIndex((c) => c.name === 'roundRect');
    expectArgs(calls[bi]!, [330, 6, 54, 24, 6]);
    const li = leaderIndex();
    expectArgs(calls[li]!, [416, 24]);
    expectArgs(calls[li + 1]!, [384, 18]);
    const { arc } = dotFill();
    expectArgs(arc, [416, 24, 3, 0, Math.PI * 2]);
  });

  it('anchors the dot at the rotated footprint center, not the trajectory origin', () => {
    // Footprint offset (0.1, 0.05) m, heading 90°: the local offset rotates
    // with the robot exactly like the bumper ring — world offset
    // (−0.05, +0.1) m → screen center (98,116), not (100,120).
    paint([robot(2, '11019', { heading: Math.PI / 2, offsetX: 0.1, offsetY: 0.05 })]);
    const { arc } = dotFill();
    expectArgs(arc, [98, 116, 3, 0, Math.PI * 2]);
    const li = leaderIndex();
    expectArgs(calls[li]!, [98, 116]);
  });

  it('follows the session alliance — blue robots get a blue dot, leader and glyphs', () => {
    paint([robot(2, '11019', { alliance: 'blue' })]);
    const { fill } = dotFill();
    expect(fill.style.fillStyle).toBe('#2264cf');
    const li = leaderIndex();
    expect(calls[li + 3]!.style.strokeStyle).toBe('#2264cf');
    const texts = calls.filter((c) => c.name === 'fillText' && c.args[0] === '11019');
    expect(texts[0]!.style.fillStyle).toBe('#2264cf');
  });

  it('draws one callout per robot when several share the field', () => {
    paint([robot(2), robot(6, '2468')]);
    expect(calls.filter((c) => c.name === 'fillText' && c.args[0] === '11019')).toHaveLength(1);
    expect(calls.filter((c) => c.name === 'fillText' && c.args[0] === '2468')).toHaveLength(1);
    expect(calls.filter((c) => c.name === 'arc')).toHaveLength(2);
  });

  it('repaints immediately when the alliance flips or the number is edited', () => {
    const ui = render(makeScene([robot(2)]));
    sizeWrap();
    runFrames();
    // Alliance flip red → blue: dot, leader and glyphs all take blue.
    const flipped = robot(2, '11019', { alliance: 'blue' });
    calls = [];
    ui.rerender(makeScene([flipped]));
    runFrames();
    expect(dotFill().fill.style.fillStyle).toBe('#2264cf');
    expect(calls.filter((c) => c.name === 'fillText' && c.args[0] === '11019')[0]!.style.fillStyle).toBe('#2264cf');
    // Number edit: the new glyphs replace the old ones at the same anchor.
    calls = [];
    ui.rerender(makeScene([robot(2, '2468')]));
    runFrames();
    expect(calls.some((c) => c.name === 'fillText' && c.args[0] === '2468')).toBe(true);
    expect(calls.some((c) => c.name === 'fillText' && c.args[0] === '11019')).toBe(false);
    expectArgs(dotFill().arc, [100, 120, 3, 0, Math.PI * 2]);
  });

  it('draws no callout when the trajectory carries no team number', () => {
    paint([robot(2, '')]);
    expect(calls.some((c) => c.name === 'arc')).toBe(false);
    expect(calls.some((c) => c.name === 'roundRect')).toBe(false);
    expect(calls.some((c) => (c.name === 'fillText' || c.name === 'strokeText') && c.args[0] === '')).toBe(false);
  });

  it('badges the display name instead of the team number when one is set', () => {
    const display = robot(2, '11019');
    display.trajectory.displayName = '甲队';
    paint([display]);
    expect(calls.filter((c) => c.name === 'fillText' && c.args[0] === '甲队')).toHaveLength(1);
    expect(calls.some((c) => c.name === 'fillText' && c.args[0] === '11019')).toBe(false);
  });

  it('badges the display name even when the trajectory carries no team number', () => {
    const display = robot(2, '');
    display.trajectory.displayName = 'No Number';
    paint([display]);
    expect(calls.some((c) => c.name === 'fillText' && c.args[0] === 'No Number')).toBe(true);
    expect(calls.some((c) => c.name === 'arc')).toBe(true);
  });

  it('falls back to the team number when the display name is blank whitespace', () => {
    const display = robot(2, '11019');
    display.trajectory.displayName = '   ';
    paint([display]);
    expect(calls.filter((c) => c.name === 'fillText' && c.args[0] === '11019')).toHaveLength(1);
  });

  it('rides the heading wedge on the front bumper band, tip reaching the tape', () => {
    paint([robot(2)]);
    // Scene math: 40 px/m, L/2 = 17.78 px, bumper band bd = 4.064 px.
    // Base pinned to the band inner edge (13.716 = 17.78 - 4.064 — never
    // on the chassis rails), tip max(bd, 10 - bd) = 5.936 px past the face.
    const wedge = paths('fill').find((p) =>
      p.length === 4 && p[0]!.name === 'moveTo' && p[1]!.name === 'lineTo' &&
      p[2]!.name === 'lineTo' && p[3]!.name === 'closePath' && p[0]!.style.fillStyle === '#00E5FF');
    expect(wedge).toBeDefined();
    expectArgs(wedge![0]!, [23.716, 0]);
    expectArgs(wedge![1]!, [13.716, -3.048]);
    expectArgs(wedge![2]!, [13.716, 3.048]);
  });

  it('strokes the full route tape at any playback position', () => {
    const runner = robot(2);
    runner.trajectory = {
      ...runner.trajectory,
      samples: [
        { t: 0, x: 2, y: 2.5, heading: 0, vx: 4, vy: 0, omega: 0 },
        { t: 0.5, x: 4, y: 2.5, heading: 0, vx: 4, vy: 0, omega: 0 },
        { t: 1, x: 6, y: 3.5, heading: 0, vx: 0, vy: 4, omega: 0 },
      ],
    };
    // strokeStyle is set between the path commands and stroke(), so the
    // commands themselves carry the earlier lineWidth (4 px = 10 cm tape).
    const tape = () => paths('stroke').find((p) =>
      p.length === 3 && p[0]!.name === 'moveTo' && p[1]!.name === 'lineTo' &&
      p[2]!.name === 'lineTo' && p[0]!.style.lineWidth === 4);
    for (const currentT of [0, 0.5, 1]) {
      cleanup();
      calls = [];
      paint([runner], { currentT, showTrail: true });
      const stroke = tape();
      expect(stroke).toBeDefined();
      expectArgs(stroke![0]!, [100, 120]);
      expectArgs(stroke![1]!, [180, 120]);
      expectArgs(stroke![2]!, [260, 80]);
    }
  });

  it('strokes the tape with round caps and joins (2026-10-04: rounded tape ends)', () => {
    paint([robot(2)], { showTrail: true });
    const tape = paths('stroke').find((p) =>
      p.length === 2 && p[0]!.name === 'moveTo' && p[1]!.name === 'lineTo' &&
      p[0]!.style.lineWidth === 4);
    expect(tape).toBeDefined();
    expect(tape![0]!.style.lineCap).toBe('round');
    expect(tape![0]!.style.lineJoin).toBe('round');
  });

  it('re-allocates the canvas backing store when devicePixelRatio changes without a resize', () => {
    const ui = render(makeScene([robot(2)]));
    sizeWrap();
    runFrames();
    const canvas = document.querySelector('canvas')!;
    expect(canvas.width).toBe(440);
    expect(canvas.height).toBe(240);
    // Dragging the window between Retina and 1x displays changes the DPR
    // without a resize — ResizeObserver never fires. The next draw must
    // re-allocate the backing store, or the uncleared region ghosts the
    // previous frame (the "two fields" artifact, user report 2026-10-04).
    vi.stubGlobal('devicePixelRatio', 2);
    ui.rerender(makeScene([robot(2)], 1));
    runFrames();
    expect(canvas.width).toBe(880);
    expect(canvas.height).toBe(480);
  });
});

describe('current-action callout', () => {
  /** robot() + trajectory event markers, so the fixture stays one source. */
  function annotatedRobot(events: { name: string; t: number }[], x = 2): SessionTrajectory {
    const r = robot(x);
    r.trajectory.events = events;
    return r;
  }

  /** The action badge is the SECOND leader/dot/badge of the frame — the
   *  team number draws first, so take the second pattern match. */
  function actionLeaderIndex() {
    const idxs = calls.flatMap((c, i) =>
      c.name === 'moveTo' && calls[i + 1]?.name === 'lineTo' && calls[i + 2]?.name === 'stroke' ? [i] : []);
    expect(idxs.length).toBeGreaterThanOrEqual(2);
    return idxs[1]!;
  }

  function actionArcIndex() {
    const arcs = calls.map((c, i) => ({ c, i })).filter(({ c }) => c.name === 'arc');
    expect(arcs.length).toBeGreaterThanOrEqual(2);
    return arcs[1]!.i;
  }

  it('draws nothing for robots without annotations', () => {
    paint([robot(2)], { currentT: 1 });
    expect(calls.filter((c) => c.name === 'arc')).toHaveLength(1); // number dot only
    expect(calls.filter((c) => c.name === 'roundRect')).toHaveLength(1);
  });

  it('draws nothing at t=0 — the enable instant — even with t=0 markers', () => {
    paint([annotatedRobot([{ name: 'intake', t: 0 }])], { currentT: 0 });
    expect(calls.filter((c) => c.name === 'arc')).toHaveLength(1); // number dot only
  });

  it('draws nothing before the first marker fires', () => {
    paint([annotatedRobot([{ name: 'intake', t: 0.5 }])], { currentT: 0.49 });
    expect(calls.filter((c) => c.name === 'arc')).toHaveLength(1);
  });

  it('badges the fired action down-left with its countdown', () => {
    // Same scene math as the number test: robot at screen (100,120), reach
    // 25.1433 px, 45° offset (reach+20)/√2 ≈ 31.9221. Number goes up-right;
    // the action badge takes the opposite diagonal — down-left. Open-ended
    // intake counts down to the route end (1 s fixture) at t=0.5 →
    // 'intake 0.5s' = 11×8 px + 12 padding → labelW 100, clamped to the
    // margin; by = 120 + 31.9221 − 11 → snapped 141; glyphs at (12, 152).
    paint([annotatedRobot([{ name: 'intake', t: 0.5 }])], { currentT: 0.5 });
    const ai = actionArcIndex();
    expectArgs(calls[ai]!, [100, 120, 3, 0, Math.PI * 2]);
    expect(calls[ai + 2]!.style.fillStyle).toBe('#00E5FF'); // session color
    // Shared anchor dot draws first, then the leader: (100,120) → badge
    // right edge (106,152).
    const li = actionLeaderIndex();
    expect(li).toBeGreaterThan(ai);
    expectArgs(calls[li]!, [100, 120]);
    expectArgs(calls[li + 1]!, [106, 152]);
    // Badge plate: second roundRect, two columns — name left, countdown
    // right-aligned ('intake' 48 + gap 8 + '0.5s' 32 + padding 12 → 100).
    const rects = calls.filter((c) => c.name === 'roundRect');
    expect(rects).toHaveLength(2);
    expectArgs(rects[1]!, [6, 141, 100, 22, 5]);
    const name = calls.find((c) => c.name === 'fillText' && c.args[0] === 'intake')!;
    expect(name.args[1]).toBe(12);
    expect(name.args[2]).toBe(152);
    expect(name.style.fillStyle).toBe('#00E5FF');
    const sec = calls.find((c) => c.name === 'fillText' && c.args[0] === '0.5s')!;
    expect(sec.args[1]).toBe(100);
    expect(sec.args[2]).toBe(152);
    expect(sec.style.textAlign).toBe('right');
  });

  it('shows same-mechanism takeover: shoot replaces pre_aim, intake keeps running', () => {
    const robot0 = annotatedRobot([{ name: 'pre_aim', t: 0.3 }, { name: 'shoot', t: 0.7 }]);
    const ui = render(makeScene([robot0], 0.4));
    sizeWrap();
    runFrames();
    expect(calls.some((c) => c.name === 'fillText' && c.args[0] === 'pre_aim')).toBe(true);
    expect(calls.some((c) => c.name === 'fillText' && c.args[0] === '0.3s')).toBe(true);
    calls = [];
    ui.rerender(makeScene([robot0], 0.8));
    runFrames();
    expect(calls.some((c) => c.name === 'fillText' && c.args[0] === 'shoot')).toBe(true);
    expect(calls.some((c) => c.name === 'fillText' && c.args[0] === '0.2s')).toBe(true);
    expect(calls.some((c) => c.name === 'fillText' && c.args[0] === 'pre_aim')).toBe(false);
  });

  it('packs same-ending actions into one multi-line box with a single countdown', () => {
    // Machine-2 L1 shape: intake + pass + align all fire at t=0 and all
    // run to the route end — one shared ending, so one box (user layout
    // 2026-10-08): three stacked lines, one right-aligned countdown. Mock
    // metrics: widest name 'intake' 48 + gap 8 + '0.5s' 32 + padding 12 →
    // box 100×54 (22 + 2×16), leader to its right-edge middle.
    paint([annotatedRobot([{ name: 'intake', t: 0 }, { name: 'pass', t: 0 }, { name: 'align', t: 0 }])], { currentT: 0.5 });
    const rects = calls.filter((c) => c.name === 'roundRect');
    expect(rects).toHaveLength(2); // number badge + ONE grouped action box
    expectArgs(rects[1]!, [6, 141, 100, 54, 5]);
    for (const [name, y] of [['intake', 152], ['pass', 168], ['align', 184]] as const) {
      const text = calls.find((c) => c.name === 'fillText' && c.args[0] === name)!;
      expect(text.args[1], name).toBe(12);
      expect(text.args[2], name).toBe(y);
    }
    // The box's single countdown, right-aligned at its vertical middle.
    const sec = calls.find((c) => c.name === 'fillText' && c.args[0] === '0.5s')!;
    expect(sec.args[1]).toBe(100);
    expect(sec.args[2]).toBe(168);
    expect(sec.style.textAlign).toBe('right');
    const leaders = calls.flatMap((c, i) =>
      c.name === 'moveTo' && calls[i + 1]?.name === 'lineTo' && calls[i + 2]?.name === 'stroke' ? [i] : []);
    expect(leaders).toHaveLength(2); // number leader + the one box leader
    expectArgs(calls[leaders[1]! + 1]!, [106, 168]);
  });

  it('stacks one box per distinct ending, soonest first', () => {
    // intake runs to the route end (1 s); close_blocker flashes until 2 s —
    // two distinct endings, two boxes, the sooner-ending one on top.
    paint([annotatedRobot([{ name: 'intake', t: 0 }, { name: 'close_blocker', t: 0 }])], { currentT: 0.5 });
    const rects = calls.filter((c) => c.name === 'roundRect');
    expect(rects).toHaveLength(3); // number + two action boxes
    expectArgs(rects[1]!, [6, 141, 100, 22, 5]); // intake | 0.5s
    expectArgs(rects[2]!, [6, 167, 156, 22, 5]); // close_blocker | 1.5s
    const sec1 = calls.find((c) => c.name === 'fillText' && c.args[0] === '0.5s')!;
    expect(sec1.args[1]).toBe(100);
    const sec2 = calls.find((c) => c.name === 'fillText' && c.args[0] === '1.5s')!;
    expect(sec2.args[1]).toBe(156);
    expect(sec2.args[2]).toBe(178);
    const fanEnds = calls.filter((c) => c.name === 'lineTo' && [152, 178].includes(c.args[1] as number));
    expect(fanEnds.map((c) => c.args)).toEqual([[106, 152], [162, 178]]);
  });

  it('mirrors to down-right when the number badge flipped up-left', () => {
    // Robot near the right edge: the number takes up-left, so the action
    // badge takes the down-right diagonal (cx = 380, same offset).
    paint([annotatedRobot([{ name: 'shoot', t: 0 }], 9)], { currentT: 0.5 });
    const rects = calls.filter((c) => c.name === 'roundRect');
    expectArgs(rects[0]!, [294, 76, 54, 24, 6]); // number, up-left
    // 'shoot' 40 + gap 8 + '0.5s' 32 + padding 12 → box 92; dir = +1 →
    // target 411.92 clamps inside the 6 px margin to 440−6−92 = 342.
    expectArgs(rects[1]!, [342, 141, 92, 22, 5]);
    const name = calls.find((c) => c.name === 'fillText' && c.args[0] === 'shoot')!;
    expect(name.args[1]).toBe(348);
    expect(name.args[2]).toBe(152);
    const sec = calls.find((c) => c.name === 'fillText' && c.args[0] === '0.5s')!;
    expect(sec.args[1]).toBe(428);
  });

  it('shows the action even when the robot has no team number', () => {
    const anon = annotatedRobot([{ name: 'pass', t: 0 }]);
    anon.trajectory.teamNumber = '';
    paint([anon], { currentT: 0.5 });
    expect(calls.filter((c) => c.name === 'fillText' && c.args[0] === 'pass')).toHaveLength(1);
    expect(calls.filter((c) => c.name === 'arc')).toHaveLength(1);
  });
});
