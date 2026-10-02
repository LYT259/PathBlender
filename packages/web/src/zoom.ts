/**
 * Device-aware wheel-to-zoom mapping shared by the 2D and 3D field views
 * (Onshape-style, user request 2026-10-02).
 *
 * macOS trackpads emit high-frequency wheel events with small *fractional*
 * pixel deltas; mouse wheels emit discrete integer notches (±40/±120 on
 * WKWebView). One curve cannot serve both: a coefficient tuned for a
 * ±120 notch turned trackpad swipes into "nothing… then explosion" once
 * momentum-phase deltas arrived in the hundreds. So each event is
 * classified first and scaled with its own curve:
 *
 * - mouse wheel — stepped feel, ≈13% per ±120 notch (the 2D feel users
 *   already approved);
 * - trackpad — a ~3.3× more sensitive continuous curve so a gentle swipe
 *   is visible from the first events, with a per-event cap so momentum
 *   bursts cannot compound exponentially.
 *
 * Chrome-family browsers deliver pinch as wheel+ctrlKey; those deltas are
 * fractional, so they naturally take the trackpad curve. WKWebView pinch
 * arrives as gesture* events, which the views handle separately.
 */

export type WheelInputKind = 'trackpad' | 'wheel';

/** Integer deltas at or above this magnitude are mouse-wheel notches. */
const WHEEL_MIN_NOTCH = 24;

/** Log-zoom per pixel of mouse-wheel delta: exp(120·0.0012) ≈ 1.155/notch. */
export const WHEEL_K = 0.0012;

/**
 * Log-zoom per pixel of trackpad delta. Tunable (user to confirm on real
 * hardware, 2026-10-02): 0.004 makes a δ=4 event a visible ~1.6% step at
 * ~60 events/s; the old shared 0.0012 gave a sub-0.5% no-op instead.
 */
export const TRACKPAD_K = 0.004;

/**
 * Per-event factor cap for continuous input. Momentum bursts carry |δ| in
 * the hundreds; uncapped exp(δ·k) compounds into a 10× jump within a
 * second. The cap keeps each event at most ±8%.
 */
export const TRACKPAD_EVENT_CAP = 1.08;

/**
 * Pinch softening (user feedback round 2, 2026-10-02): WebKit gesture
 * events report the raw finger-separation ratio, and applying it 1:1 made
 * a small pinch feel violent. The per-event factor is the ratio raised to
 * this gain instead: doubling the finger separation zooms 2^0.6 ≈ 1.52×.
 * Tunable — single constant, pending user trial.
 */
export const PINCH_GAIN = 0.6;

/**
 * Per-event log-ratio rate limit for pinch (user feedback round 3): on
 * release, WKWebView flushes lagging gesturechange events whose single
 * ratios are far larger than any live per-frame finger motion — the view
 * then jumps *further* in the gesture's direction ("松手后进一步放大").
 * Real gestures move ≤ ~0.08 per frame even at their fastest; anything
 * beyond this cap in ONE event is end-of-gesture backlog, rate-limited
 * here. Multiplicative, so a genuine fast pinch only spreads over the
 * following frames — nothing is lost, only the per-frame jump is bounded
 * (≤ ~7.5% per event after the gain).
 */
export const PINCH_EVENT_LN_CAP = 0.12;

/** Zoom factor for one gesturechange step (ratio = scale / lastScale). */
export function pinchZoomFactor(ratio: number): number {
  if (!Number.isFinite(ratio) || ratio <= 0) return 1;
  const ln = Math.min(PINCH_EVENT_LN_CAP, Math.max(-PINCH_EVENT_LN_CAP, Math.log(ratio)));
  return Math.exp(ln * PINCH_GAIN);
}

/**
 * Wheel suppression around WebKit pinches (user round 4, video evidence
 * 2026-10-02): the diagnostic strip showed clean gesture streams
 * (maxΔln ≈ 0.03-0.05, postEnd = 0) while the view still jumped after
 * release — the gesture events are innocent. The remaining zoom source
 * is the *scroll* burst macOS emits as lifting fingers drift across the
 * glass at the end of a pinch: those wheel events keep dollying the
 * view in the gesture's direction right after release. Wheel-driven
 * zoom/rotate is suppressed while a gesture runs and for this long
 * after it ends; a deliberate scroll or mouse wheel half a second later
 * is unaffected.
 */
export const GESTURE_WHEEL_QUIET_MS = 350;

let gestureActive = false;
let suppressWheelUntil = 0;

export function markGestureStart(): void {
  gestureActive = true;
}

export function markGestureEnd(now: number = performance.now()): void {
  gestureActive = false;
  suppressWheelUntil = now + GESTURE_WHEEL_QUIET_MS;
}

/** True while a pinch runs and briefly after it ends (lift-drift guard). */
export function wheelSuppressed(now = performance.now()): boolean {
  return gestureActive || now < suppressWheelUntil;
}

export function classifyWheelInput(deltaY: number, deltaMode: number): WheelInputKind {
  if (deltaMode !== WheelEvent.DOM_DELTA_PIXEL) return 'wheel'; // line/page modes
  return Math.abs(deltaY) >= WHEEL_MIN_NOTCH && Number.isInteger(deltaY) ? 'wheel' : 'trackpad';
}

/**
 * Multiplicative zoom factor for one wheel event: >1 zooms in (δ<0),
 * <1 zooms out (δ>0), 1 is neutral.
 */
export function wheelZoomFactor(deltaY: number, deltaMode: number = WheelEvent.DOM_DELTA_PIXEL): number {
  if (deltaY === 0) return 1;
  const trackpad = classifyWheelInput(deltaY, deltaMode) === 'trackpad';
  const factor = Math.exp(-deltaY * (trackpad ? TRACKPAD_K : WHEEL_K));
  if (!trackpad) return factor;
  return Math.min(TRACKPAD_EVENT_CAP, Math.max(1 / TRACKPAD_EVENT_CAP, factor));
}

/**
 * OrbitControls (three 0.185) scales the camera radius by
 * exp(K_OC · zoomSpeed · δY) per wheel event (K_OC = -ln(0.95)/100): the
 * sign of δY picks dolly in/out, zoomSpeed sets the magnitude via its
 * `Math.pow(0.95, zoomSpeed·|δ·0.01|)`. Solve for the zoomSpeed that makes
 * it apply exactly `1/factor` (radius shrinks when we zoom in), so the
 * shared curve rides OrbitControls' damping, distance clamps and
 * zoom-to-cursor instead of reimplementing them. Degenerate inputs fall
 * back to the default speed of 1.
 */
const K_OC = -Math.log(0.95) / 100;

export function orbitZoomSpeedFor(factor: number, deltaY: number): number {
  if (deltaY === 0 || !Number.isFinite(factor) || factor <= 0 || factor === 1) return 1;
  const speed = -Math.log(factor) / (K_OC * deltaY);
  // factor and deltaY always share their zoom direction, so speed > 0;
  // anything else is a caller bug — fall back rather than invert the zoom.
  return speed > 0 ? Math.min(32, speed) : 1;
}
