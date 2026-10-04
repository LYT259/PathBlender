/**
 * Import helpers: one folder creates one team with its own route choices.
 * The current route and all alternatives travel with that team slot.
 */

import { makeSession } from '@pathblender/core';
import type { SessionProfileOption, SessionRouteOption, SessionTrajectory, Trajectory } from '@pathblender/core';
import { teamNumberFromName } from '@pathblender/core';

export type LibraryRoute = SessionRouteOption;
export type LibraryProfile = SessionProfileOption;

/**
 * Parsers fall back to the (possibly relative) import path for the
 * trajectory name; display should only ever show the file's own name.
 * Team inference already consumed the full path inside the parser.
 */
export function displayName(traj: Trajectory): string {
  const slash = traj.name.lastIndexOf('/');
  return slash >= 0 ? traj.name.slice(slash + 1) : traj.name;
}

/** Only ambiguous file stems need their relative path shown in the picker. */
export function routeLabel(route: LibraryRoute, options: LibraryRoute[]): string {
  const name = routeName(route);
  return options.filter((option) => routeName(option) === name).length > 1
    ? route.relPath.split('/').slice(1).join('/') || route.relPath
    : name;
}

/**
 * The robot's current trajectory may BE a library option without carrying
 * its routeId — the welcome example is built that way on purpose, and
 * sessions saved before routeIds existed restore the same shape. Identity
 * first (a freshly built robot shares the option's samples), then a full
 * payload compare: a save/load round trip breaks shared references but
 * keeps every value.
 */
export function sameRouteTrajectory(option: Trajectory, current: Trajectory): boolean {
  if (option === current) return true;
  if (option.name !== current.name || option.samples.length !== current.samples.length) return false;
  if (option.samples === current.samples) return true;
  return option.samples.every((sample, index) => {
    const other = current.samples[index]!;
    return sample.t === other.t && sample.x === other.x && sample.y === other.y &&
      sample.heading === other.heading && sample.vx === other.vx &&
      sample.vy === other.vy && sample.omega === other.omega;
  });
}

/** File names distinguish candidates even when embedded project names repeat. */
export function routeName(route: LibraryRoute): string {
  return route.relPath.split('/').at(-1)!.replace(/\.(traj|ghostauto|path|auto)$/i, '');
}

export function robotFromRoute(route: LibraryRoute, colorIndex: number, id = crypto.randomUUID()): SessionTrajectory {
  // A fresh trajectory id: the same library route can back several robots.
  return {
    ...makeSession({ ...route.trajectory, id, name: displayName(route.trajectory) }, colorIndex),
    routeId: route.id,
    routeOptions: [route],
  };
}

/** Natural filename order makes the initial auto independent of picker order. */
export function sortRoutes(routes: LibraryRoute[]): LibraryRoute[] {
  return [...routes].sort((a, b) => routeName(a).localeCompare(routeName(b), 'en', { numeric: true, sensitivity: 'base' }) || a.relPath.localeCompare(b.relPath, 'en', { numeric: true }));
}

/** One selected folder is one team, even if another folder has the same name. */
export function robotsFromImport(routes: LibraryRoute[], profiles: LibraryProfile[], fromFolder: boolean, colorOffset = 0): SessionTrajectory[] {
  const groups = new Map<string, LibraryRoute[]>();
  for (const route of routes) {
    const root = fromFolder && route.relPath.includes('/') ? route.relPath.split('/')[0]! : route.id;
    groups.set(root, [...(groups.get(root) ?? []), route]);
  }
  const additions = [...groups.entries()].map(([root, values], index) => {
    const options = sortRoutes(values);
    const robot = robotFromRoute(options[0]!, colorOffset + index);
    const ownProfiles = fromFolder ? profiles.filter((p) => p.relPath.split('/')[0] === root) : profiles;
    const folderNumber = fromFolder ? teamNumberFromName(root) : '';
    const numbers = new Set(options.map((option) => option.trajectory.teamNumber).filter(Boolean));
    const teamNumber = folderNumber || (numbers.size === 1 ? [...numbers][0]! : '');
    // Imported routes stay untouched; team identity belongs to the slot.
    robot.trajectory = { ...robot.trajectory, teamNumber };
    robot.routeOptions = options;
    robot.profileOptions = ownProfiles;
    const entry = ownProfiles.length === 1 ? ownProfiles[0] : undefined;
    const profile = entry?.profile;
    if (profile && robot.trajectory.geometrySource !== 'file') {
      robot.profileId = entry!.id;
      robot.trajectory = { ...robot.trajectory, geometry: profile.geometry, moduleLocations: profile.moduleLocations, geometrySource: 'file' };
    }
    return robot;
  });
  return additions;
}
