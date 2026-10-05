import { applyAllianceChange, fieldById, mirrorAcrossLongAxis, type Alliance, type FieldPackage, type SessionRouteOption, type SessionTrajectory, type Trajectory } from '@pathblender/core';

/**
 * Derive one alliance view without modifying the imported route library.
 * The route library must land in the view's frame too: composed robots
 * sample their segments through `routeOptions` (core resolves by route id),
 * so options left in the blue frame would render/simulate in the wrong
 * place under the red view. The flip is a derived copy; the source robots
 * (and what the composer replaces routes in) stay blue.
 *
 * The per-team mirror (2026-10-05) rides the same derivation, applied after
 * the alliance flip so one left/right definition serves both alliances and
 * the imported samples are never mutated. Mirroring the whole slot — its
 * current trajectory AND every route option — keeps compositions, joins and
 * the library consistent; new routes inherit the flag because it lives on
 * the slot, not on any route.
 */
export function robotsForAlliance(robots: SessionTrajectory[], alliance: Alliance, field: FieldPackage): SessionTrajectory[] {
  return robots.map((robot) => {
    const trajectory = viewTrajectory(robot.trajectory, alliance, field, robot.mirrored === true);
    const routeOptions = flipRouteOptions(robot.routeOptions, alliance, field, robot.mirrored === true);
    if (trajectory === robot.trajectory && routeOptions === robot.routeOptions) return robot;
    const patch: Partial<SessionTrajectory> = { trajectory };
    if (routeOptions !== robot.routeOptions) patch.routeOptions = routeOptions;
    return { ...robot, ...patch };
  });
}

function viewTrajectory(trajectory: Trajectory, alliance: Alliance, field: FieldPackage, mirrored: boolean): Trajectory {
  const flipped = applyAllianceChange(trajectory, alliance, field);
  return mirrored ? mirrorAcrossLongAxis(flipped, field) : flipped;
}

function flipRouteOptions(
  options: SessionRouteOption[] | undefined,
  alliance: Alliance,
  field: FieldPackage,
  mirrored: boolean,
): SessionRouteOption[] | undefined {
  if (!options) return options;
  let changed = false;
  const flipped = options.map((option) => {
    const trajectory = viewTrajectory(option.trajectory, alliance, field, mirrored);
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
