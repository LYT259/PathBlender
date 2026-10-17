import type { Trajectory } from '@pathblender/core';

/** Presentation only: imported route names remain intact in session data. */
export function robotIdentity(trajectory: Pick<Trajectory, 'teamNumber' | 'name' | 'displayName'>): string {
  if (trajectory.displayName?.trim()) return trajectory.displayName.trim();
  return trajectory.teamNumber || trajectory.name;
}

/**
 * The details panel keeps the original identity rule (team number, else
 * route name) — display names never replace imported team metadata there.
 * The # prefix was dropped everywhere (user request 2026-10-08): it read
 * as a chat handle, could not be typed away when renaming, and made
 * display-name robots look inconsistent next to numbered ones.
 */
export function robotOriginalIdentity(trajectory: Pick<Trajectory, 'teamNumber' | 'name'>): string {
  return trajectory.teamNumber || trajectory.name;
}

/** Bumper identity follows the session alliance; path colors stay distinct. */
export function bumperColor(alliance: 'red' | 'blue'): string {
  return alliance === 'red' ? '#c8323e' : '#2264cf';
}

/**
 * Occupancy-heatmap tint per alliance (2026-10-06). DATA color, not chrome:
 * since 2026-10-17 the pair comes from the dedicated --heatmap-blue /
 * --heatmap-red theme tokens and is fully independent of the interface
 * accent — the blue alliance's heatmap stays blue whatever accent the UI
 * wears. Tokens are injected so both the 2D canvas and the 3D scene share
 * one testable rule.
 */
export function heatmapColor(alliance: 'red' | 'blue', blue: string, red: string): string {
  return alliance === 'red' ? red : blue;
}

/** Field labels omit the list's numeric prefix and never replace actual team metadata. */
export function robotAnnotation(trajectory: Pick<Trajectory, 'teamNumber' | 'displayName'>): string {
  return trajectory.displayName?.trim() || trajectory.teamNumber;
}
