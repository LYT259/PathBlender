import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePlayback } from '../src/playback';
import { playbackEnd, type PlaybackRange } from '../src/playback-range';

describe('playback clock bounds and keyboard ownership', () => {
  it('clamps after the session shrinks and stops when the final path is removed', () => {
    const { result, rerender } = renderHook(({ duration }) => usePlayback(duration), { initialProps: { duration: 10 } });
    act(() => {
      result.current.setT(9);
      result.current.setPlaying(true);
    });
    rerender({ duration: 4 });
    expect(result.current.t).toBe(4);
    rerender({ duration: 0 });
    expect(result.current.t).toBe(0);
    expect(result.current.playing).toBe(false);
    rerender({ duration: 10 });
    expect(result.current.playing).toBe(false);
    expect(result.current.t).toBe(0);
  });

  it('never starts a zero-duration session and rejects out-of-range seek values', () => {
    const { result, rerender } = renderHook(({ duration }) => usePlayback(duration), { initialProps: { duration: 0 } });
    act(() => result.current.setPlaying(true));
    fireEvent.keyDown(window, { code: 'Space', key: ' ' });
    expect(result.current.playing).toBe(false);
    rerender({ duration: 5 });
    act(() => result.current.setT(20));
    expect(result.current.t).toBe(5);
    act(() => result.current.setT(-2));
    expect(result.current.t).toBe(0);
    act(() => result.current.setT(Number.NaN));
    expect(result.current.t).toBe(0);
  });

  it('lets the playhead park beyond the transport end up to the scrub max, while replay loops at the end', () => {
    // Composer case: composed end 6.22 s, whole auto axis 20 s scrubbable.
    const { result, rerender } = renderHook(
      ({ duration, scrubMax }) => usePlayback(duration, false, scrubMax),
      { initialProps: { duration: 6.22, scrubMax: 20 } },
    );
    act(() => result.current.setT(15));
    expect(result.current.t).toBe(15);
    // Adding a clip (duration grows) must not yank the parked playhead.
    rerender({ duration: 13, scrubMax: 20 });
    expect(result.current.t).toBe(15);
    // Arrow keys scrub to the axis max, End still jumps to the range end.
    fireEvent.keyDown(window, { key: 'ArrowRight', code: 'ArrowRight', shiftKey: true });
    expect(result.current.t).toBe(17);
    fireEvent.keyDown(window, { key: 'End', code: 'End' });
    expect(result.current.t).toBe(13);
    // Closing the composer shrinks the scrub max — the playhead comes back.
    rerender({ duration: 13, scrubMax: 13 });
    expect(result.current.t).toBe(13);
    // Playing from a parked position STARTS AT 0 (user 2026-10-08): the
    // parked playhead gates the library; Play means run the arrangement,
    // which begins at the beginning. (Re-open the axis first — closed, the
    // scrub max itself clamps the park.)
    rerender({ duration: 13, scrubMax: 20 });
    act(() => result.current.setT(15));
    act(() => result.current.setPlaying(true));
    expect(result.current.playing).toBe(true);
    expect(result.current.t).toBe(0);
    // A duration shrinking under a RUNNING clock clamps in place — it does
    // not restart the arrangement (no new play transition fires).
    act(() => result.current.setT(10));
    rerender({ duration: 6.22, scrubMax: 6.22 });
    expect(result.current.t).toBe(6.22);
    expect(result.current.playing).toBe(true);
  });

  it('leaves Space to the focused button, scrubs from button focus, and dialogs block all', () => {
    const { result } = renderHook(() => usePlayback(10));
    const ui = render(<button type="button">Import paths</button>);
    const button = screen.getByRole('button');
    // Space activates the focused button — never play/pause.
    fireEvent.keyDown(button, { code: 'Space', key: ' ' });
    expect(result.current.playing).toBe(false);
    // Scrub keys cannot activate anything, so they work from button focus.
    fireEvent.keyDown(button, { code: 'ArrowRight', key: 'ArrowRight' });
    expect(result.current.t).toBe(0.5);
    ui.rerender(<div role="dialog" aria-modal="true">Preferences</div>);
    fireEvent.keyDown(window, { code: 'Space', key: ' ' });
    fireEvent.keyDown(window, { code: 'ArrowRight', key: 'ArrowRight' });
    expect(result.current.t).toBe(0.5);
  });

  it('does not toggle repeatedly while Space is held; explicit scrubbing pauses', () => {
    const { result } = renderHook(() => usePlayback(10));
    fireEvent.keyDown(window, { code: 'Space', key: ' ' });
    expect(result.current.playing).toBe(true);
    fireEvent.keyDown(window, { code: 'Space', key: ' ', repeat: true });
    expect(result.current.playing).toBe(true);
    fireEvent.keyDown(window, { code: 'ArrowRight', key: 'ArrowRight', shiftKey: true });
    expect(result.current.t).toBe(2);
    expect(result.current.playing).toBe(false);
    fireEvent.keyDown(window, { code: 'Home', key: 'Home' });
    expect(result.current.t).toBe(0);
  });
});

describe('playback speed scaling (regression: 0.25x must slow the clock)', () => {
  // Manual rAF pump: wall clock advances in exact 60 fps steps so the
  // path-time advance is deterministic (no real timers involved).
  let rafCallbacks: Map<number, FrameRequestCallback>;
  let rafId = 0;
  let now = 0;

  beforeEach(() => {
    rafCallbacks = new Map();
    rafId = 0;
    now = 0;
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      rafId += 1;
      rafCallbacks.set(rafId, cb);
      return rafId;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => {
      rafCallbacks.delete(id);
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const pump = (wallMs: number, frameMs = 1000 / 60) => {
    const frames = Math.round(wallMs / frameMs);
    for (let i = 0; i < frames; i += 1) {
      now += frameMs;
      const batch = [...rafCallbacks.values()];
      rafCallbacks.clear();
      act(() => {
        for (const cb of batch) cb(now);
      });
    }
  };

  it('0.25x advances ~0.75 path seconds in 3 wall seconds', () => {
    const { result } = renderHook(() => usePlayback(20));
    act(() => {
      result.current.setSpeed(0.25);
      result.current.setPlaying(true);
    });
    pump(3000);
    expect(result.current.t).toBeGreaterThan(0.6);
    expect(result.current.t).toBeLessThan(0.9);
  });

  it('switching speed mid-play rescales the running clock', () => {
    const { result } = renderHook(() => usePlayback(20));
    act(() => result.current.setPlaying(true));
    pump(1000); // 1 s at 1x
    expect(result.current.t).toBeGreaterThan(0.8);
    expect(result.current.t).toBeLessThan(1.2);
    act(() => result.current.setSpeed(0.25));
    const before = result.current.t;
    pump(3000);
    const advanced = result.current.t - before;
    expect(advanced).toBeGreaterThan(0.6);
    expect(advanced).toBeLessThan(0.9);
  });

  it('plays the remaining idle time in full mode and loops only the paths in path mode', () => {
    const { result, rerender } = renderHook(({ range }: { range: PlaybackRange }) => usePlayback(playbackEnd(8, 20, range)), { initialProps: { range: 'full' as PlaybackRange } });
    act(() => result.current.setPlaying(true));
    pump(10000);
    expect(result.current.t).toBeGreaterThan(9.9);
    pump(10500);
    expect(result.current.t).toBeLessThan(0.6);
    rerender({ range: 'paths' });
    act(() => result.current.setT(0));
    pump(8500);
    expect(result.current.t).toBeLessThan(0.6);
  });

});
