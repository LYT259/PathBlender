import { act, fireEvent, render, renderHook, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_GEOMETRY, serializeSession, makeSession } from '@pathblender/core';
import { playbackEnd, timelineScale, usePlaybackRange } from '../src/playback-range';
import { App } from '../src/App';

beforeEach(() => localStorage.clear());
const scene = () => makeSession({ id: 'range-test', name: 'Eight seconds', teamName: '', teamNumber: '254', source: 'choreo-traj', alliance: 'blue', durationS: 8,
  samples: [0, 8].map((t) => ({ t, x: 1 + t, y: 1, heading: 0, vx: 1, vy: 0, omega: 0 })),
  geometry: DEFAULT_GEOMETRY, geometrySource: 'default', moduleLocations: [], events: [], warnings: [],
});

describe('playback range', () => {
  it('defaults to the full timeline and remembers an explicit path-only choice', () => {
    const first = renderHook(() => usePlaybackRange());
    expect(first.result.current[0]).toBe('full');
    act(() => first.result.current[1]('paths'));
    first.unmount();
    const next = renderHook(() => usePlaybackRange());
    expect(next.result.current[0]).toBe('paths');
  });
  it('covers the season while keeping empty scenes idle and respecting longer paths', () => {
    expect(playbackEnd(8, 20, 'full')).toBe(20);
    expect(playbackEnd(8, 20, 'paths')).toBe(8);
    expect(playbackEnd(8, 15, 'full')).toBe(15);
    expect(playbackEnd(0, 20, 'full')).toBe(0);
    expect(playbackEnd(24, 20, 'full')).toBe(24);
    expect(playbackEnd(8.37, 20, 'paths')).toBe(8.37);
  });
  it('does not squeeze a shorter tick interval at the right edge of long paths', () => {
    const { axisMax, tickStep } = timelineScale(20.4, 20);
    expect(axisMax).toBeGreaterThanOrEqual(20.4);
    expect(axisMax % tickStep).toBe(0);
    expect(timelineScale(8, 20)).toEqual({ axisMax: 20, tickStep: 1 });
  });
  it('uses the selected range for scrubbing, the clock, End and relaunch', () => {
    localStorage.setItem('pb.autosave.v1', serializeSession([scene()], 'rebuilt-2026'));
    const app = render(<App />);
    const range = screen.getByRole('combobox', { name: 'Playback range' });
    const slider = screen.getByRole('slider', { name: 'Playback position' });
    expect(range).toHaveValue('full');
    // 'Full timeline' carries no seconds suffix (user request 2026-10-04);
    // the path-only option keeps its duration.
    const labels = within(range).getAllByRole('option').map((o) => o.textContent);
    expect(labels[0]).toBe('Full timeline');
    expect(labels[1]).toMatch(/^Current paths · /);
    fireEvent.change(slider, { target: { value: 14 } });
    expect(slider).toHaveValue('14');
    expect(slider).toHaveAttribute('aria-valuetext', '14.00 / 20.00 s');
    fireEvent.keyDown(slider, { key: 'End' });
    expect(slider).toHaveValue('20');
    fireEvent.change(range, { target: { value: 'paths' } });
    expect(slider).toHaveValue('8');
    expect(slider).toHaveAttribute('aria-valuetext', '8.00 / 8.00 s');
    app.unmount();
    render(<App />);
    expect(screen.getByRole('combobox', { name: 'Playback range' })).toHaveValue('paths');
  });
});
