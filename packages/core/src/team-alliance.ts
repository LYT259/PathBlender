/**
 * Per-team original alliance (red book requirement #14 / §6.1): a team slot
 * may be marked as the red alliance so opponent routes can be compared on
 * one field for counter-defense/encounter analysis.
 *
 * Semantics split the two existing alliance notions:
 * - `Trajectory.alliance` stays the frame tag of the stored samples; source
 *   robots keep the standing invariant (blue-frame samples, blue tag) that
 *   session restore and the global view switch already rely on.
 * - `SessionTrajectory.teamAlliance` is the team's own alliance — metadata
 *   for classification (teammates vs opponents), display color and
 *   start-zone judging. It never drives view geometry, so the global
 *   red/blue view switch and this flag are orthogonal and neither can flip
 *   a trajectory twice.
 *
 * Marking a team red applies the field's 180° symmetry (the WPILib
 * red↔blue map, `flipPoseToBlue`) ONCE to every geometry-bearing authored
 * datum of the slot — samples, editable waypoints, `regenFrom` (so a later
 * profile regeneration re-times the RED placement, not the blue one) and
 * the pre-edit snapshot. The transform is an involution and is applied
 * relative to the slot's current flag, so repeated or corrected selections
 * can never accumulate flips.
 */

import { flipPoseToBlue } from './field';
import type { FieldPackage } from './field';
import { wrapAngle } from './math';
import type { SessionTrajectory } from './session';
import type { Alliance, Trajectory, TrajectorySample } from './types';
import type { EditablePath } from './editing';
import type { ParsedPath } from './pathplanner/path-model';
import type { Vec2 } from './pathplanner/geometry';

function flipVec2(v: Vec2, field: Pick<FieldPackage, 'lengthM' | 'widthM'>): Vec2 {
  return { x: field.lengthM - v.x, y: field.widthM - v.y };
}

function flipParsedPath(path: ParsedPath, field: Pick<FieldPackage, 'lengthM' | 'widthM'>): ParsedPath {
  return {
    ...path,
    waypoints: path.waypoints.map((w) => ({
      anchor: flipVec2(w.anchor, field),
      prevControl: w.prevControl ? flipVec2(w.prevControl, field) : null,
      nextControl: w.nextControl ? flipVec2(w.nextControl, field) : null,
    })),
    rotationTargets: path.rotationTargets.map((t) => ({ ...t, rotationRad: wrapAngle(t.rotationRad + Math.PI) })),
    pointTowardsZones: path.pointTowardsZones.map((z) => ({ ...z, fieldPosition: flipVec2(z.fieldPosition, field) })),
    goalEndState: { ...path.goalEndState, rotationRad: wrapAngle(path.goalEndState.rotationRad + Math.PI) },
    idealStartingState: { ...path.idealStartingState, rotationRad: wrapAngle(path.idealStartingState.rotationRad + Math.PI) },
  };
}

function flipEditable(editable: EditablePath, field: Pick<FieldPackage, 'lengthM' | 'widthM'>): EditablePath {
  switch (editable.kind) {
    case 'pathplanner':
      return { ...editable, path: flipParsedPath(editable.path, field) };
    case 'pathplanner-auto':
      return {
        ...editable,
        auto: {
          ...editable.auto,
          paths: Object.fromEntries(Object.entries(editable.auto.paths).map(([name, path]) => [name, flipParsedPath(path, field)])),
        },
      };
    case 'choreo':
      return {
        ...editable,
        waypoints: editable.waypoints.map((w) => ({
          ...w,
          x: field.lengthM - w.x,
          y: field.widthM - w.y,
          heading: wrapAngle(w.heading + Math.PI),
        })),
      };
  }
}

function flipSamples(samples: TrajectorySample[], field: Pick<FieldPackage, 'lengthM' | 'widthM'>): TrajectorySample[] {
  // Same arithmetic as `applyAllianceChange` (frame flips): position and
  // heading through the 180° map, planar velocities negated, ω unchanged.
  return samples.map((s) => {
    const p = flipPoseToBlue({ x: s.x, y: s.y, heading: s.heading }, field);
    return { ...s, x: p.x, y: p.y, heading: p.heading, vx: -s.vx, vy: -s.vy };
  });
}

/** Apply the field's 180° symmetry to every geometry-bearing authored datum
 * of one trajectory. Frame tag, timing, events, gaps and robot-frame data
 * (bumper box, module locations) are untouched. */
export function flipTrajectoryForTeam(traj: Trajectory, field: Pick<FieldPackage, 'lengthM' | 'widthM'>): Trajectory {
  return {
    ...traj,
    samples: flipSamples(traj.samples, field),
    editable: traj.editable ? flipEditable(traj.editable, field) : traj.editable,
    regenFrom: traj.regenFrom
      ? { ...traj.regenFrom, path: flipParsedPath(traj.regenFrom.path, field) }
      : traj.regenFrom,
    original: traj.original
      ? {
          ...traj.original,
          editable: flipEditable(traj.original.editable, field),
          samples: flipSamples(traj.original.samples, field),
        }
      : traj.original,
  };
}

/**
 * Set a team slot's own alliance. Crossing blue↔red applies the 180°
 * symmetry exactly once to the current trajectory AND every route option
 * (new routes inherit the flag because it lives on the slot); staying on
 * the same effective alliance (`undefined` ≡ blue) never touches geometry.
 */
export function setTeamAlliance(
  robot: SessionTrajectory,
  teamAlliance: Alliance,
  field: Pick<FieldPackage, 'lengthM' | 'widthM'>,
): SessionTrajectory {
  const current: Alliance = robot.teamAlliance ?? 'blue';
  if (current === teamAlliance) {
    return robot.teamAlliance === teamAlliance ? robot : { ...robot, teamAlliance };
  }
  const trajectory = flipTrajectoryForTeam(robot.trajectory, field);
  const routeOptions = robot.routeOptions?.map((option) => ({
    ...option,
    trajectory: flipTrajectoryForTeam(option.trajectory, field),
  }));
  return { ...robot, trajectory, routeOptions, teamAlliance };
}

/**
 * The alliance a robot should be PAINTED with: the team's own alliance when
 * the session uses per-team alliances (a red-team robot is red whichever
 * wall you view from), else the frame tag — which for legacy slots equals
 * the session view alliance, preserving today's display exactly.
 */
export function displayAlliance(robot: SessionTrajectory): Alliance {
  return robot.teamAlliance ?? robot.trajectory.alliance;
}
