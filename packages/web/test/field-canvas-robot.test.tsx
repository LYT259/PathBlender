import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type FieldPackage, type SessionTrajectory } from '@pathblender/core';
import { FieldCanvas } from '../src/components/FieldCanvas';
import { I18nProvider } from '../src/i18n';

/**
 * 2D robot drawing regression tests (2026-10-04): the bumper ring fills
 * only its four perimeter bands (base plate stays transparent), and the
 * team number rides a Preferences-mouse-style leader callout instead of
 * the old on-rail print.
 *
 * Scene math (all asserted below): 440×240 canvas fits the 10×5 field at
 * exactly 40 px/m (center 220,120). The 2026 default robot is 35 in
 * square (0.889 m → L=W=35.56 px) with 4 in bumpers (0.1016 m → 4.064
 * px). A robot at (2, 2.5) heading 0 lands at screen (100,120); its
 * callout anchor sits at the up-right bounding-circle point
 * (100+17.78, 120-17.78) and the leader tip 20 px further out.
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

function robot(x: number, teamNumber = '11019'): SessionTrajectory {
  return {
    trajectory: {
      id: `r-${x}`,
      name: 'Route',
      teamName: 'Test team',
      teamNumber,
      source: 'ghostauto',
      alliance: 'red',
      samples: [
        { t: 0, x, y: 2.5, heading: 0, vx: 0, vy: 0, omega: 0 },
        { t: 1, x, y: 2.5, heading: 0, vx: 0, vy: 0, omega: 0 },
      ],
      durationS: 1,
      geometry: { lengthM: 0.889, widthM: 0.889, offsetX: 0, offsetY: 0 },
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

function paint(robots: SessionTrajectory[]) {
  render(
    <I18nProvider>
      <FieldCanvas field={field} robots={robots} currentT={0} conflicts={[]} bounds={[]} showTrail={false} />
    </I18nProvider>,
  );
  expect(observed).toBeDefined();
  Object.defineProperties(observed!, {
    clientWidth: { configurable: true, value: 440 },
    clientHeight: { configurable: true, value: 240 },
  });
  act(() => notifyResize());
  const pending = [...frames.values()];
  frames.clear();
  act(() => pending.forEach((callback) => callback(16)));
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

  it('draws the team number once, at a leader-line callout that stays screen-fixed', () => {
    paint([robot(2)]);
    // Leader: bounding-circle anchor (117.78,102.22) → tip 20 px further up-right.
    const strokes = paths('stroke');
    const leader = strokes.find((p) => p.length === 2 && p[0]!.name === 'moveTo' && p[1]!.name === 'lineTo');
    expect(leader).toBeDefined();
    expectArgs(leader![0]!, [117.78, 102.22]);
    expectArgs(leader![1]!, [131.9221, 88.0779]);
    expect(leader![0]!.style.lineWidth).toBe(1);
    // Anchor dot on the robot end, accent filled like the mouse diagram.
    const dot = paths('fill').find((p) => p.length === 1 && p[0]!.name === 'arc');
    expect(dot).toBeDefined();
    expectArgs(dot![0]!, [117.78, 102.22, 2.5, 0, Math.PI * 2]);
    expect(dot![0]!.style.fillStyle).toBe('#0a84ff');
    // One number (not one per side rail), left-aligned past the tip, with halo.
    const texts = calls.filter((c) => c.name === 'fillText' && c.args[0] === '11019');
    expect(texts).toHaveLength(1);
    expect(texts[0]!.args[1]).toBeCloseTo(136.9221, 4);
    expect(texts[0]!.args[2]).toBeCloseTo(88.0779, 4);
    expect(texts[0]!.style.textAlign).toBe('left');
    expect(texts[0]!.style.textBaseline).toBe('middle');
    const halos = calls.filter((c) => c.name === 'strokeText' && c.args[0] === '11019');
    expect(halos).toHaveLength(1);
  });

  it('mirrors the callout to up-left near the right canvas edge', () => {
    paint([robot(9)]);
    // cx = 220+(9−5)·40 = 380; the label would cross 440 → mirrored.
    const dot = paths('fill').find((p) => p.length === 1 && p[0]!.name === 'arc');
    expect(dot![0]!.args[0]).toBeCloseTo(362.22, 4);
    const texts = calls.filter((c) => c.name === 'fillText' && c.args[0] === '11019');
    expect(texts).toHaveLength(1);
    expect(texts[0]!.style.textAlign).toBe('right');
    expect(texts[0]!.args[1]).toBeLessThan(dot![0]!.args[0] as number);
  });

  it('draws no callout when the trajectory carries no team number', () => {
    paint([robot(2, '')]);
    expect(calls.some((c) => c.name === 'arc')).toBe(false);
    expect(calls.some((c) => (c.name === 'fillText' || c.name === 'strokeText') && c.args[0] === '')).toBe(false);
  });

  it('re-allocates the canvas backing store when devicePixelRatio changes without a resize', () => {
    const scene = (t: number) => (
      <I18nProvider>
        <FieldCanvas field={field} robots={[robot(2)]} currentT={t} conflicts={[]} bounds={[]} showTrail={false} />
      </I18nProvider>
    );
    const ui = render(scene(0));
    expect(observed).toBeDefined();
    Object.defineProperties(observed!, {
      clientWidth: { configurable: true, value: 440 },
      clientHeight: { configurable: true, value: 240 },
    });
    act(() => notifyResize());
    const runFrames = () => {
      const pending = [...frames.values()];
      frames.clear();
      act(() => pending.forEach((callback) => callback(16)));
    };
    runFrames();
    const canvas = document.querySelector('canvas')!;
    expect(canvas.width).toBe(440);
    expect(canvas.height).toBe(240);
    // Dragging the window between Retina and 1x displays changes the DPR
    // without a resize — ResizeObserver never fires. The next draw must
    // re-allocate the backing store, or the uncleared region ghosts the
    // previous frame (the "two fields" artifact, user report 2026-10-04).
    vi.stubGlobal('devicePixelRatio', 2);
    ui.rerender(scene(1));
    runFrames();
    expect(canvas.width).toBe(880);
    expect(canvas.height).toBe(480);
  });
});
