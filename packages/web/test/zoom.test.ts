import { afterEach, describe, expect, it } from 'vitest';
import {
  chaseAlpha,
  chaseStep,
  CHASE_INSTANT_SHARE,
  CHASE_TAU_MS,
  classifyWheelInput,
  GESTURE_WHEEL_QUIET_MS,
  markGestureEnd,
  markGestureStart,
  orbitZoomSpeedFor,
  PINCH_EVENT_LN_CAP,
  PINCH_GAIN,
  pinchZoomFactor,
  reverseScrollZoomEnabled,
  setReverseScrollZoom,
  splitInstant,
  TRACKPAD_EVENT_CAP,
  TRACKPAD_K,
  wheelSuppressed,
  wheelZoomFactor,
  WHEEL_STEP,
} from '../src/zoom';

const PIXEL = 0; // WheelEvent.DOM_DELTA_PIXEL

afterEach(() => setReverseScrollZoom(false)); // module-level flag: reset per test

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
  it('applies Onshape\'s measured flat step per mouse notch (×1.06/event)', () => {
    // Measured against Onshape 2026-10-03: ln 0.0578 ± 0.0004 per notch
    // event; accumulation is linear in event count.
    expect(wheelZoomFactor(-120)).toBe(WHEEL_STEP);
    expect(wheelZoomFactor(120)).toBeCloseTo(1 / WHEEL_STEP, 12);
  });

  it('ignores notch magnitude like Onshape does mid-gesture', () => {
    // Onshape gives δ40, δ120 and ctrl+δ3 the same step (pixel-identical
    // views in the measurement runs); fast-scrolling mice emit ±240.
    expect(wheelZoomFactor(-40)).toBe(WHEEL_STEP);
    expect(wheelZoomFactor(-240)).toBe(WHEEL_STEP);
    expect(wheelZoomFactor(240)).toBeCloseTo(1 / WHEEL_STEP, 12);
  });

  it('zooms in for negative deltas and out for positive ones', () => {
    expect(wheelZoomFactor(-5.5)).toBeGreaterThan(1);
    expect(wheelZoomFactor(5.5)).toBeLessThan(1);
  });

  it('makes gentle trackpad swipes visible from the first events', () => {
    // δ=4 at the old shared wheel curve was a sub-0.5% no-op ("nothing
    // happens"); the trackpad curve turns it into a ~3.7% step.
    expect(wheelZoomFactor(-4)).toBeCloseTo(Math.exp(4 * TRACKPAD_K));
    expect(wheelZoomFactor(-4)).toBeGreaterThan(1.03);
    expect(Math.exp(-4 * 0.0012)).toBeLessThan(1.006); // the old behavior
  });

  it('caps momentum bursts at exactly one Onshape step per event', () => {
    // Momentum-phase trackpad deltas are large but fractional. Onshape
    // never applies more than one step per delivered event — the cap is
    // pinned to the same value.
    expect(wheelZoomFactor(400.5)).toBeCloseTo(1 / TRACKPAD_EVENT_CAP);
    expect(wheelZoomFactor(-380.25)).toBeCloseTo(TRACKPAD_EVENT_CAP);
    expect(TRACKPAD_EVENT_CAP).toBe(WHEEL_STEP);
    // Uncapped, the continuous curve would apply a ~97% step per event.
    expect(Math.exp(-400 * TRACKPAD_K)).toBeLessThan(0.05);
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
      [WHEEL_STEP, -120], // mouse notch, zoom in
      [1 / WHEEL_STEP, 120], // mouse notch, zoom out
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
    expect(orbitZoomSpeedFor(WHEEL_STEP, 120)).toBe(1);
  });
});

describe('pinchZoomFactor', () => {
  it('is neutral for identity and invalid ratios', () => {
    expect(pinchZoomFactor(1)).toBe(1);
    expect(pinchZoomFactor(0)).toBe(1);
    expect(pinchZoomFactor(Number.NaN)).toBe(1);
  });

  it('softens live per-event ratios (below the rate limit)', () => {
    // Real gesturechange streams carry tiny per-event ratios; those take
    // the raw gain. 1:1 mapping was reported as violent (user round 2).
    expect(pinchZoomFactor(1.05)).toBeCloseTo(Math.pow(1.05, PINCH_GAIN));
    expect(pinchZoomFactor(0.95)).toBeCloseTo(Math.pow(0.95, PINCH_GAIN));
  });

  it('zooms in for spreading, out for closing', () => {
    expect(pinchZoomFactor(1.05)).toBeGreaterThan(1);
    expect(pinchZoomFactor(0.95)).toBeLessThan(1);
  });

  it('rate-limits single-event ratio spikes (end-of-gesture backlog)', () => {
    // Releasing mid-pinch flushed lagging events as huge one-event ratios
    // that kept zooming after the fingers lifted (user round 3). A spike
    // may move the view at most exp(±cap·gain) ≈ ±7.5%.
    expect(pinchZoomFactor(2)).toBeCloseTo(Math.exp(PINCH_EVENT_LN_CAP * PINCH_GAIN));
    expect(pinchZoomFactor(1 / 2)).toBeCloseTo(Math.exp(-PINCH_EVENT_LN_CAP * PINCH_GAIN));
    expect(pinchZoomFactor(1.5)).toBeCloseTo(pinchZoomFactor(3)); // clamped alike
  });

  it('keeps a fast pinch total — the clamp spreads, never loses', () => {
    // A violent double-separation in ~130 ms at 60 Hz: 8 events, per-event
    // ln ratio 0.087 < cap, so the full softened total still lands.
    let factor = 1;
    for (let i = 0; i < 8; i++) factor *= pinchZoomFactor(Math.pow(2, 1 / 8));
    expect(factor).toBeCloseTo(Math.pow(2, PINCH_GAIN), 2);
  });
});

