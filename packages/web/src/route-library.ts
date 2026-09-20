/**
 * Route/profile library: the session-scoped pool of everything imported so
 * far. Robots point into it (SessionTrajectory.routeId); the per-robot
 * picker lets users flip between autos and watch the fusion update.
 */

import { makeSession } from '@pathblender/core';
import type { RobotProfile, SessionTrajectory, Trajectory } from '@pathblender/core';

export interface LibraryRoute {
  id: string;
  /** Path inside the folder/import — the library's dedupe key. */
  relPath: string;
  trajectory: Trajectory;
}

export interface LibraryProfile {
  id: string;
  relPath: string;
  profile: RobotProfile;
}

/**
 * Parsers fall back to the (possibly relative) import path for the
 * trajectory name; display should only ever show the file's own name.
 * Team inference already consumed the full path inside the parser.
 */
export function displayName(traj: Trajectory): string {
  const slash = traj.name.lastIndexOf('/');
  return slash >= 0 ? traj.name.slice(slash + 1) : traj.name;
}

export function robotFromRoute(route: LibraryRoute, colorIndex: number, id = crypto.randomUUID()): SessionTrajectory {
  // A fresh trajectory id: the same library route can back several robots.
  return {
    ...makeSession({ ...route.trajectory, id, name: displayName(route.trajectory) }, colorIndex),
    routeId: route.id,
  };
}
