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
 * screen (100,120). Labels now use one content-sized card per robot;
 * tests assert the anchor, visibility, colors and complete content rather
 * than pinning the superseded two-badge pixel layout.
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
  /** Stable id across rerenders (cross-frame memory keys on it). */
  id?: string;
}

function robot(x: number, teamNumber = '11019', opts: RobotOpts = {}): SessionTrajectory {
  const heading = opts.heading ?? 0;
  const y = opts.y ?? 2.5;
  return {
    trajectory: {
      id: opts.id ?? `r-${x}`,
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

function sizeWrap(w = 440, h = 240) {
  expect(observed).toBeDefined();
  Object.defineProperties(observed!, {
    clientWidth: { configurable: true, value: w },
    clientHeight: { configurable: true, value: h },
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

/** Match one leader with either a direct stroke or a short elbow. */
function leaderIndex() {
  const idx = calls.findIndex((c, i) => {
    if (c.name !== 'moveTo' || calls[i + 1]?.name !== 'lineTo') return false;
    let end = i + 1;
    while (calls[end]?.name === 'lineTo') end++;
    return calls[end]?.name === 'stroke' && calls[end + 1]?.name === 'stroke';
  });
  expect(idx).toBeGreaterThanOrEqual(0);
  return idx;
}

function plate() {
  const rects = calls.filter(c => c.name === 'roundRect');
  expect(rects).toHaveLength(1);
  const [x, y, w, h] = rects[0]!.args as number[];
  expect(x).toBeGreaterThanOrEqual(12);
  expect(y).toBeGreaterThanOrEqual(12);
  expect(x! + w!).toBeLessThanOrEqual(428);
  expect(y! + h!).toBeLessThanOrEqual(228);
  return { x: x!, y: y!, w: w!, h: h! };
}

function text(value: string) {
  const found = calls.find(c => c.name === 'fillText' && c.args[0] === value);
  expect(found, value).toBeDefined();
  return found!;
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

  it('anchors one leader at the footprint center with an opaque compact card', () => {
    paint([robot(2)]);
    const li = leaderIndex();
    expectArgs(calls[li]!, [100, 120]);
    const strokes = calls.slice(li).filter(c => c.name === 'stroke');
    expect(strokes[0]!.style.strokeStyle).toBe('#ffffff');
    expect(strokes[0]!.style.lineWidth).toBe(4.5);
    expect(strokes[1]!.style.strokeStyle).toBe('#c8323e');
    expect(strokes[1]!.style.lineWidth).toBe(1.5);
    expectArgs(dotFill().arc, [100, 120, 3, 0, Math.PI * 2]);
    const box = plate();
    const number = text('11019');
    expect(number.args[1] as number).toBeGreaterThan(box.x);
    expect(number.args[1] as number).toBeLessThan(box.x + box.w);
    expect(number.style.fillStyle).toBe('#c8323e');
    expect(calls.some(c => c.name === 'strokeText')).toBe(false);
  });

  it('keeps a right-edge robot card inside the viewport', () => {
    paint([robot(9)]);
    expectArgs(dotFill().arc, [380, 120, 3, 0, Math.PI * 2]);
    expectArgs(calls[leaderIndex()]!, [380, 120]);
    plate();
    expect(text('11019').style.fillStyle).toBe('#c8323e');
  });

  it('keeps a top-edge robot card inside the viewport', () => {
    paint([robot(9.9, '11019', { y: 4.9 })]);
    plate();
    expectArgs(calls[leaderIndex()]!, [416, 24]);
    expectArgs(dotFill().arc, [416, 24, 3, 0, Math.PI * 2]);
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
    expect(calls.slice(li).filter(c => c.name === 'stroke')[1]!.style.strokeStyle).toBe('#2264cf');
    const texts = calls.filter((c) => c.name === 'fillText' && c.args[0] === '11019');
    expect(texts[0]!.style.fillStyle).toBe('#2264cf');
  });


  it('draws one callout per robot when several share the field', () => {
    paint([robot(2), robot(6, '2468')]);
    expect(calls.filter((c) => c.name === 'fillText' && c.args[0] === '11019')).toHaveLength(1);
    expect(calls.filter((c) => c.name === 'fillText' && c.args[0] === '2468')).toHaveLength(1);
    expect(calls.filter((c) => c.name === 'arc')).toHaveLength(4); // anchor + route-color dot per robot
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

  it('uses the route name when a robot has no team number, matching 3D', () => {
    paint([robot(2, '')]);
    plate();
    text('Route');
    expect(calls.some(c => c.name === 'fillText' && c.args[0] === '')).toBe(false);
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

describe('current actions in the unified card', () => {
  function annotatedRobot(events: { name: string; t: number }[], x = 2): SessionTrajectory {
    const r = robot(x);
    r.trajectory.events = events;
    return r;
  }

  it('keeps an identity-only card for robots without annotations', () => {
    paint([robot(2)], { currentT: 1 });
    plate();
    text('11019');
    expect(calls.filter(c => c.name === 'fillText')).toHaveLength(2); // identity + field clock
  });

  it('does not invent active actions at t=0, even with t=0 markers', () => {
    paint([annotatedRobot([{ name: 'intake', t: 0 }])], { currentT: 0 });
    plate();
    expect(calls.some(c => c.name === 'fillText' && c.args[0] === 'intake')).toBe(false);
  });

  it('does not show an action before its first marker fires', () => {
    paint([annotatedRobot([{ name: 'intake', t: .5 }])], { currentT: .49 });
    plate();
    expect(calls.some(c => c.name === 'fillText' && c.args[0] === 'intake')).toBe(false);
  });

  it('shows the fired action and countdown below identity in one card', () => {
    paint([annotatedRobot([{ name: 'intake', t: .5 }])], { currentT: .5 });
    const box = plate();
    expectArgs(calls[leaderIndex()]!, [100, 120]);
    const name = text('intake');
    const seconds = text('0.5');
    expect(name.args[2] as number).toBeGreaterThan(text('11019').args[2] as number);
    expect(seconds.args[1] as number).toBeGreaterThan(name.args[1] as number);
    expect(seconds.args[2]).toBe(name.args[2]);
    expect(name.style.fillStyle).toBe('#181617');
    expect(seconds.args[1] as number).toBeLessThan(box.x + box.w);
  });

  it('shows same-mechanism takeover: shoot replaces pre_aim', () => {
    const r = annotatedRobot([{ name: 'pre_aim', t: .3 }, { name: 'shoot', t: .7 }]);
    const ui = render(makeScene([r], .4));
    sizeWrap(); runFrames();
    text('pre_aim'); text('0.3');
    calls = [];
    ui.rerender(makeScene([r], .8)); runFrames();
    text('shoot'); text('0.2');
    expect(calls.some(c => c.name === 'fillText' && c.args[0] === 'pre_aim')).toBe(false);
  });

  it('shows same-ending actions on separate lines with one countdown', () => {
    paint([annotatedRobot([{ name: 'intake', t: 0 }, { name: 'pass', t: 0 }, { name: 'align', t: 0 }])], { currentT: .5 });
    plate();
    const y = ['intake', 'pass', 'align'].map(name => text(name).args[2] as number);
    expect(y[0]).toBeLessThan(y[1]!);
    expect(y[1]).toBeLessThan(y[2]!);
    expect(calls.filter(c => c.name === 'fillText' && c.args[0] === '0.5')).toHaveLength(1);
    expect(text('0.5').args[2]).toBe(y[0]);
    expect(calls.filter(c => c.name === 'arc')).toHaveLength(2); // one anchor, one route-color dot
  });

  it('orders distinct endings soonest-first inside the same card', () => {
    paint([annotatedRobot([{ name: 'intake', t: 0 }, { name: 'close_blocker', t: 0 }])], { currentT: .5 });
    plate();
    expect(text('intake').args[2] as number).toBeLessThan(text('close_blocker').args[2] as number);
    expect(text('0.5').args[2]).toBe(text('intake').args[2]);
    expect(text('1.5').args[2]).toBe(text('close_blocker').args[2]);
  });

  it('keeps identity and actions together near the right canvas edge', () => {
    paint([annotatedRobot([{ name: 'shoot', t: 0 }], 9)], { currentT: .5 });
    const box = plate();
    for (const name of ['11019', 'shoot', '0.5']) {
      expect(text(name).args[1] as number).toBeGreaterThan(box.x);
      expect(text(name).args[1] as number).toBeLessThan(box.x + box.w);
    }
  });

  it('shows route identity and action even when the robot has no team number', () => {
    const r = annotatedRobot([{ name: 'pass', t: 0 }]);
    r.trajectory.teamNumber = '';
    paint([r], { currentT: .5 });
    plate(); text('Route'); text('pass');
  });

  it('keeps the card on its first side while the robot crosses the canvas midline between frames', () => {
    // 10 m field on a 440 px canvas: x = 4.9 m lands at screen 216 (left half),
    // x = 5.3 m at 232 (right half). Without memory the card would flip to the
    // right at the second frame; the live canvas remembers the side.
    const ui = render(makeScene([robot(4.9, '11019', { id: 'mover' })], .5));
    sizeWrap(); runFrames();
    const first = plate();
    expect(first.x + first.w).toBeLessThanOrEqual(216);
    calls = [];
    ui.rerender(makeScene([robot(5.3, '11019', { id: 'mover' })], .5)); runFrames();
    const second = plate();
    expect(second.x + second.w).toBeLessThanOrEqual(232);
    // The anchor dot really did move to the right half.
    expectArgs(calls[leaderIndex()]!, [232, 120]);
  });

  it('folds action rows behind the localized "+n more" count on a canvas too short for the card', () => {
    // 70 px tall: the folding cap bottoms out at 60 px. Identity (30 px card)
    // plus one three-line group (81 px) cannot fit, so every row folds and the
    // UI-language count names all three — nothing is dropped silently.
    render(makeScene([annotatedRobot([{ name: 'intake', t: 0 }, { name: 'pass', t: 0 }, { name: 'align', t: 0 }])], .5));
    sizeWrap(440, 70); runFrames();
    text('11019');
    text('+3 more');
    for (const name of ['intake', 'pass', 'align']) {
      expect(calls.some(c => c.name === 'fillText' && c.args[0] === name), name).toBe(false);
    }
    expect(calls.some(c => c.name === 'fillText' && c.args[0] === '0.5')).toBe(false); // folded countdown goes with its rows
    const [, y, , h] = calls.find(c => c.name === 'roundRect')!.args as number[];
    expect(y! + h!).toBeLessThanOrEqual(70);
  });
});
