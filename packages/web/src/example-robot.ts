import type { SessionTrajectory } from '@pathblender/core';
import { legacyExampleNames } from './i18n';

/**
 * What makes a robot part of the welcome demo — this drives the "End example"
 * notice and the exit itself. Demo robots carry stable `welcome-example-` ids
 * that survive session save/load (session files persist trajectory ids), so
 * the exit affordance comes back after a relaunch. Switching a demo robot to
 * a library route keeps the id but makes the robot the user's own — `routeId`
 * must survive "End example". Demos saved before the 2026-10-03 rename carry
 * only their localized legacy names and no stable id; match those too, or
 * their exit button never comes back.
 */
export function isExampleRobot(robot: SessionTrajectory): boolean {
  if (robot.routeId) return false;
  return (
    robot.trajectory.id.startsWith('welcome-example-') ||
    legacyExampleNames.has(robot.trajectory.name)
  );
}

/**
 * Swap the example robots inside a restored session for a freshly generated
 * set (user report 2026-10-04: relaunching the app restored the demo as it
 * looked when it was saved — an old build's two straight lines, team numbers
 * 0001/0002 — instead of the example the current build ships). Matching is
 * by stable id first (the post-2026-10-03 generation), then by example
 * ordinal (the pre-rename generation carries only localized names, but both
 * generations spawn in team order), and a robot that matches nothing is left
 * untouched rather than dropped. Adopted robots (routeId set) are not
 * examples — `isExampleRobot` already excludes them, so user work survives.
 */
export function refreshExampleRobots(
  robots: readonly SessionTrajectory[],
  fresh: readonly SessionTrajectory[],
): SessionTrajectory[] {
  let ordinal = 0;
  return robots.map((robot) => {
    if (!isExampleRobot(robot)) return robot;
    const replacement =
      fresh.find((f) => f.trajectory.id === robot.trajectory.id) ?? fresh[ordinal];
    ordinal += 1;
    if (!replacement) return robot;
    // Only the demo's own payload refreshes — the trajectory and its libraries.
    // Everything the user decided on that robot stays theirs, or a relaunch
    // quietly undoes it (user report 2026-10-06: a hidden example robot came
    // back visible). Route ids are deterministic across builds, so a saved
    // arrangement still resolves against the refreshed library.
    return {
      ...replacement,
      startDelayS: robot.startDelayS,
      color: robot.color,
      visible: robot.visible,
      mirrored: robot.mirrored,
      profileId: robot.profileId,
      sequence: robot.sequence,
    };
  });
}
