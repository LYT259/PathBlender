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

  it('leaves Space and arrow keys to buttons and modal dialogs', () => {
    const { result } = renderHook(() => usePlayback(10));
    const ui = render(<button type="button">Import paths</button>);
    fireEvent.keyDown(screen.getByRole('button'), { code: 'Space', key: ' ' });
    fireEvent.keyDown(screen.getByRole('button'), { code: 'ArrowRight', key: 'ArrowRight' });
    expect(result.current.playing).toBe(false);
    expect(result.current.t).toBe(0);
    ui.rerender(<div role="dialog" aria-modal="true">Preferences</div>);
    fireEvent.keyDown(window, { code: 'Space', key: ' ' });
    fireEvent.keyDown(window, { code: 'ArrowRight', key: 'ArrowRight' });
    expect(result.current.playing).toBe(false);
    expect(result.current.t).toBe(0);
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
