/**
 * Shared plate placement for the 2D canvas and the 3D DOM overlay — one
 * decision procedure, so a robot's card lands by the same rules in both
 * views and keeps its spot across frames by the same memory.
 *
 * Per plate, in order: the ideal spot (remembered side, or the anchor's
 * half of the viewport at first sight); the remembered anchor-relative
 * offset when the ideal spot is contested; otherwise placeLabel's search.
 * Hard obstacles (robot bodies, plates already placed this frame, reserved
 * UI) block everything. Leader corridors only steer the search for a *new*
 * spot — a plate returning to its remembered offset wins over a hairline
 * corridor overlap, because a visible jump reads far worse than a leader's
 * tail grazing a plate edge.
 *
 * The caller owns the memory map (one per live view or per export take),
 * so a stateless single-frame render simply passes none.
 */
import { placeLabel, rectsIntersect, type LayoutRect } from './callout-layout';
import { leaderGeometry, type LeaderGeometry } from './robot-label-leader';

export const ROBOT_LABEL_MARGIN = 12;
export const ROBOT_LABEL_GAP = 10;
/** Keep-clear square half-size around each anchor dot; clamped so a zoomed-in
 *  robot's plate lifts above its body instead of covering it. */
export const ANCHOR_MIN_CLEAR = 22;
export const ANCHOR_MAX_CLEAR = 260;
/** A plate taller than this fraction of the viewport folds its last action
 *  rows behind a visible "+n" count (2026-10-17: extreme stacks must not run
 *  past the canvas, and must never lose actions or countdowns silently). */
export const PLATE_MAX_H_FRACTION = 0.45;
export const PLATE_MIN_MAX_H = 132;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export interface RobotLabelMemory {
  side: 1 | -1;
  /** Plate offset from the anchor, reused while the ideal spot is contested. */
  dx: number;
  dy: number;
}

/** Obstacles accumulated while one frame places its plates in robot order. */
export interface RobotLabelFrame {
  hard: LayoutRect[];
  corridors: LayoutRect[];
}

export function anchorClearHalf(radius: number | undefined): number {
  return clamp(radius ?? ANCHOR_MIN_CLEAR, ANCHOR_MIN_CLEAR, ANCHOR_MAX_CLEAR);
}

export function anchorClearRect(anchor: { x: number; y: number }, radius: number | undefined): LayoutRect {
  const r = anchorClearHalf(radius);
  return { x: anchor.x - r, y: anchor.y - r, w: 2 * r, h: 2 * r };
}

/** Folding threshold: the gentler of 45% of the viewport and a 132px floor —
 *  but never more than the viewport can actually show, or a squeezed canvas
 *  (narrow windows wrap the toolbar/example notice) would clip folded plates
 *  again (browser finding 2026-10-17). */
export function plateHeightCap(viewportH: number): number {
  return Math.min(
    Math.max(PLATE_MIN_MAX_H, Math.round(viewportH * PLATE_MAX_H_FRACTION)),
    Math.max(60, viewportH - 2 * ROBOT_LABEL_MARGIN),
  );
}

export interface PlaceRobotLabelInput {
  anchor: { x: number; y: number };
  /** Keep-clear half-size around the anchor (see anchorClearHalf). */
  clear: number;
  size: { w: number; h: number };
  viewport: { w: number; h: number };
  remembered?: RobotLabelMemory;
  frame: RobotLabelFrame;
  /** Ghost plates draw but never block anyone (default: register). */
  register?: boolean;
}

export interface RobotLabelPlacement {
  rect: LayoutRect;
  side: 1 | -1;
  memory: RobotLabelMemory;
  leader: LeaderGeometry;
}

/** A remembered spot yields to a fresh search only when the fresh spot is
 *  this much closer to the ideal (px) — enough to leave a slot that opened
 *  up far away behind, not enough to jitter between two equal neighbors. */
export const REMEMBERED_SLACK_PX = 24;

