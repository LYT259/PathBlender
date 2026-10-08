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
  it("loops the 'All visible paths' range at the longest visible duration as visibility changes", () => {
    // Bug report 2026-10-05: paths of 4/3/3 s — hiding the 4 s robot must
    // drop the path-only loop end to 3 s. Full timeline keeps the whole
    // session extent, and collision checks are unaffected (they always run
    // on the visible set independently).
    const long = scene(); // 8 s, 254
    const shortRobot = { ...scene().trajectory, id: 'short-one', name: 'Short one', teamNumber: '2265', durationS: 3, samples: [0, 3].map((t) => ({ t, x: 1 + t, y: 1, heading: 0, vx: 1, vy: 0, omega: 0 })) };
    const short = { ...scene(), trajectory: shortRobot };
    localStorage.setItem('pb.autosave.v1', serializeSession([long, short], 'rebuilt-2026'));
    const app = render(<App />);
    const slider = screen.getByRole('slider', { name: 'Playback position' });
    fireEvent.change(screen.getByRole('combobox', { name: 'Playback range' }), { target: { value: 'paths' } });
    expect(slider).toHaveAttribute('aria-valuetext', '0.00 / 8.00 s');
    // Hide the longest robot: the loop end follows the longest VISIBLE one.
    fireEvent.click(screen.getByRole('button', { name: 'Hide 254 on field' }));
    expect(slider).toHaveAttribute('aria-valuetext', '0.00 / 3.00 s');
    expect(slider).toHaveValue('0'); // the playhead stays put, only the end moves
    // The clock display follows; the option label names the visible set
    // without a duration (2026-10-05): "All visible paths".
    expect(screen.getByRole('option', { name: 'All visible paths' })).toBeInTheDocument();
    // Show it again mid-session: the end comes back.
    fireEvent.click(screen.getByRole('button', { name: 'Show 254 on field' }));
    expect(slider).toHaveAttribute('aria-valuetext', '0.00 / 8.00 s');
    // Hide everything: playback is safely idle (end 0, transport disabled).
    fireEvent.click(screen.getByRole('button', { name: 'Hide 254 on field' }));
    fireEvent.click(screen.getByRole('button', { name: 'Hide 2265 on field' }));
    expect(slider).toHaveAttribute('aria-valuetext', '0.00 / 0.00 s');
    expect(screen.getByRole('button', { name: 'Play', exact: true })).toBeDisabled();
    app.unmount();
  });

  it('uses the selected range for scrubbing, the clock, End and relaunch', () => {
    localStorage.setItem('pb.autosave.v1', serializeSession([scene()], 'rebuilt-2026'));
    const app = render(<App />);
    const range = screen.getByRole('combobox', { name: 'Playback range' });
    const slider = screen.getByRole('slider', { name: 'Playback position' });
    expect(range).toHaveValue('full');
    // 'Full timeline' carries no seconds suffix (user request 2026-10-04);
    // the path-only option names the visible set, also without one.
    const labels = within(range).getAllByRole('option').map((o) => o.textContent);
    expect(labels[0]).toBe('Full timeline');
    expect(labels[1]).toBe('All visible paths');
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
