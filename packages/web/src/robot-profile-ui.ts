import { applyProfileToRobot } from '@pathblender/core';
import type { RobotProfile, SessionTrajectory, TimingSource, Trajectory } from '@pathblender/core';

/**
 * Post-hoc settings.json application (red book §6.6 entrance ②): the parsed
 * profile is applied to the robot and, coherently, to every route in its
 * library through the same core entry as the select and folder flows —
 * displayed geometry, the selected route and each composed segment then read
 * the same valid profile and regenerated timing. History, autosave and
 * session files pick the result up through the ordinary robot store; the
 * route text on disk is never touched.
 */
export function applyUploadedProfile(robot: SessionTrajectory, profile: RobotProfile, relPath: string): SessionTrajectory {
  const entry = { id: crypto.randomUUID(), relPath, profile };
  return {
    ...applyProfileToRobot(robot, profile),
    profileId: entry.id,
    profileOptions: [...(robot.profileOptions ?? []), entry],
  };
}

/** The prominent status and upload action replace this repeated parser notice.
 * Keep all other diagnostics intact, including genuine parsing warnings. */
export function inspectorWarnings(warnings: string[]): string[] {
  return warnings.filter((warning) => !warning.startsWith('generated with default robot config (Kraken X60 swerve)'));
}

/**
 * The timing story the inspector badge tells (§16.39 direction 4). Sessions
 * saved before `timingSource` existed (2026-11-07) restore without it, so the
 * source stands in: WPILOG runs were measured, PathPlanner paths were
 * estimated against the default config, and Choreo/.ghostauto — whose samples
 * come from the original tool — make no timing claim at all.
 */
export function displayTimingSource(traj: Trajectory): TimingSource | undefined {
  return traj.timingSource
    ?? (traj.source === 'wpilog' ? 'logged'
      : traj.source.startsWith('pathplanner') ? 'default-config'
      : undefined);
}