describe('wheelSuppressed (lift-drift guard)', () => {
  it('suppresses wheels during a gesture and for a quiet window after it', () => {
    // Injected clock keeps the state machine test hermetic.
    let now = 10_000;
    const t = () => now;
    markGestureStart();
    expect(wheelSuppressed(t())).toBe(true); // gesture active
    markGestureEnd(now);
    expect(wheelSuppressed(t())).toBe(true); // inside quiet window
    now += GESTURE_WHEEL_QUIET_MS - 1;
    expect(wheelSuppressed(t())).toBe(true);
    now += 2;
    expect(wheelSuppressed(t())).toBe(false); // deliberate scroll works again
  });
});

describe('zoom chase helpers', () => {
  it('chaseAlpha closes ~63% of the gap per tau and clamps negative dt', () => {
    expect(chaseAlpha(CHASE_TAU_MS)).toBeCloseTo(1 - Math.exp(-1), 6);
    expect(chaseAlpha(0)).toBe(0);
    expect(chaseAlpha(-5)).toBe(0);
  });

  it('chaseStep converges monotonically in ~5-8 tau without overshoot', () => {
    for (const start of [2, 0.5]) {
      let remaining = start;
      let frames = 0;
      while (remaining !== 1 && frames < 200) {
        const r = chaseStep(remaining, 16); // one 60 fps frame
        if (start > 1) {
          expect(r.step).toBeGreaterThan(1);
          expect(r.step).toBeLessThanOrEqual(remaining + 1e-12);
        } else {
          expect(r.step).toBeLessThan(1);
          expect(r.step).toBeGreaterThanOrEqual(remaining - 1e-12);
        }
        remaining = r.remaining;
        frames += 1;
      }
      expect(remaining).toBe(1);
      const ms = frames * 16;
      expect(ms).toBeGreaterThan(4 * CHASE_TAU_MS); // not instant
      expect(ms).toBeLessThan(12 * CHASE_TAU_MS); // not laggy
    }
  });

  it('chaseStep finishes sub-visible remainders in one frame', () => {
    expect(chaseStep(1.001, 16)).toEqual({ step: 1.001, remaining: 1 });
    expect(chaseStep(0.999, 16)).toEqual({ step: 0.999, remaining: 1 });
  });

  it('chaseStep guards degenerate remainders', () => {
    expect(chaseStep(0, 16)).toEqual({ step: 1, remaining: 1 });
    expect(chaseStep(Number.NaN, 16)).toEqual({ step: 1, remaining: 1 });
    expect(chaseStep(Number.POSITIVE_INFINITY, 16)).toEqual({ step: 1, remaining: 1 });
  });
});

describe('splitInstant', () => {
  it('composes back to the full factor', () => {
    for (const f of [2, 1.74, 1.05, 0.5, 0.93]) {
      const { instant, deferred } = splitInstant(f);
      expect(instant * deferred).toBeCloseTo(f, 12);
    }
  });

  it('splits in log space at the configured share', () => {
    const { instant } = splitInstant(2);
    expect(instant).toBeCloseTo(Math.pow(2, CHASE_INSTANT_SHARE), 12);
  });

  it('splits half instant — continuous streams glide, restored after R11 felt steppy', () => {
    // R11 set share 1 (Onshape applies zoom un-animated), but on WKWebView
    // batched gesture/scroll deliveries then read as visible steps
    // ("没有之前那么丝滑"). 0.5 = the R8-approved instant answer + glide.
    expect(CHASE_INSTANT_SHARE).toBe(0.5);
    const { instant, deferred } = splitInstant(1.74);
    expect(instant).toBeCloseTo(Math.sqrt(1.74), 12);
    expect(instant * deferred).toBeCloseTo(1.74, 12);
  });

  it('guards degenerate factors', () => {
    expect(splitInstant(0)).toEqual({ instant: 1, deferred: 1 });
    expect(splitInstant(Number.NaN)).toEqual({ instant: 1, deferred: 1 });
  });
});

describe('reverse scroll wheel zoom direction', () => {
  it('inverts mouse notches only while enabled', () => {
    expect(wheelZoomFactor(-120)).toBe(WHEEL_STEP);
    setReverseScrollZoom(true);
    expect(wheelZoomFactor(-120)).toBeCloseTo(1 / WHEEL_STEP, 12);
    expect(wheelZoomFactor(120)).toBe(WHEEL_STEP);
    setReverseScrollZoom(false);
    expect(wheelZoomFactor(-120)).toBe(WHEEL_STEP);
  });

  it('never flips the continuous trackpad curve or pinch-class input', () => {
    setReverseScrollZoom(true);
    expect(wheelZoomFactor(-4)).toBeCloseTo(Math.exp(4 * TRACKPAD_K));
    expect(wheelZoomFactor(4)).toBeCloseTo(1 / Math.exp(4 * TRACKPAD_K));
  });

  it('exposes the flag so the 3D wheel handler can route reversed input', () => {
    expect(reverseScrollZoomEnabled()).toBe(false);
    setReverseScrollZoom(true);
    expect(reverseScrollZoomEnabled()).toBe(true);
    // Reversed wheel DOWN zooms IN with the flat step; the 3D handler
    // detects this class and applies it through the pinch-dolly path
    // (OrbitControls' wheel formula cannot invert direction).
    expect(wheelZoomFactor(120)).toBe(WHEEL_STEP);
    expect(wheelZoomFactor(-120)).toBeCloseTo(1 / WHEEL_STEP, 12);
  });
});
