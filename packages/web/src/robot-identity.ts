import type { Trajectory } from '@pathblender/core';

/** Presentation only: imported route names remain intact in session data. */
export function robotIdentity(trajectory: Pick<Trajectory, 'teamNumber' | 'name' | 'displayName'>): string {
  if (trajectory.displayName?.trim()) return trajectory.displayName.trim();
  return trajectory.teamNumber ? `#${trajectory.teamNumber}` : trajectory.name;
}

/**
 * The details panel keeps the original identity rule (team number, else
 * route name) — display names never replace imported team metadata there.
 */
export function robotOriginalIdentity(trajectory: Pick<Trajectory, 'teamNumber' | 'name'>): string {
  return trajectory.teamNumber ? `#${trajectory.teamNumber}` : trajectory.name;
}

/** Bumper identity follows the session alliance; path colors stay distinct. */
export function bumperColor(alliance: 'red' | 'blue'): string {
  return alliance === 'red' ? '#c8323e' : '#2264cf';
}

/** Field labels omit the list's numeric prefix and never replace actual team metadata. */
export function robotAnnotation(trajectory: Pick<Trajectory, 'teamNumber' | 'displayName'>): string {
  return trajectory.displayName?.trim() || trajectory.teamNumber;
}
