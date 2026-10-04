import { applyAllianceChange, fieldById, type Alliance, type FieldPackage, type SessionRouteOption, type SessionTrajectory } from '@pathblender/core';

/**
 * Derive one alliance view without modifying the imported route library.
 * The route library must land in the view's frame too: composed robots
 * sample their segments through `routeOptions` (core resolves by route id),
 * so options left in the blue frame would render/simulate in the wrong
 * place under the red view. The flip is a derived copy; the source robots
 * (and what `pickRoute` reads) stay blue.
 */
export function robotsForAlliance(robots: SessionTrajectory[], alliance: Alliance, field: FieldPackage): SessionTrajectory[] {
  return robots.map((robot) => {
    const trajectory = applyAllianceChange(robot.trajectory, alliance, field);
    const routeOptions = flipRouteOptions(robot.routeOptions, alliance, field);
    if (trajectory === robot.trajectory && routeOptions === robot.routeOptions) return robot;
    const patch: Partial<SessionTrajectory> = { trajectory };
    if (routeOptions !== robot.routeOptions) patch.routeOptions = routeOptions;
    return { ...robot, ...patch };
  });
}

function flipRouteOptions(
  options: SessionRouteOption[] | undefined,
  alliance: Alliance,
  field: FieldPackage,
): SessionRouteOption[] | undefined {
  if (!options) return options;
  let changed = false;
  const flipped = options.map((option) => {
    const trajectory = applyAllianceChange(option.trajectory, alliance, field);
    if (trajectory === option.trajectory) return option;
    changed = true;
    return { ...option, trajectory };
  });
  return changed ? flipped : options;
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
