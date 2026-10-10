import { applyProfileToTrajectory } from '@pathblender/core';
import type { RobotProfile, SessionTrajectory, Trajectory } from '@pathblender/core';

/**
 * Post-hoc settings.json application (red book §6.6 entrance ②): the parsed
 * profile is applied to the robot and, coherently, to every route in its
 * library — displayed geometry, the selected route and each composed
 * segment then read the same valid profile and regenerated timing.
 * History, autosave and session files pick the result up through the
 * ordinary robot store; the route text on disk is never touched.
 */
export function applyUploadedProfile(robot: SessionTrajectory, profile: RobotProfile, relPath: string): SessionTrajectory {
  const entry = { id: crypto.randomUUID(), relPath, profile };
  const apply = (trajectory: Trajectory) => applyProfileToTrajectory(trajectory, profile);
  return {
    ...robot,
    profileId: entry.id,
    profileOptions: [...(robot.profileOptions ?? []), entry],
    trajectory: apply(robot.trajectory),
    routeOptions: robot.routeOptions?.map((option) => ({ ...option, trajectory: apply(option.trajectory) })),
  };
}

/** The prominent status and upload action replace this repeated parser notice.
 * Keep all other diagnostics intact, including genuine parsing warnings. */
export function inspectorWarnings(warnings: string[]): string[] {
  return warnings.filter((warning) => !warning.startsWith('generated with default robot config (Kraken X60 swerve)'));
}