export function placeRobotLabel(input: PlaceRobotLabelInput): RobotLabelPlacement {
  const { anchor, clear: r, size, viewport, remembered, frame } = input;
  const { w, h } = size;
  const xMin = ROBOT_LABEL_MARGIN;
  const xMax = Math.max(ROBOT_LABEL_MARGIN, viewport.w - ROBOT_LABEL_MARGIN);
  const yMin = ROBOT_LABEL_MARGIN;
  const yMax = Math.max(ROBOT_LABEL_MARGIN, viewport.h - ROBOT_LABEL_MARGIN);
  const isClear = (x: number, y: number, list: LayoutRect[]) =>
    !list.some((o) => rectsIntersect({ x, y, w, h }, o));
  const all = [...frame.hard, ...frame.corridors];

  // Side stickiness (2026-10-17 browser finding): the side is chosen once,
  // from the anchor's half at first sight, and then remembered — an orbiting
  // camera (or a mirrored alliance) walks every anchor across the midline,
  // and a plate that swapped sides there was untrackable. Only real
  // congestion (placeLabel's fallback below) may move a plate across.
  const prefer: 1 | -1 = remembered?.side ?? (anchor.x < viewport.w / 2 ? -1 : 1);
  const offset = Math.max(30, r + 8);
  const lift = Math.max(32, r + 10);
  const y0 = anchor.y - h - lift;
  const idealX = clamp(anchor.x + prefer * offset - (prefer < 0 ? w : 0), xMin, Math.max(xMin, xMax - w));
  const idealY = clamp(y0, yMin, Math.max(yMin, yMax - h));

  let placement: { x: number; y: number; side: 1 | -1 };
  if (isClear(idealX, idealY, all)) {
    placement = { x: idealX, y: idealY, side: prefer };
  } else {
    const fresh = placeLabel({ anchor, offset, size, prefer, y0, canvas: viewport,
      margin: ROBOT_LABEL_MARGIN, gap: ROBOT_LABEL_GAP, obstacles: all,
      // A card the viewer already knows slides before it swaps sides.
      stickySide: remembered !== undefined });
    const rx = remembered ? clamp(anchor.x + remembered.dx, xMin, Math.max(xMin, xMax - w)) : NaN;
    const ry = remembered ? clamp(anchor.y + remembered.dy, yMin, Math.max(yMin, yMax - h)) : NaN;
    // The remembered spot keeps the card still while the ideal is contested —
    // but not forever: a fresh spot that is clear and clearly nearer the
    // ideal wins (a 2D walkthrough found a card parked 250 px away because
    // its first-sight fallback had been frozen into memory), and a fresh
    // spot that itself overlaps something never displaces a clear one.
    const freshClear = isClear(fresh.x, fresh.y, all);
    const keepRemembered = remembered !== undefined && isClear(rx, ry, frame.hard)
      && (!freshClear || Math.hypot(rx - idealX, ry - idealY) <= Math.hypot(fresh.x - idealX, fresh.y - idealY) + REMEMBERED_SLACK_PX);
    placement = keepRemembered ? { x: rx, y: ry, side: remembered!.side } : fresh;
  }
  const rect = { x: placement.x, y: placement.y, w, h };
  const leader = leaderGeometry(anchor, rect);
  if (input.register !== false) {
    frame.hard.push(rect);
    for (const segment of leader.segments) frame.corridors.push(segment);
  }
  return {
    rect,
    side: placement.side,
    memory: { side: placement.side, dx: placement.x - anchor.x, dy: placement.y - anchor.y },
    leader,
  };
}

/** Drop memory for robots no longer in the scene (hidden, deleted, replaced). */
export function pruneRobotLabelMemory(memory: Map<string, RobotLabelMemory>, liveIds: Iterable<string>): void {
  const keep = liveIds instanceof Set ? liveIds : new Set(liveIds);
  for (const id of [...memory.keys()]) if (!keep.has(id)) memory.delete(id);
}
