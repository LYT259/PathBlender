import type { SessionTrajectory } from '@pathblender/core';

/** A six-letter display identity for a team whose number is not known yet. */
export function nextTeamPlaceholder(used: ReadonlySet<string>): string {
  for (let index = 0; ; index++) {
    let candidate: string;
    if (index < 26) candidate = String.fromCharCode(65 + index).repeat(6);
    else {
      let value = index - 25;
      let letters = '';
      do { letters = String.fromCharCode(65 + value % 26) + letters; value = Math.floor(value / 26); } while (value);
      candidate = letters.padStart(6, 'A');
    }
    if (!used.has(candidate)) return candidate;
  }
}

/** Allocate only missing identities, retaining imported and user-edited numbers. */
export function withTeamPlaceholders(robots: SessionTrajectory[]): SessionTrajectory[] {
  const used = new Set(robots.map((robot) => robot.trajectory.teamNumber).filter(Boolean));
  return robots.map((robot) => {
    const legacyDemo = !robot.routeId && robot.trajectory.id.startsWith('welcome-example-') &&
      ['00001', '00002'].includes(robot.trajectory.teamNumber);
    if (robot.trajectory.teamNumber && !legacyDemo) return robot;
    const teamNumber = nextTeamPlaceholder(used);
    used.add(teamNumber);
    return { ...robot, trajectory: { ...robot.trajectory, teamNumber } };
  });
}
