import type { SessionRouteOption } from '@pathblender/core';
import { sequenceRows, type AutoSequenceSegment } from './auto-sequence-state';

/**
 * Arrangement-timeline placement arithmetic (red book v1.38/v1.39): route
 * blocks keep their imported duration, and their absolute start time is the
 * only thing the user moves. Waits are the gaps that fall out of the block
 * boundaries — never rounded, never stretched. Presentation arithmetic only;
 * the production sequence state lives on the robot and is owned by App.
 */
export interface TimelineClip { id: string; routeId: string; startS: number; durationS: number }

/** The composer's view of a composition: one clip per resolvable segment, on the global clock. */
export function clipsFor(segments: AutoSequenceSegment[], routes: SessionRouteOption[]): TimelineClip[] {
  return sequenceRows(segments, routes).map((row) => ({
    id: row.id,
    routeId: row.routeId,
    startS: row.startS,
    durationS: row.route.trajectory.durationS,
  }));
}

/**
 * Sorted absolute placement → segment waits. The first wait is the start
 * delay; every later wait is the exact gap to the previous block's end.
 * Clips are already non-overlapping (canPlaceClip), so waits are ≥ 0 and
 * the arithmetic is exact — imported durations and seam times are preserved
 * bit-for-bit rather than rounded.
 */
export function segmentsFromClips(clips: readonly TimelineClip[]): AutoSequenceSegment[] {
  const sorted = [...clips].sort((a, b) => a.startS - b.startS);
  let previousEndS = 0;
  return sorted.map((clip) => {
    const segment = { id: clip.id, routeId: clip.routeId, waitBeforeS: clip.startS - previousEndS };
    previousEndS = clip.startS + clip.durationS;
    return segment;
  });
}

export function canPlaceClip(clips: TimelineClip[], clip: TimelineClip, limitS = Infinity): boolean {
  return Number.isFinite(clip.startS) && clip.startS >= 0 && Number.isFinite(clip.durationS) && clip.durationS > 0
    && clip.startS + clip.durationS <= limitS + 1e-9
    && clips.every((other) => other.id === clip.id || clip.startS >= other.startS + other.durationS || clip.startS + clip.durationS <= other.startS);
}

export function placeClip(clips: TimelineClip[], clip: TimelineClip, limitS = Infinity): TimelineClip[] | null {
  return canPlaceClip(clips, clip, limitS) ? [...clips.filter((other) => other.id !== clip.id), clip].sort((a, b) => a.startS - b.startS) : null;
}

/**
 * Semantic equality of two arrangements: the same routes at the same absolute
 * start times, compared on the timeline (order-independent — segment arrays
 * that sort to the same placement play identically). Durations ride the route
 * reference, so (routeId, startS) within a microsecond is the whole story —
 * far below the 0.1 s pointer grid, far above double representation noise;
 * moving a clip away and back to its saved time is NOT a change. Draft ids
 * never matter — the saved arrangement regenerates them.
 */
export function sameClipLayout(a: readonly TimelineClip[], b: readonly TimelineClip[]): boolean {
  if (a.length !== b.length) return false;
  const byStart = (clips: readonly TimelineClip[]) => [...clips].sort((x, y) => x.startS - y.startS || x.routeId.localeCompare(y.routeId));
  const sa = byStart(a);
  const sb = byStart(b);
  return sa.every((clip, i) => clip.routeId === sb[i]!.routeId && Math.abs(clip.startS - sb[i]!.startS) <= 1e-6);
}

/** Snap to exact neighbouring boundaries before the 0.1 s pointer grid.
 * Imported durations are never rounded or stretched. */
export function snapClipStart(raw: number, clips: TimelineClip[], clip: TimelineClip, toleranceS: number): number {
  const boundaries = [0, ...clips.filter((other) => other.id !== clip.id).flatMap((other) => [other.startS + other.durationS, other.startS - clip.durationS])].filter((s) => s >= 0);
  const nearest = boundaries.sort((a, b) => Math.abs(a - raw) - Math.abs(b - raw))[0]!;
  return Math.abs(nearest - raw) <= toleranceS ? nearest : Math.max(0, Math.round(raw * 10) / 10);
}

/** Clamp the whole imported route inside the season, without shortening it. */
export function boundedClipStart(raw: number, clips: TimelineClip[], clip: TimelineClip, toleranceS: number, limitS: number): number {
  const end = Math.max(0, limitS - clip.durationS);
  const snapped = snapClipStart(raw, clips, clip, toleranceS);
  return Math.min(end, Math.max(0, snapped));
}

/** Adjacent gaps use the moving clip, not its stale saved position. */
export function clipGaps(clips: TimelineClip[], moving: TimelineClip): { fromS: number; toS: number; side: 'previous' | 'next' }[] {
  const sorted = [...clips.filter((clip) => clip.id !== moving.id), moving].sort((a, b) => a.startS - b.startS);
  const index = sorted.indexOf(moving);
  const previous = sorted[index - 1];
  const next = sorted[index + 1];
  return [
    ...(previous ? [{ fromS: previous.startS + previous.durationS, toS: moving.startS, side: 'previous' as const }] : []),
    ...(next ? [{ fromS: moving.startS + moving.durationS, toS: next.startS, side: 'next' as const }] : []),
  ];
}
