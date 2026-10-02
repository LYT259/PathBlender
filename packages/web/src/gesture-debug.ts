/**
 * TEMPORARY pinch diagnostic (zoom round 3, 2026-10-02) — REMOVE once the
 * end-of-gesture jump is settled.
 *
 * WKWebView gesture events cannot be synthesized from tooling on this
 * machine, so when the user reports "releasing mid-pinch zooms further",
 * the real event stream is the only admissible evidence (protocol facts
 * are settled by real samples, not documentation memory). Every gesture
 * is recorded and the last one's summary is shown in a one-line strip in
 * the bottom-left corner; the full sample list also lands on
 * `window.__pbGestureTrace` for deeper dumps.
 */

export interface GestureSample {
  t: number;
  phase: 'start' | 'change' | 'end';
  scale: number;
}

let samples: GestureSample[] = [];
let ended = false;

/** Pure summary of one gesture's sample list → single diagnostic line. */
export function gestureSummary(list: GestureSample[]): string {
  const changes = list.filter((s) => s.phase === 'change');
  const firstEnd = list.findIndex((s) => s.phase === 'end');
  const postEnd = firstEnd === -1 ? 0 : changes.filter((c) => list.indexOf(c) > firstEnd).length;
  let maxLn = 0;
  let prev = 0;
  for (const c of changes) {
    if (prev > 0 && c.scale > 0) maxLn = Math.max(maxLn, Math.abs(Math.log(c.scale / prev)));
    prev = c.scale;
  }
  const dur =
    changes.length >= 2 && changes[0] && changes.at(-1)
      ? ((changes.at(-1)!.t - changes[0].t) / 1000).toFixed(1)
      : '0.0';
  const last = changes.at(-1);
  const lastScale = last ? last.scale.toFixed(2) : '—';
  return `n=${changes.length} maxΔln=${maxLn.toFixed(2)} dur=${dur}s end=${lastScale} postEnd=${postEnd}`;
}

function render(summary: string) {
  let panel = document.querySelector<HTMLDivElement>('#pb-gesture-debug');
  if (!panel) {
    panel = document.createElement('div');
    panel.id = 'pb-gesture-debug';
    panel.style.cssText =
      'position:fixed;left:8px;bottom:8px;z-index:99999;pointer-events:none;' +
      'font:11px ui-monospace,monospace;color:#fff;background:rgba(0,0,0,.55);' +
      'padding:2px 6px;border-radius:4px;';
    document.body.appendChild(panel);
  }
  panel.textContent = `[gesture-debug] ${summary}`;
}

export function noteGesture(phase: 'start' | 'change' | 'end', scale: number): void {
  if (phase === 'start') {
    samples = [];
    ended = false;
    postEndWheels = 0;
    postEndWheelDelta = 0;
  }
  if (phase === 'end') ended = true;
  samples.push({ t: performance.now(), phase, scale });
  (window as unknown as { __pbGestureTrace?: GestureSample[] }).__pbGestureTrace = [...samples];
  render(gestureSummary(samples));
}

// Round 4: the jump after release turned out to be the scroll burst macOS
// emits as lifting fingers drift across the glass — invisible to the
// gesture-only strip above. Count wheels (and their δY) arriving after
// gestureend to confirm the mechanism live.
let postEndWheels = 0;
let postEndWheelDelta = 0;

export function notePostEndWheel(deltaY: number): void {
  if (!ended) return;
  postEndWheels += 1;
  postEndWheelDelta += deltaY;
  const suffix = ` wheels=${postEndWheels} ΣδY=${postEndWheelDelta.toFixed(0)}`;
  render(gestureSummary(samples) + suffix);
}

/** Whether the current gesture has ended (stray late events are ignored). */
export function gestureEnded(): boolean {
  return ended;
}
