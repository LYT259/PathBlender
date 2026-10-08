import { useCallback, useEffect, useRef, useState, type SetStateAction } from 'react';
import { PLAYBACK_SPEEDS } from './components/PlaybackControls';

/** Unified autonomous clock: play / pause / speed / scrub, looping.
 * Keyboard: Space toggles play, ←/→ scrub ±0.5 s (±2 s with Shift),
 * Home rewinds to 0. Interactive controls and dialogs own their keys.
 *
 * `durationS` is the transport end — where playing loops and End jumps.
 * `scrubMaxS` (default: the duration) is how far the playhead may be
 * PLACED: the composer opens it to the whole auto axis so the playhead can
 * park in empty future time and gate the route library there (user
 * 2026-10-08), while replay stays confined to the chosen playback range. */
export function usePlayback(durationS: number, suspended = false, scrubMaxS = durationS) {
  const duration = Number.isFinite(durationS) ? Math.max(0, durationS) : 0;
  const scrubMax = Number.isFinite(scrubMaxS) ? Math.max(duration, scrubMaxS) : duration;
  const [rawT, setRawT] = useState(0);
  const [wantsPlayback, setWantsPlayback] = useState(false);
  const [speed, setSpeed] = useState(1);
  const lastRef = useRef<number | null>(null);
  const t = Math.min(rawT, scrubMax);
  const playing = wantsPlayback && duration > 0;
  const setT = useCallback((value: SetStateAction<number>) => {
    setRawT((previous) => {
      const next = typeof value === 'function' ? value(Math.min(previous, scrubMax)) : value;
      return Number.isFinite(next) ? Math.min(scrubMax, Math.max(0, next)) : 0;
    });
  }, [scrubMax]);
  const setPlaying = useCallback((value: SetStateAction<boolean>) => {
    setWantsPlayback((previous) => duration > 0 && (typeof value === 'function' ? value(previous) : value));
  }, [duration]);

  useEffect(() => {
    setRawT((previous) => Math.min(previous, scrubMax));
    if (duration === 0) setWantsPlayback(false);
  }, [duration, scrubMax]);

  useEffect(() => {
    if (!playing || suspended) return;
    let raf = 0;
    lastRef.current = null;
    const step = (now: number) => {
      const last = lastRef.current ?? now;
      lastRef.current = now;
      const dt = (now - last) / 1000;
      setT((prev) => {
        const next = prev + dt * speed;
        return next > duration ? 0 : next;
      });
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [playing, speed, duration, setT, suspended]);

  // One step through the same speed list the transport buttons render.
  // Mode changes are single-shot: held keys must not cycle the speeds.
  const stepSpeed = useCallback((dir: number) => {
    setSpeed((s) => {
      const idx = PLAYBACK_SPEEDS.indexOf(s);
      const base = idx < 0 ? PLAYBACK_SPEEDS.indexOf(1) : idx;
      return PLAYBACK_SPEEDS[Math.min(PLAYBACK_SPEEDS.length - 1, Math.max(0, base + dir))] ?? s;
    });
  }, [setSpeed]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target instanceof Element ? e.target : null;
      if (suspended || e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey ||
          el?.closest('input, select, textarea, [role="slider"], [role="dialog"], dialog, [contenteditable]:not([contenteditable="false"])') ||
          document.querySelector('dialog[open], [role="dialog"][aria-modal="true"]')) {
        return;
      }
      // Space activates the focused button/link, so it never doubles as
      // play/pause; scrub/step keys cannot activate anything and work from
      // button focus too (2026-10-07: keyboard pass review).
      if (e.code === 'Space' && el?.closest('button, a, summary, [role="button"]')) return;
      if (e.code === 'Space') {
        if (duration === 0 || e.repeat) return;
        e.preventDefault();
        setPlaying((p) => !p);
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        const step = (e.key === 'ArrowRight' ? 1 : -1) * (e.shiftKey ? 2 : 0.5);
        setPlaying(false);
        setT((prev) => prev + step);
      } else if (e.key === 'Home') {
        e.preventDefault();
        setPlaying(false);
        setT(0);
      } else if (e.key === 'End') {
        // Jump to the range end — one shot per press (a jump, not a scrub).
        if (duration === 0 || e.repeat) return;
        e.preventDefault();
        setPlaying(false);
        setT(duration);
      } else if (e.code === 'Comma' && e.shiftKey && !e.repeat) {
        e.preventDefault();
        stepSpeed(-1);
      } else if (e.code === 'Period' && e.shiftKey && !e.repeat) {
        e.preventDefault();
        stepSpeed(1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [duration, setPlaying, setT, suspended, stepSpeed]);

  return { t, setT, playing, setPlaying, speed, setSpeed };
}
