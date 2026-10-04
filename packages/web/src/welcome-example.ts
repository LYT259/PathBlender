import {
  makeSession,
  parseTraj,
  type SessionRouteOption,
  type SessionTrajectory,
} from '@pathblender/core';
import { sortRoutes } from './route-library';

/**
 * Real 2026 routes from two real FRC teams, shipped with the app: 8814
 * (BLACKHOLE — 22 routes, L1–L16 / M1–M5 / Test1) and 11019 (OffSeason —
 * 20 routes, L1–L15 / M1–M5). The raw Choreo exports live under
 * `assets/welcome-example/<team>/` and load synchronously into this lazily
 * imported chunk — App dynamic-imports this module only when the user asks
 * for the example, so the ~1.6 MB of route text never touches first paint.
 */
const ROUTE_TEXTS = import.meta.glob('./assets/welcome-example/*/*.traj', {
  eager: true,
  query: '?raw',
  import: 'default',
}) as Record<string, string>;

/** The two example teams, in display order (colour slots 0 and 1). */
const EXAMPLE_TEAMS = [
  { teamNumber: '8814', robotId: 'welcome-example-a' },
  { teamNumber: '11019', robotId: 'welcome-example-b' },
] as const;

/**
 * Two real teams' Choreo route libraries. Each robot carries its team's full
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
        .filter(([path]) => path.startsWith(`./assets/welcome-example/${team.teamNumber}/`))
        .map(([path, text]) => {
          const relPath = path.replace('./assets/welcome-example/', '');
          // Deterministic ids: a freshly created example must deep-equal the
          // one it replaces, and autosaved route references survive relaunch.
          const id = `welcome-example-route-${relPath.replace(/\.traj$/, '').replace(/\//g, '-')}`;
          return { id, relPath, trajectory: { ...parseTraj(text, relPath), id } };
        }),
    );
    const current = options[0];
    if (!current) throw new Error(`welcome example: no routes bundled for team ${team.teamNumber}`);
    const robot = makeSession(
      { ...current.trajectory, id: team.robotId, teamNumber: team.teamNumber },
      colorIndex,
    );
    robot.routeOptions = options;
    return robot;
  });
  return { robots };
}
