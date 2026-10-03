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
