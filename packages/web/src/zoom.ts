/**
 * Device-aware wheel-to-zoom mapping shared by the 2D and 3D field views,
 * calibrated against Onshape by direct measurement (2026-10-03).
 *
 * Measurement setup: identical synthetic wheel events dispatched to a public
 * Onshape document and to this app in headless Chrome; zoom factors recovered
 * from cursor-anchored gradient-profile registration of screenshots
 * (self-check refit z=1.0000/ncc=1.0; every notch-class figure below agreed
 * to ≤0.4% across 20+ independent probes over two sessions).
 *
 * Measured Onshape model:
 * - one notch (δ=±120) zooms ×1.06 (ln 0.0578 ± 0.0004) — accumulation is
 *   exactly linear in event count (1/2/5/10-event runs land on N×0.0578) and
 *   δ magnitude is IGNORED during gestures (bursts of δ3 and δ10 produce
 *   pixel-identical views; isolated δ40 = δ120);
 * - ctrl+wheel (Chromium's pinch encoding) prices the same full step per
 *   event regardless of δ;
 * - application is instant (full step visible in a same-frame screenshot)
 *   with no animation, no momentum, and rate-independent totals.
 *
 * macOS trackpads emit high-frequency wheel events with small *fractional*
 * pixel deltas; mouse wheels emit discrete integer notches (±40/±120 on
 * WKWebView). Onshape's flat per-event step is only sane because Chrome
 * coalesces wheel delivery on its busy CAD page (~half the raw cadence);
 * our (much lighter) page sees nearly the full ~60 Hz stream, so the
 * trackpad class prices per unit δ instead — Σδ is invariant under
 * coalescing — with the per-event cap landing exactly on Onshape's flat
 * step. Wheel listeners also cannot distinguish a pinch (ctrl+wheel) from a
 * scroll on Chromium, so that stream takes the trackpad curve.
 * WKWebView pinch arrives as gesture* events, which the views handle
 * separately.
 */

export type WheelInputKind = 'trackpad' | 'wheel';

/** Integer deltas at or above this magnitude are mouse-wheel notches. */
const WHEEL_MIN_NOTCH = 24;

/**
 * Onshape's per-event wheel step, measured 2026-10-03 (ln 0.0578 ≈ ×1.06).
 * Constant per event — not proportional to δ: Onshape gives δ40, δ120 and
 * ctrl+δ3 all the same step, and ignores δ magnitude entirely mid-gesture.
 */
export const WHEEL_STEP = 1.06;

/**
 * Log-zoom per pixel of trackpad delta. Onshape prices every delivered
 * event at ×1.06; on its busy CAD page Chrome coalesces real trackpad
 * streams to roughly half cadence, which works out to ≈0.009 per δ of
 * continuous scroll (≈×4 per second of scrolling). 0.004 (2026-10-02
 * first cut) was ~2.3× shy of that.
 */
export const TRACKPAD_K = 0.009;

/**
 * Per-event factor cap for continuous input — pinned to Onshape's flat
 * per-event step. Momentum bursts carry |δ| in the hundreds; uncapped
 * exp(δ·k) compounds into a 10× jump within a second, and Onshape itself
 * never applies more than one step per event.
 */
export const TRACKPAD_EVENT_CAP = 1.06;

/**
 * Pinch softening (user feedback round 2, 2026-10-02): WebKit gesture
 * events report the raw finger-separation ratio, and applying it 1:1 made
 * a small pinch feel violent. The per-event factor is the ratio raised to
 * this gain instead. Raised 0.6 → 0.8 (user round 7: "one swipe should
 * zoom in more"): doubling the finger separation now zooms 2^0.8 ≈ 1.74×.
 * Tunable — single constant, pending user trial.
 */
export const PINCH_GAIN = 0.8;

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

/**
 * Zoom chase smoothing for the CONTINUOUS streams (pinch, two-finger
 * scroll): each event applies this fraction immediately and a rAF loop
 * glides the remainder (τ = 80 ms below). Onshape applies even wheel
 * events with zero animation (measured 2026-10-03) and R11 shipped a
 * share of 1 — but on WKWebView the gesture/touch streams arrive in
 * main-thread-congested batches, so full-instant application reads as
 * visible steps: the user called it "没有之前那么丝滑" (2026-10-03).
 * 0.5 is the R8-approved feel — an immediate visible response with a
 * short glide tail merging the batches. Discrete mouse notches bypass
 * this entirely (instant, crisp).
 */
export const CHASE_TAU_MS = 80;

export const CHASE_INSTANT_SHARE = 0.5;

/**
 * Split one pinch factor into the instant part and the deferred part
 * (log space): instant = factor^share, deferred = factor^(1-share);
 * instant · deferred === factor.
 */
export function splitInstant(factor: number, share: number = CHASE_INSTANT_SHARE): { instant: number; deferred: number } {
  if (!Number.isFinite(factor) || factor <= 0) return { instant: 1, deferred: 1 };
  return { instant: Math.pow(factor, share), deferred: Math.pow(factor, 1 - share) };
}

/** Exponential approach: fraction of the remaining gap closed in `dt` ms. */
export function chaseAlpha(dt: number, tau: number = CHASE_TAU_MS): number {
  return 1 - Math.exp(-Math.max(0, dt) / tau);
}

/**
 * Split a remaining multiplicative zoom into the step to apply this frame
 * and what remains after it (log-space exponential approach), so a pinch
 * converges to its target over ~5τ regardless of how the events batched.
 */
export function chaseStep(remaining: number, dt: number, tau: number = CHASE_TAU_MS): { step: number; remaining: number } {
  if (!Number.isFinite(remaining) || remaining <= 0) return { step: 1, remaining: 1 };
  const step = Math.pow(remaining, chaseAlpha(dt, tau));
  const next = remaining / step;
  // Settle: below ~0.2% the gap is invisible; finish it in one frame.
  if (Math.abs(Math.log(next)) < 0.002) return { step: remaining, remaining: 1 };
  return { step, remaining: next };
}

export function classifyWheelInput(deltaY: number, deltaMode: number): WheelInputKind {
  if (deltaMode !== WheelEvent.DOM_DELTA_PIXEL) return 'wheel'; // line/page modes
  return Math.abs(deltaY) >= WHEEL_MIN_NOTCH && Number.isInteger(deltaY) ? 'wheel' : 'trackpad';
}

/**
 * Multiplicative zoom factor for one wheel event: >1 zooms in (δ<0),
 * <1 zooms out (δ>0), 1 is neutral. Mouse notches take Onshape's flat
 * per-event step (δ magnitude ignored, measured 2026-10-03); trackpad
 * events are priced per unit δ and capped at the same step.
 */
export function wheelZoomFactor(deltaY: number, deltaMode: number = WheelEvent.DOM_DELTA_PIXEL): number {
  if (deltaY === 0) return 1;
  const trackpad = classifyWheelInput(deltaY, deltaMode) === 'trackpad';
  if (!trackpad) return deltaY < 0 ? WHEEL_STEP : 1 / WHEEL_STEP;
  const factor = Math.exp(-deltaY * TRACKPAD_K);
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
