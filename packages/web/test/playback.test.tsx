import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { usePlayback } from '../src/playback';

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
