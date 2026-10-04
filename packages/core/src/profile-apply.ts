/**
 * Applying an imported robot profile to a trajectory (red book §6.6
 * companion read, landed 2026-10-04).
 *
 * Geometry always applies. When the profile carries drive-train dynamics
 * and the trajectory is a regenerable PathPlanner import (`.path` files
 * carry no samples — their timeline comes from generation against a robot
 * config), the timeline is regenerated against the real robot instead of
 * the app default: the "timing is an estimate" story ends there. Choreo
 * imports embed their samples and are never regenerated.
 */

import { generateTrajectory } from './pathplanner/generation';
import { makeRobotConfig } from './pathplanner/robot-config';
import type { ParsedPath } from './pathplanner/path-model';
import type { RobotProfile } from './parsers/robot-profile';
import type { Trajectory, TrajectorySample } from './types';
import { trajectoryDuration } from './types';

/**
 * Project-wide generation defaults fill in a path whose global constraints
 * are unlimited (§6.6 默认约束→兜底): the file said "no constraint", the
 * profile supplies the team's real defaults instead of invented numbers.
 */
function withConstraintFallback(path: ParsedPath, profile: RobotProfile): ParsedPath {
  const dc = profile.defaultConstraints;
  if (!dc || !path.globalConstraints.unlimited) return path;
  return {
    ...path,
    globalConstraints: {
      ...path.globalConstraints,
      unlimited: false,
      maxVelocityMPS: dc.maxVelMPS ?? path.globalConstraints.maxVelocityMPS,
      maxAccelerationMPSSq: dc.maxAccelMPSS ?? path.globalConstraints.maxAccelerationMPSSq,
      maxAngularVelocityRadPS: dc.maxAngVelRadPS ?? path.globalConstraints.maxAngularVelocityRadPS,
      maxAngularAccelerationRadPSSq:
        dc.maxAngAccelRadPSSq ?? path.globalConstraints.maxAngularAccelerationRadPSSq,
    },
  };
}

/**
 * Apply a profile to one trajectory. Pure: returns a derived copy, source
 * data untouched. The applied provenance (geometrySource='file') engages
 * the v1.14 read-only lock upstream.
 */
export function applyProfileToTrajectory(traj: Trajectory, profile: RobotProfile): Trajectory {
  const base: Trajectory = {
    ...traj,
    geometry: profile.geometry,
    moduleLocations:
      profile.moduleLocations.length > 0 ? profile.moduleLocations : traj.moduleLocations,
    geometrySource: 'file',
    massKG: profile.massKG,
    holonomic: profile.holonomic,
  };

  const editable = traj.editable;
  const d = profile.dynamics;
  if (editable?.kind !== 'pathplanner' || !d) return base;

  // Real-robot regeneration. Fields the profile omits fall back to the
  // generator defaults one by one (makeRobotConfig treats undefined that
  // way), so a mass-only profile still re-times the path on real mass.
  const config = makeRobotConfig({
    massKG: d.massKG,
    moi: d.moiKGm2,
    holonomic: profile.holonomic,
    moduleLocations:
      profile.moduleLocations.length > 0 ? profile.moduleLocations : undefined,
    moduleConfig: {
      wheelRadiusM: d.wheelRadiusM,
      maxDriveVelocityMPS: d.maxDriveVelocityMPS,
      driveGearing: d.driveGearing,
      wheelCOF: d.wheelCOF,
    },
  });
  const path = withConstraintFallback(editable.path, profile);
  const generated = generateTrajectory(path, config);
  if (generated.samples.length < 2) return base;
  const samples = generated.samples as TrajectorySample[];
  return {
    ...base,
    editable: { kind: 'pathplanner', path },
    samples,
    durationS: trajectoryDuration(samples),
    events: generated.events,
    warnings: [
      `regenerated with real robot config from profile "${profile.name}"`,
      ...path.parseWarnings,
    ],
  };
}
