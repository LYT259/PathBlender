import { describe, expect, it } from 'vitest';
import {
  classifyWheelInput,
  orbitZoomSpeedFor,
  TRACKPAD_EVENT_CAP,
  TRACKPAD_K,
  WHEEL_K,
  wheelZoomFactor,
} from '../src/zoom';

const PIXEL = 0; // WheelEvent.DOM_DELTA_PIXEL

describe('classifyWheelInput', () => {
  it('treats integer notch-sized pixel deltas as mouse wheel', () => {
    expect(classifyWheelInput(-120, PIXEL)).toBe('wheel');
    expect(classifyWheelInput(40, PIXEL)).toBe('wheel');
    expect(classifyWheelInput(-240, PIXEL)).toBe('wheel');
  });

  it('treats fractional or small pixel deltas as trackpad', () => {
    expect(classifyWheelInput(-3.6475, PIXEL)).toBe('trackpad'); // slow swipe
    expect(classifyWheelInput(2, PIXEL)).toBe('trackpad'); // small integer
    expect(classifyWheelInput(-58.2, PIXEL)).toBe('trackpad'); // momentum burst
  });

  it('treats line/page delta modes as wheel regardless of value', () => {
    expect(classifyWheelInput(-3, 1)).toBe('wheel');
    expect(classifyWheelInput(-3, 2)).toBe('wheel');
  });
});

describe('wheelZoomFactor', () => {
  it('keeps the approved mouse-wheel notch step (≈13% per ±120)', () => {
    expect(wheelZoomFactor(-120)).toBeCloseTo(Math.exp(120 * WHEEL_K));
    expect(wheelZoomFactor(-120)).toBeCloseTo(1.155, 3);
    expect(wheelZoomFactor(120)).toBeCloseTo(1 / 1.155, 3);
  });

  it('zooms in for negative deltas and out for positive ones', () => {
    expect(wheelZoomFactor(-5.5)).toBeGreaterThan(1);
    expect(wheelZoomFactor(5.5)).toBeLessThan(1);
  });

  it('makes gentle trackpad swipes visible from the first events', () => {
    // δ=4 at the old wheel curve was a sub-0.5% no-op ("nothing happens");
    // the trackpad curve turns it into a ~1.6% step.
    expect(wheelZoomFactor(-4)).toBeCloseTo(Math.exp(4 * TRACKPAD_K));
    expect(wheelZoomFactor(-4)).toBeGreaterThan(1.015);
    expect(Math.exp(-4 * 0.0012)).toBeLessThan(1.006); // the old behavior
  });

  it('caps momentum bursts per event so zoom cannot explode', () => {
    // Momentum-phase trackpad deltas are large but fractional.
    expect(wheelZoomFactor(400.5)).toBeCloseTo(1 / TRACKPAD_EVENT_CAP);
    expect(wheelZoomFactor(-380.25)).toBeCloseTo(TRACKPAD_EVENT_CAP);
    // Uncapped, the continuous curve would apply an 80% step per event.
    expect(Math.exp(-400 * TRACKPAD_K)).toBeLessThan(0.25);
  });

  it('is neutral for zero delta', () => {
    expect(wheelZoomFactor(0)).toBe(1);
  });
});

describe('orbitZoomSpeedFor', () => {
  const K_OC = -Math.log(0.95) / 100;

  it('reproduces the requested zoom through the OrbitControls radius formula', () => {
    // OrbitControls scales the camera radius by exp(K_OC·zoomSpeed·δY);
    // our zoom factor f means a radius factor of 1/f.
    const cases: [factor: number, deltaY: number][] = [
      [Math.exp(120 * WHEEL_K), -120], // mouse notch, zoom in
      [Math.exp(-120 * WHEEL_K), 120], // mouse notch, zoom out
      [Math.exp(5.5 * TRACKPAD_K), -5.5], // trackpad swipe in
      [1 / TRACKPAD_EVENT_CAP, 400], // capped momentum burst, zoom out
    ];
    for (const [factor, deltaY] of cases) {
      const speed = orbitZoomSpeedFor(factor, deltaY);
      expect(speed).toBeGreaterThan(0);
      expect(Math.exp(K_OC * speed * deltaY)).toBeCloseTo(1 / factor, 6);
    }
  });

  it('falls back to the default speed for degenerate inputs', () => {
    expect(orbitZoomSpeedFor(1, 0)).toBe(1);
    expect(orbitZoomSpeedFor(1, -120)).toBe(1);
    expect(orbitZoomSpeedFor(0, 100)).toBe(1);
    expect(orbitZoomSpeedFor(Number.NaN, 100)).toBe(1);
    // A factor pointing against the delta's direction must never invert
    // the zoom — fall back instead.
    expect(orbitZoomSpeedFor(1.155, 120)).toBe(1);
  });
});
