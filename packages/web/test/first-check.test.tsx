import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { detectCollisions, detectFieldBounds, deserializeSession, serializeSession } from '@pathblender/core';
import { createFirstCheck, delayPracticeB, isFirstCheckSession, PRACTICE_B_ID, PRACTICE_FIELD } from '../src/first-check';
import { App } from '../src/App';

beforeEach(() => localStorage.clear());

describe('synthetic first check', () => {
  it('has exactly one A/B crossing, no bounds violations, and no real team identity', () => {
    const robots = createFirstCheck();
    expect(isFirstCheckSession(robots)).toBe(true);
    expect(robots.map((r) => r.trajectory.teamNumber)).toEqual(['A', 'B', 'C']);
    expect(robots.map((r) => r.trajectory.samples.length)).toEqual([61, 61, 61]);
    const hits = detectCollisions(robots);
    expect(hits).toHaveLength(1);
    expect(new Set([hits[0]!.aId, hits[0]!.bId])).toEqual(new Set(['first-check-a', PRACTICE_B_ID]));
    expect(hits[0]!.closestT).toBeCloseTo(3, 1);
    expect(hits[0]!.minCenterDistanceM).toBeCloseTo(0, 5);
    expect(detectFieldBounds(robots, PRACTICE_FIELD)).toEqual([]);
  });

  it('changes session timing without changing samples and survives session save/open', () => {
    const original = createFirstCheck();
    const snapshot = structuredClone(original);
    const changed = delayPracticeB(original);
    expect(original).toEqual(snapshot);
    expect(changed[1]!.startDelayS).toBe(2);
    expect(changed[1]!.trajectory).toBe(original[1]!.trajectory);
    expect(changed[0]).toBe(original[0]);
    expect(changed[2]).toBe(original[2]);
    expect(detectCollisions(changed)).toEqual([]);
    expect(detectFieldBounds(changed, PRACTICE_FIELD)).toEqual([]);
    // Existing session serialization is the only persistence mechanism.
    const restored = deserializeSession(serializeSession(changed, PRACTICE_FIELD.id, PRACTICE_FIELD));
    expect(isFirstCheckSession(restored.robots)).toBe(true);
    expect(detectCollisions(restored.robots)).toEqual([]);
    expect(restored.robots[1]!.startDelayS).toBe(2);
  });

  it('does not claim an imported/missing/additional robot is the teaching session', () => {
    const robots = createFirstCheck();
    expect(isFirstCheckSession(robots.slice(0, 2))).toBe(false);
    expect(isFirstCheckSession([...robots, robots[0]!])).toBe(false);
    expect(isFirstCheckSession([robots[0]!, robots[0]!, robots[2]!])).toBe(false);
  });

  it('runs the real app workflow, undoing and redoing the timing change', async () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Try your first path check' }));
    const guide = screen.getByRole('complementary', { name: 'Your first path check' });
    expect(screen.getByRole('button', { name: 'Play', exact: true })).toBeInTheDocument();
    expect(document.querySelector('.conflict-count')?.textContent).toBe('1');
    fireEvent.click(within(guide).getByRole('button', { name: 'Play the routes' }));
    fireEvent.click(within(guide).getByRole('button', { name: 'Show the conflict' }));
    expect(Number((screen.getByRole('slider', { name: 'Playback position' }) as HTMLInputElement).value)).toBeCloseTo(3, 1);
    fireEvent.click(within(guide).getByRole('button', { name: 'Start B two seconds later' }));
    await waitFor(() => expect(document.querySelector('.conflict-count')?.textContent).toBe('0'));
    expect(within(guide).getByText(/current check finds no collisions/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Undo/ }));
    expect(document.querySelector('.conflict-count')?.textContent).toBe('1');
    expect(within(guide).queryByText(/current check finds no collisions/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Redo/ }));
    expect(document.querySelector('.conflict-count')?.textContent).toBe('0');
    const visibility = document.querySelector('.robot-library-visibility')!;
    fireEvent.click(visibility);
    expect(within(guide).queryByText(/current check finds no collisions/)).not.toBeInTheDocument();
    expect(within(guide).getByText(/current plan still needs checking/)).toBeInTheDocument();
    fireEvent.click(visibility);
    expect(within(guide).getByText(/current check finds no collisions/)).toBeInTheDocument();
    fireEvent.click(within(guide).getByRole('button', { name: 'Restart this exercise' }));
    expect(document.querySelector('.conflict-count')?.textContent).toBe('1');
    fireEvent.click(within(guide).getByRole('button', { name: 'End practice' }));
    expect(screen.getByRole('button', { name: 'Import path files' })).toBeInTheDocument();
  });
});
