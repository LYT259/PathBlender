import { useEffect, useRef, useState } from 'react';

/** Unified autonomous clock: play / pause / speed / scrub, looping.
 * Keyboard: Space toggles play, ←/→ scrub ±0.5 s (±2 s with Shift),
 * Home rewinds to 0. Ignored while typing in form controls.
 */
export function usePlayback(durationS: number) {
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const lastRef = useRef<number | null>(null);

  useEffect(() => {
    if (!playing || durationS <= 0) return;
    let raf = 0;
    lastRef.current = null;
    const step = (now: number) => {
      const last = lastRef.current ?? now;
      lastRef.current = now;
      const dt = (now - last) / 1000;
      setT((prev) => {
        const next = prev + dt * speed;
        return next > durationS ? 0 : next;
      });
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [playing, speed, durationS]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || el?.isContentEditable) {
        return;
      }
      if (e.code === 'Space') {
        e.preventDefault();
        setPlaying((p) => !p);
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        const step = (e.key === 'ArrowRight' ? 1 : -1) * (e.shiftKey ? 2 : 0.5);
        setT((prev) => Math.min(durationS, Math.max(0, prev + step)));
      } else if (e.key === 'Home') {
        e.preventDefault();
        setT(0);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [durationS]);

  return { t, setT, playing, setPlaying, speed, setSpeed };
}
