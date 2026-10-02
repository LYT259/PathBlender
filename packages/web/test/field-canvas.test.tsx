import { createRef, useState } from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type FieldPackage, type SessionTrajectory } from '@pathblender/core';
import { FieldCanvas, type FieldCanvasHandle } from '../src/components/FieldCanvas';
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

    // Integer notch → mouse-wheel curve: one ±120 event scales by
    // exp(120·0.0012) ≈ 1.155, so the fit scale of 20 px/m becomes ≈23.1.
    fireEvent.wheel(container.querySelector('canvas')!, { deltaY: -120 });
    paint();
    const zoomedWidth = strokeRect.mock.lastCall![2];
    expect(zoomedWidth).toBeCloseTo(231, 0);
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
    expect(width).toBeCloseTo(462, 0);
    expect(x).toBeLessThan(20); // zooming in pushes the left edge away
    expect(x + 0.7 * width).toBeCloseTo(300, 0);
  });

  it('anchors pinch at the centroid, softens it, and ignores post-end events', () => {
    const { container } = render(<I18nProvider><FieldCanvas {...emptyScene} /></I18nProvider>);
    resize(440, 240);
    paint();
    expect(strokeRect).toHaveBeenLastCalledWith(20, 20, 400, 200);

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
    // (per-event ln 0.049, below the end-of-gesture rate limit).
    fireEvent(canvas, gestureEvent('gesturechange', 1.05));
    fireEvent(canvas, gestureEvent('gesturechange', 1.1025));
    paint();

    // Softened total = 1.05^0.6 applied twice ≈ 1.0603.
    const [x, , width] = strokeRect.mock.lastCall!;
    expect(width).toBeCloseTo(400 * Math.pow(1.05, 1.2), 0);
    // The world point under the fingers stays at screen x=300.
    expect(x + 0.7 * width).toBeCloseTo(300, 0);

    // Release, then a lagging end-flush event arrives with a big ratio —
    // the view must freeze at the release-moment zoom (user round 3).
    fireEvent(canvas, gestureEvent('gestureend', 1.1025));
    fireEvent(canvas, gestureEvent('gesturechange', 1.8));
    paint();
    expect(strokeRect.mock.lastCall![2]).toBeCloseTo(400 * Math.pow(1.05, 1.2), 0);

    // The lift-drift scroll burst (round 4): wheel events right after the
    // pinch end are finger drift, not intent — they must not zoom either.
    fireEvent.wheel(canvas, { deltaY: -38.4 });
    fireEvent.wheel(canvas, { deltaY: -22.7 });
    paint();
    expect(strokeRect.mock.lastCall![2]).toBeCloseTo(400 * Math.pow(1.05, 1.2), 0);
  });

  it('resumes wheel zoom after the post-gesture quiet window', async () => {
    const { container } = render(<I18nProvider><FieldCanvas {...emptyScene} /></I18nProvider>);
    resize(440, 240);
    paint();
    const canvas = container.querySelector('canvas')!;
    const gestureEvent = (type: string, scale: number) => {
      const ev = new Event(type, { cancelable: true });
      Object.defineProperty(ev, 'scale', { value: scale });
      return ev;
    };
    fireEvent(canvas, gestureEvent('gesturestart', 1));
    fireEvent(canvas, gestureEvent('gesturechange', 1.05));
    fireEvent(canvas, gestureEvent('gestureend', 1.05));
    paint();

    // The quiet window is 350 ms real time; let it lapse.
    await new Promise((r) => setTimeout(r, 400));
    fireEvent.wheel(canvas, { deltaY: -120 });
    paint();
    // The gesture zoomed once (1.05^0.6), then the notch adds ×1.155.
    expect(strokeRect.mock.lastCall![2]).toBeCloseTo(400 * Math.pow(1.05, 0.6) * Math.exp(120 * 0.0012), 0);
  });

});
