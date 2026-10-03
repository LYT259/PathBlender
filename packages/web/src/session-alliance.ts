import { applyAllianceChange, fieldById, type Alliance, type FieldPackage, type SessionTrajectory } from '@pathblender/core';

/** Derive one alliance view without modifying the imported route library. */
export function robotsForAlliance(robots: SessionTrajectory[], alliance: Alliance, field: FieldPackage): SessionTrajectory[] {
  return robots.map((robot) => {
    const trajectory = applyAllianceChange(robot.trajectory, alliance, field);
    return trajectory === robot.trajectory ? robot : { ...robot, trajectory };
  });
}

/**
 * Session files already persist each robot's alliance and world samples.
 * Recover the common selection, then retain blue-side source samples so
 * future field changes and repeated toggles always derive from one source.
 * Legacy mixed sessions adopt their first robot's alliance as the group.
 */
export function restoreSessionAlliance(session: { robots: SessionTrajectory[]; fieldId: string; field?: FieldPackage }) {
  const alliance: Alliance = session.robots[0]?.trajectory.alliance === 'red' ? 'red' : 'blue';
  return {
    alliance,
    robots: robotsForAlliance(session.robots, 'blue', session.field ?? fieldById(session.fieldId)),
  };
}
