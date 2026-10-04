import { useState } from 'react';

export type PlaybackRange = 'full' | 'paths';
const KEY = 'pb.playbackRange';
const finiteDuration = (value: number) => Number.isFinite(value) ? Math.max(0, value) : 0;

/** A shared, evenly divided domain for tracks, ruler and full-range playback. */
export function timelineScale(pathDuration: number, autoPeriodS: number) {
  const minimum = Math.max(1, finiteDuration(autoPeriodS), finiteDuration(pathDuration));
  const tickStep = Math.max(1, Math.ceil(minimum / 20));
  const axisMax = Math.ceil(minimum / tickStep) * tickStep;
  return { axisMax, tickStep };
}

export function playbackEnd(pathDuration: number, autoPeriodS: number, range: PlaybackRange): number {
  const duration = finiteDuration(pathDuration);
  return duration === 0 ? 0 : range === 'full' ? timelineScale(duration, autoPeriodS).axisMax : duration;
}

/** Full timeline on first use; subsequent launches retain the user's choice. */
export function usePlaybackRange() {
  const [range, setRange] = useState<PlaybackRange>(() => {
    try { return localStorage.getItem(KEY) === 'paths' ? 'paths' : 'full'; } catch { return 'full'; }
  });
  const update = (value: PlaybackRange) => {
    setRange(value);
    try { localStorage.setItem(KEY, value); } catch { /* Storage is optional. */ }
  };
  return [range, update] as const;
}
