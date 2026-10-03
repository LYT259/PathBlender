import type { Trajectory } from '@pathblender/core';

/** Presentation only: imported route names remain intact in session data. */
export function robotIdentity(trajectory: Pick<Trajectory, 'teamNumber' | 'name'>): string {
  return trajectory.teamNumber ? `#${trajectory.teamNumber}` : trajectory.name;
}

/** Bumper identity follows the session alliance; path colors stay distinct. */
export function bumperColor(alliance: 'red' | 'blue'): string {
  return alliance === 'red' ? '#c8323e' : '#2264cf';
}
