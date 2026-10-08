import {
  makeSession,
  parseTraj,
  type SessionRouteOption,
  type SessionTrajectory,
} from '@pathblender/core';
import { sortRoutes } from './route-library';

/**
 * Real 2026 routes from the team's three real robots, shipped with the app
 * (2026-10-08, replacing the earlier two-team bundle): 11019 — the robot
 * that ran the whole season (20 routes, L1–L15 / M1–M5); 8814 — the
 * separate robot built for the post-season (13 routes, FCeSt / LCP / …);
 * 11019 Champs — the robot built during the Houston World Championship,
 * since dismantled (18 routes, L1–L13 / M1–M5). Every route carries the
 * team's own event annotations (intake / shoot / blocker …), so the
 * timeline dots and the playback action callout light up in the demo. All
 * three sit on the blue alliance — in a real event you only ever hold path
 * data for your own side. The raw Choreo exports live under
 * `assets/welcome-example/<dir>/` and load synchronously into this lazily
 * imported chunk — App dynamic-imports this module only when the user asks
 * for the example, so the ~2.2 MB of route text never touches first paint.
 */
const ROUTE_TEXTS = import.meta.glob('./assets/welcome-example/*/*.traj', {
  eager: true,
  query: '?raw',
  import: 'default',
}) as Record<string, string>;

/**
 * The three example robots, in display order (colour slots 0–2). The
 * champs robot's folder name carries no team number of its own, so its
 * identity rides on an explicit displayName — set on every route option,
 * not just the current one, so switching library routes never drops the
 * label back to a bare #11019.
 */
const EXAMPLE_TEAMS = [
  { dir: '11019', teamNumber: '11019', robotId: 'welcome-example-a' },
  { dir: '8814', teamNumber: '8814', robotId: 'welcome-example-b' },
  { dir: '11019-champs', teamNumber: '11019', displayName: '11019 Champs', robotId: 'welcome-example-c' },
] as const;

/**
 * Three real robots' Choreo route libraries. Each robot carries its full
 * route set in natural filename order (first route current), so the route
 * picker behaves exactly like a folder import. Demo robots keep stable
 * `welcome-example-` ids and no `routeId` — the "End example" affordance
 * keys on that (see example-robot.ts); picking a library route adopts the
 * robot. Geometry comes from each file's own Choreo config, never estimated.
 */
export function createWelcomeExample(): { robots: SessionTrajectory[] } {
  const robots = EXAMPLE_TEAMS.map((team, colorIndex) => {
    const options: SessionRouteOption[] = sortRoutes(
      Object.entries(ROUTE_TEXTS)
        .filter(([path]) => path.startsWith(`./assets/welcome-example/${team.dir}/`))
        .map(([path, text]) => {
          const relPath = path.replace('./assets/welcome-example/', '');
          // Deterministic ids: a freshly created example must deep-equal the
          // one it replaces, and autosaved route references survive relaunch.
          const id = `welcome-example-route-${relPath.replace(/\.traj$/, '').replace(/\//g, '-')}`;
          return {
            id,
            relPath,
            trajectory: {
              ...parseTraj(text, relPath),
              id,
              ...('displayName' in team ? { displayName: team.displayName } : {}),
            },
          };
        }),
    );
    const current = options[0];
    if (!current) throw new Error(`welcome example: no routes bundled for team ${team.dir}`);
    const robot = makeSession(
      { ...current.trajectory, id: team.robotId, teamNumber: team.teamNumber },
      colorIndex,
    );
    robot.routeOptions = options;
    return robot;
  });
  return { robots };
}
