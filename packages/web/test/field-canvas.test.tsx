import { createRef, useState } from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type FieldPackage, type SessionTrajectory } from '@pathblender/core';
import { FieldCanvas, type FieldCanvasHandle } from '../src/components/FieldCanvas';
import { CHASE_INSTANT_SHARE, PINCH_GAIN, TRACKPAD_K, WHEEL_STEP } from '../src/zoom';
import { I18nProvider } from '../src/i18n';

const field: FieldPackage = { id: 'test', name: 'Test field', year: 2026, lengthM: 10, widthM: 5 };
const emptyScene = { field, robots: [], currentT: 0, conflicts: [], bounds: [] };

let observed: Element | undefined;
let notifyResize: () => void;
let frames: Map<number, FrameRequestCallback>;
const clearRect = vi.fn();
const strokeRect = vi.fn();

beforeEach(() => {
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
  clearRect.mockClear();
  strokeRect.mockClear();
  const context = new Proxy({ clearRect, strokeRect }, {
    get: (target, property) => Reflect.get(target, property) ?? (() => undefined),
    set: () => true,
  }) as unknown as CanvasRenderingContext2D;
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function resize(width: number, height: number) {
  expect(observed).toBeDefined();
  Object.defineProperties(observed!, {
    clientWidth: { configurable: true, value: width },
    clientHeight: { configurable: true, value: height },
  });
  act(() => notifyResize());
}

function paint() {
  // Execute one browser frame; callbacks scheduled by it remain pending.
  const pending = [...frames.values()];
  frames.clear();
  act(() => pending.forEach((callback) => callback(16)));
}

function pointer(canvas: HTMLCanvasElement, type: string, x: number, y: number) {
  const event = new Event(type, { bubbles: true });
  Object.defineProperties(event, {
    offsetX: { value: x }, offsetY: { value: y },
    button: { value: 0 }, pointerId: { value: 1 },
  });
  fireEvent(canvas, event);
}

describe('field canvas interaction and redraws', () => {
  it('paints changed playback positions but schedules no recurring frames while paused', () => {
    const ui = render(<I18nProvider><FieldCanvas {...emptyScene} /></I18nProvider>);
    resize(440, 240);
    paint();
    expect(clearRect).toHaveBeenCalledOnce();
    expect(frames.size).toBe(0);

    ui.rerender(<I18nProvider><FieldCanvas {...emptyScene} currentT={1} /></I18nProvider>);
    expect(frames.size).toBe(1);
    paint();
    expect(clearRect).toHaveBeenCalledTimes(2);
    expect(frames.size).toBe(0);

    ui.rerender(<I18nProvider><FieldCanvas {...emptyScene} currentT={2} /></I18nProvider>);
    ui.unmount();
    expect(frames.size).toBe(0);
  });

  it('fits resizing panels until the user zooms, then preserves zoom until Fit is requested', () => {
    const ref = createRef<FieldCanvasHandle>();
    const { container } = render(<I18nProvider><FieldCanvas {...emptyScene} ref={ref} /></I18nProvider>);
    resize(440, 240);
    paint();
    expect(strokeRect).toHaveBeenLastCalledWith(20, 20, 400, 200);

    resize(220, 120);
    paint();
    expect(strokeRect).toHaveBeenLastCalledWith(10, 10, 200, 100);

    // Integer notch → mouse-wheel curve: one ±120 event is Onshape's flat
    // ×1.06 step, so the fit scale of 20 px/m becomes 21.2.
    fireEvent.wheel(container.querySelector('canvas')!, { deltaY: -120 });
    paint();
    const zoomedWidth = strokeRect.mock.lastCall![2];
    expect(zoomedWidth).toBeCloseTo(212, 0);
    resize(660, 360);
    paint();
    expect(strokeRect.mock.lastCall![2]).toBe(zoomedWidth);

    act(() => ref.current!.fit());
    paint();
    expect(strokeRect).toHaveBeenLastCalledWith(30, 30, 600, 300);
  });

  it('anchors wheel zoom at the cursor (the world point under it stays put)', () => {
    const { container } = render(<I18nProvider><FieldCanvas {...emptyScene} /></I18nProvider>);
    resize(440, 240);
    paint();
    expect(strokeRect).toHaveBeenLastCalledWith(20, 20, 400, 200); // field spans x 20..420

    // Zoom in one notch with the cursor at screen x=300 — 70% across the
    // 10 m field (world x=7 m). After the zoom that world point must still
    // render at x=300 instead of drifting with the canvas center.
    // (offsetX/Y are not WheelEventInit members, so they must be defined
    // on the instance — same as the pointer() helper above.)
    const wheel = new WheelEvent('wheel', { deltaY: -120 });
    Object.defineProperty(wheel, 'offsetX', { value: 300 });
    Object.defineProperty(wheel, 'offsetY', { value: 120 });
    fireEvent(container.querySelector('canvas')!, wheel);
    paint();
    const [x, , width] = strokeRect.mock.lastCall!;
    expect(width).toBeCloseTo(424, 0);
    expect(x).toBeLessThan(20); // zooming in pushes the left edge away
    expect(x + 0.7 * width).toBeCloseTo(300, 0);
  });

  // The pinch chase (round 5) reads the clock via performance.now; jsdom
  // calls it for real, so a fast test sees ~0 ms frames and never settles.
  // Advance 16 ms per call to emulate a steady 60 fps.
  function steadyClock() {
    let t = 0;
    return vi.spyOn(performance, 'now').mockImplementation(() => (t += 16));
  }

  it('two-finger scroll answers instantly and glides like the pinch; a mouse notch stays instant', () => {
    const { container } = render(<I18nProvider><FieldCanvas {...emptyScene} /></I18nProvider>);
    resize(440, 240);
    paint();
    expect(strokeRect).toHaveBeenLastCalledWith(20, 20, 400, 200);
    steadyClock();
    const canvas = container.querySelector('canvas')!;

    // Fractional small delta → trackpad class. One event of δ=-4:
    // factor = exp(4·TRACKPAD_K); instant share lands on the first frame.
    const wheel = new WheelEvent('wheel', { deltaY: -4 });
    Object.defineProperty(wheel, 'offsetX', { value: 300 });
    Object.defineProperty(wheel, 'offsetY', { value: 120 });
    fireEvent(canvas, wheel);
    paint();
    const factor = Math.exp(4 * TRACKPAD_K);
    // The same paint also runs one chase frame, so the view sits between
    // the instant share and the full target — never at the old scale.
    const partial = strokeRect.mock.lastCall![2];
    expect(partial).toBeGreaterThan(400 * Math.pow(factor, CHASE_INSTANT_SHARE));
    expect(partial).toBeLessThan(400 * factor);

    // The glide completes at the centroid-anchored full target.
    for (let i = 0; i < 80; i++) paint();
    const [x, , width] = strokeRect.mock.lastCall!;
    expect(width).toBeCloseTo(400 * factor, 0);
    expect(x + 0.7 * width).toBeCloseTo(300, 0);

    // A discrete mouse notch afterwards is instant in ONE frame and
    // cancels any glide.
    fireEvent.wheel(canvas, { deltaY: -120 });
    paint();
    expect(strokeRect.mock.lastCall![2]).toBeCloseTo(400 * factor * WHEEL_STEP, 0);
    for (let i = 0; i < 4; i++) paint();
    expect(strokeRect.mock.lastCall![2]).toBeCloseTo(400 * factor * WHEEL_STEP, 0);
  });

  it('pinch answers instantly, glides to the centroid-anchored target, ignores post-end noise', () => {
    const { container } = render(<I18nProvider><FieldCanvas {...emptyScene} /></I18nProvider>);
    resize(440, 240);
    paint();
    expect(strokeRect).toHaveBeenLastCalledWith(20, 20, 400, 200);
    steadyClock();

    // GestureEvent fields are not standard init members — define them on
    // each instance. jsdom rects are 0, so clientX=300 → sx=300 (70%
    // across the 10 m field, world x=7 m).
    const gestureEvent = (type: string, scale: number, x = 300, y = 120) => {
      const ev = new Event(type, { cancelable: true });
      Object.defineProperty(ev, 'scale', { value: scale });
      Object.defineProperty(ev, 'clientX', { value: x });
      Object.defineProperty(ev, 'clientY', { value: y });
      return ev;
    };
    const canvas = container.querySelector('canvas')!;
    fireEvent(canvas, gestureEvent('gesturestart', 1));
    // A realistic stream: two small steps of +5% finger separation each
    // (per-event ln 0.049, below the end-of-gesture rate limit). Per-event
    // factor = 1.05^PINCH_GAIN; its instant share applies on arrival.
    fireEvent(canvas, gestureEvent('gesturechange', 1.05));
    fireEvent(canvas, gestureEvent('gesturechange', 1.1025));

    // Instant halves land immediately — the first drawn frame is already
    // well on its way, but still short of the full target.
    paint();
    paint();
    const partial = strokeRect.mock.lastCall![2];
    const instantTotal = Math.pow(Math.pow(1.05, PINCH_GAIN), 2 * CHASE_INSTANT_SHARE);
    const fullTarget = Math.pow(Math.pow(1.05, PINCH_GAIN), 2);
    expect(partial).toBeGreaterThan(400 * instantTotal);
    expect(partial).toBeLessThan(400 * fullTarget);

    // The chase glides the deferred remainder in and settles (~5τ).
    for (let i = 0; i < 80; i++) paint();
    const [x, , width] = strokeRect.mock.lastCall!;
    expect(width).toBeCloseTo(400 * fullTarget, 0);
    // The world point under the fingers stays at screen x=300.
    expect(x + 0.7 * width).toBeCloseTo(300, 0);

    // Release, then a lagging end-flush event arrives with a big ratio —
    // the view must freeze at the release-moment zoom (user round 3).
    fireEvent(canvas, gestureEvent('gestureend', 1.1025));
    fireEvent(canvas, gestureEvent('gesturechange', 1.8));
    // The lift-drift scroll burst (round 4): wheel events right after the
    // pinch end are finger drift, not intent — they must not zoom either.
    fireEvent.wheel(canvas, { deltaY: -38.4 });
    fireEvent.wheel(canvas, { deltaY: -22.7 });
    for (let i = 0; i < 8; i++) paint();
    expect(strokeRect.mock.lastCall![2]).toBeCloseTo(400 * Math.pow(1.05, 2 * PINCH_GAIN), 0);
  });

  it('resumes wheel zoom after the post-gesture quiet window (wheel cancels mid-chase)', async () => {
    const { container } = render(<I18nProvider><FieldCanvas {...emptyScene} /></I18nProvider>);
    resize(440, 240);
    paint();
    steadyClock();
    const canvas = container.querySelector('canvas')!;
    const gestureEvent = (type: string, scale: number) => {
      const ev = new Event(type, { cancelable: true });
      Object.defineProperty(ev, 'scale', { value: scale });
      return ev;
    };
    fireEvent(canvas, gestureEvent('gesturestart', 1));
    fireEvent(canvas, gestureEvent('gesturechange', 1.05));
    fireEvent(canvas, gestureEvent('gestureend', 1.05));
    // Let the glide land first (~5τ ≈ 270 ms of mocked time; the real app
    // runs rAF during these 400 ms).
    for (let i = 0; i < 80; i++) paint();

    // The pinch applied immediately; the quiet window still runs 350 ms of
    // real time — tick the mocked clock past it (each call advances 16 ms).
    for (let i = 0; i < 30; i++) performance.now();
    await new Promise((r) => setTimeout(r, 10));
    fireEvent.wheel(canvas, { deltaY: -120 });
    paint();
    // The gesture zoomed once (1.05^PINCH_GAIN), then the notch adds
    // Onshape's flat ×1.06 step.
    expect(strokeRect.mock.lastCall![2]).toBeCloseTo(400 * Math.pow(1.05, PINCH_GAIN) * WHEEL_STEP, 0);
  });

});

describe('zoom range limits', () => {
  it('zooms in much deeper than before (R11: Onshape-grade depth), capped at 6000 px/m', () => {
    const { container } = render(<I18nProvider><FieldCanvas {...emptyScene} /></I18nProvider>);
    resize(440, 240);
    paint();
    expect(strokeRect).toHaveBeenLastCalledWith(20, 20, 400, 200); // fit scale 40 px/m
    const canvas = container.querySelector('canvas')!;

    // Zoom IN: ×1.06 per notch needs ln(150)/ln(1.06) ≈ 86 notches to reach
    // the 6000 px/m cap — 100 must stop there (60,000 px wide), not run away.
    for (let i = 0; i < 100; i++) fireEvent.wheel(canvas, { deltaY: -120 });
    paint();
    expect(strokeRect.mock.lastCall![2]).toBeCloseTo(60000, 0);

    // The zoom-out floor is covered by the next test with a fresh fit.
  });

  it('holds the zoom-out floor exactly at the fit view (the open view)', () => {
    const ref = createRef<FieldCanvasHandle>();
    const { container } = render(<I18nProvider><FieldCanvas {...emptyScene} ref={ref} /></I18nProvider>);
    resize(440, 240);
    paint();
    act(() => ref.current!.fit());
    paint();
    const canvas = container.querySelector('canvas')!;
    for (let i = 0; i < 60; i++) fireEvent.wheel(canvas, { deltaY: 120 });
    paint();
    // The field may never shrink below how it looks on open: the floor is
    // the full fit scale (40 px/m → 400 px), not half of it (R11).
    expect(strokeRect.mock.lastCall![2]).toBeCloseTo(400, 0);
  });

  it('zooming all the way out RE-CENTRES on the fit view — no Fit press needed', () => {
    const { container } = render(<I18nProvider><FieldCanvas {...emptyScene} /></I18nProvider>);
    resize(440, 240);
    paint();
    expect(strokeRect).toHaveBeenLastCalledWith(20, 20, 400, 200);
    const canvas = container.querySelector('canvas')!;
    const wheelAt = (deltaY: number, x: number, y: number) => {
      const wheel = new WheelEvent('wheel', { deltaY });
      Object.defineProperty(wheel, 'offsetX', { value: x });
      Object.defineProperty(wheel, 'offsetY', { value: y });
      fireEvent(canvas, wheel);
    };

    // Zoom IN with the cursor off-centre: cursor anchoring keeps the world
    // point under (300, 120) fixed, so the view centre slides off the field
    // (the reported bug: this shift survived zooming back out).
    for (let i = 0; i < 5; i++) wheelAt(-120, 300, 120);
    paint();
    const zoomed = strokeRect.mock.lastCall!;
    expect(zoomed[2]).toBeGreaterThan(400); // zoomed in…
    expect(zoomed[0]).not.toBeCloseTo(20, 6); // …and pushed off-centre

    // Zoom all the way back out: hitting the floor must BE the fit view —
    // exactly what Fit / `0` produces, margins gone, no reset press needed.
    for (let i = 0; i < 60; i++) wheelAt(120, 300, 120);
    paint();
    expect(strokeRect).toHaveBeenLastCalledWith(20, 20, 400, 200);
  });
});
