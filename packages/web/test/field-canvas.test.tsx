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

    fireEvent.wheel(container.querySelector('canvas')!, { deltaY: -Math.log(2) / 0.0012 });
    paint();
    const zoomedWidth = strokeRect.mock.lastCall![2];
    expect(zoomedWidth).toBeCloseTo(400);
    resize(660, 360);
    paint();
    expect(strokeRect.mock.lastCall![2]).toBe(zoomedWidth);

    act(() => ref.current!.fit());
    paint();
    expect(strokeRect).toHaveBeenLastCalledWith(30, 30, 600, 300);
  });

});
