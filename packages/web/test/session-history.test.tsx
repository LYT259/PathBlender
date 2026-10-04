import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_GEOMETRY, type SessionTrajectory } from '@pathblender/core';
import { useSessionHistory } from '../src/session-history';

function robotAt(x: number): SessionTrajectory {
  return {
    startDelayS: 0, visible: true, color: '#007aff',
    trajectory: {
      id: 'robot', name: 'Robot', teamName: '', teamNumber: '',
      source: 'choreo-traj', alliance: 'blue', durationS: 0,
      samples: [{ t: 0, x, y: 1, heading: 0, vx: 0, vy: 0, omega: 0 }],
      geometry: DEFAULT_GEOMETRY, geometrySource: 'default', moduleLocations: [], events: [], warnings: [],
    },
  };
}

afterEach(() => vi.useRealTimers());

describe('waypoint edit history', () => {
  it('undoes a whole drag including pauses, while keeping consecutive drags separate', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useSessionHistory({ id: 'rebuilt-2026', variant: 'welded', style: 'schematic' }));
    const x = () => result.current.robots[0]!.trajectory.samples[0]!.x;
    act(() => result.current.setRobots([robotAt(1)]));

    act(() => result.current.beginEdit());
    act(() => result.current.setRobots([robotAt(2)]));
    act(() => vi.advanceTimersByTime(2000));
    act(() => result.current.setRobots([robotAt(3)]));
    act(() => result.current.endEdit());

    // A second drag starts immediately; it must still be its own undo step.
    act(() => result.current.beginEdit());
    act(() => result.current.setRobots([robotAt(4)]));
    act(() => result.current.setRobots([robotAt(5)]));
    act(() => result.current.endEdit());

    act(() => result.current.undo());
    expect(x()).toBe(3);
    act(() => result.current.undo());
    expect(x()).toBe(1);
    act(() => result.current.redo());
    expect(x()).toBe(3);
    act(() => result.current.redo());
    expect(x()).toBe(5);
    expect(result.current.canRedo).toBe(false);
  });
});
