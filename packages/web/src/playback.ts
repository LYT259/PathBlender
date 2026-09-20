import { useCallback, useEffect, useRef, useState, type SetStateAction } from 'react';

/** Unified autonomous clock: play / pause / speed / scrub, looping.
 * Keyboard: Space toggles play, ←/→ scrub ±0.5 s (±2 s with Shift),
 * Home rewinds to 0. Interactive controls and dialogs own their keys.
 */
export function usePlayback(durationS: number) {
  const duration = Number.isFinite(durationS) ? Math.max(0, durationS) : 0;
  const [rawT, setRawT] = useState(0);
  const [wantsPlayback, setWantsPlayback] = useState(false);
  const [speed, setSpeed] = useState(1);
  const lastRef = useRef<number | null>(null);
  const t = Math.min(rawT, duration);
  const playing = wantsPlayback && duration > 0;
  const setT = useCallback((value: SetStateAction<number>) => {
    setRawT((previous) => {
      const next = typeof value === 'function' ? value(Math.min(previous, duration)) : value;
      return Number.isFinite(next) ? Math.min(duration, Math.max(0, next)) : 0;
    });
  }, [duration]);
  const setPlaying = useCallback((value: SetStateAction<boolean>) => {
    setWantsPlayback((previous) => duration > 0 && (typeof value === 'function' ? value(previous) : value));
  }, [duration]);

  useEffect(() => {
    setRawT((previous) => Math.min(previous, duration));
    if (duration === 0) setWantsPlayback(false);
  }, [duration]);

  useEffect(() => {
    if (!playing) return;
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
  }, [playing, speed, duration, setT]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target instanceof Element ? e.target : null;
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey ||
          el?.closest('input, select, textarea, button, a, summary, [role="button"], [role="slider"], [role="dialog"], dialog, [contenteditable]:not([contenteditable="false"])') ||
          document.querySelector('dialog[open], [role="dialog"][aria-modal="true"]')) {
        return;
      }
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
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [duration, setPlaying, setT]);

  return { t, setT, playing, setPlaying, speed, setSpeed };
}
