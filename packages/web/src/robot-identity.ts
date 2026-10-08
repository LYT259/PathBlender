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
 * Occupancy-heatmap tint per alliance (2026-10-06): blue keeps the UI
 * accent (its original color), red pairs with the theme's system-red
 * token — the same --danger/--accent family the rest of the UI uses.
 * Tokens are injected so both the 2D canvas and the 3D scene share one
 * testable rule.
 */
export function heatmapColor(alliance: 'red' | 'blue', accent: string, danger: string): string {
  return alliance === 'red' ? danger : accent;
}

/** Field labels omit the list's numeric prefix and never replace actual team metadata. */
export function robotAnnotation(trajectory: Pick<Trajectory, 'teamNumber' | 'displayName'>): string {
  return trajectory.displayName?.trim() || trajectory.teamNumber;
}
