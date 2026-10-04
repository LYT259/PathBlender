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
 * exactly 40 px/m (center 220,120). The 2026 default robot is 35 in square
 * (0.889 m → L=W=35.56 px, bounding radius reach=25.1433 px) with 4 in
 * bumpers (0.1016 m → 4.064 px). A robot at (2, 2.5) heading 0 lands at
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

const styleKeys = ['fillStyle', 'strokeStyle', 'lineWidth', 'textAlign', 'textBaseline'] as const;

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

function makeScene(robots: SessionTrajectory[], t = 0) {
  return (
    <I18nProvider>
      <FieldCanvas field={field} robots={robots} currentT={t} conflicts={[]} bounds={[]} showTrail={false} />
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

function paint(robots: SessionTrajectory[]) {
  render(makeScene(robots));
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
  it('fills only the four bumper bands with the alliance color, never the base plate', () => {
    paint([robot(2)]);
    const fills = paths('fill');
    const bands = fills.find((p) => p.length === 4 && p.every((c) => c.name === 'rect'));
    expect(bands).toBeDefined();
    const [top, bottom, left, right] = bands!;
    expectArgs(top!, [-17.78, -17.78, 35.56, 4.064]);
    expectArgs(bottom!, [-17.78, 13.716, 35.56, 4.064]);
    expectArgs(left!, [-17.78, -13.716, 4.064, 27.432]);
    expectArgs(right!, [13.716, -13.716, 4.064, 27.432]);
    for (const band of bands!) expect(band.style.fillStyle).toBe('#c8323e');
    // The full 35.56×35.56 outline is stroked (collision footprint), never filled.
    const filled = fills.some((p) =>
      p.some((c) => c.name === 'rect' && Math.abs((c.args[2] as number) - 35.56) < 1e-6 && Math.abs((c.args[3] as number) - 35.56) < 1e-6));
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
