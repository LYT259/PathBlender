import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeSession, DEFAULT_GEOMETRY, type Trajectory } from '@pathblender/core';
import { previewRouteFor, useRoutePreviewClock } from '../src/route-preview';
import { usePlayback } from '../src/playback';
const trajectory: Trajectory = { id: 'a', name: 'A', source: 'ghostauto', alliance: 'blue', teamNumber: '1234', teamName: '',
  durationS: 2, samples: [{ t: 0, x: 0, y: 0, heading: 0, vx: 1, vy: 0, omega: 0 }, { t: 2, x: 2, y: 0, heading: 0, vx: 0, vy: 0, omega: 0 }],
  geometry: DEFAULT_GEOMETRY, geometrySource: 'file', moduleLocations: [], events: [], warnings: [] };
afterEach(() => vi.unstubAllGlobals());
describe('temporary route preview', () => {
  it('keeps the saved arrangement unchanged and isolates the chosen route at time zero', () => {
    const source = { ...makeSession(trajectory), startDelayS: 6, sequence: { segments: [{ id: 'clip', routeId: 'b', waitBeforeS: 6 }] },
      routeOptions: [{ id: 'b', relPath: 'B', trajectory: { ...trajectory, id: 'b', name: 'B', durationS: 3 } }] };
    const before = JSON.stringify(source);
    const preview = previewRouteFor(source, 'b')!;
    expect(preview.trajectory.name).toBe('B'); expect(preview.sequence).toBeUndefined(); expect(preview.startDelayS).toBe(0);
    expect(JSON.stringify(source)).toBe(before);
    expect(previewRouteFor(source, 'missing')).toBeUndefined();
  });
  it('runs a separate clock and resumes the original position and play state after hover', () => {
    let id = 0; const callbacks = new Map<number, FrameRequestCallback>();
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callbacks.set(++id, callback); return id; });
    vi.stubGlobal('cancelAnimationFrame', (key: number) => callbacks.delete(key));
    const frame = (now: number) => act(() => { const queued = [...callbacks.values()]; callbacks.clear(); queued.forEach((cb) => cb(now)); });
    const robot = makeSession(trajectory);
    const { result, rerender } = renderHook(({ hover }) => ({ playback: usePlayback(20, hover), preview: useRoutePreviewClock(hover ? robot : undefined) }), { initialProps: { hover: false } });
    act(() => { result.current.playback.setT(6); result.current.playback.setPlaying(true); });
    rerender({ hover: true }); frame(1000); frame(1500);
    expect(result.current.playback.t).toBe(6); expect(result.current.preview).toBe(.5);
    rerender({ hover: false }); expect(result.current.playback.t).toBe(6); expect(result.current.playback.playing).toBe(true);
    frame(2000); frame(2500); expect(result.current.playback.t).toBe(6.5);
  });
});
