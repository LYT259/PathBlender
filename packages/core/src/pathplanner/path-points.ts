/**
 * Waypoints → discretized path points.
 * Faithful port of the PathPlanner GUI (MIT) lib/path/pathplanner_path.dart
 * generatePathPoints: 0.05 waypoint-units probing steps adapted toward a
 * 0.2 m point spacing, rotation-target insertion, tight-curve subdivision,
 * constraint-zone mapping, and distance accumulation.
 */

import {
  calculateRadius,
  cubicLerp,
  dist,
  type Vec2,
} from './geometry';
import type {
  ConstraintZone,
  ParsedPath,
  PathConstraints,
  PointTowardsZone,
  RotationTarget,
} from './path-model';

const TARGET_INCREMENT = 0.05;
const TARGET_SPACING = 0.2;

export interface PathPoint {
  position: Vec2;
  constraints: PathConstraints;
  waypointPos: number;
  distanceAlongPath: number;
  rotationTarget: RotationTarget | null;
  /** Curve-limited max velocity (m/s), set in the post pass. */
  maxV: number;
}

/** Sample the piecewise cubic bezier at a waypoint-relative position. */
export function samplePath(path: ParsedPath, waypointRelativePos: number): Vec2 {
  const n = path.waypoints.length;
  let pos = Math.min(Math.max(waypointRelativePos, 0), n - 1);
  let i = Math.floor(pos);
  if (i === n - 1) i--;
  if (i < 0) i = 0;
  const t = pos - i;

  const w0 = path.waypoints[i] as { anchor: Vec2; nextControl: Vec2 | null };
  const w1 = path.waypoints[i + 1] as { anchor: Vec2; prevControl: Vec2 | null };
  // End waypoints legally have null outward controls in the file; fall back
  // to the anchor (degenerate segment) so sampling never crashes.
  const p1 = w0.nextControl ?? w0.anchor;
  const p2 = w1.prevControl ?? w1.anchor;

  return cubicLerp(w0.anchor, p1, p2, w1.anchor, t);
}

function constraintsForPos(zones: ConstraintZone[], global: PathConstraints, pos: number): PathConstraints {
  for (const z of zones) {
    if (pos >= z.minWaypointRelativePos && pos <= z.maxWaypointRelativePos) {
      return z.constraints;
    }
  }
  if (global.unlimited) {
    return {
      maxVelocityMPS: Number.POSITIVE_INFINITY,
      maxAccelerationMPSSq: Number.POSITIVE_INFINITY,
      maxAngularVelocityRadPS: Number.POSITIVE_INFINITY,
      maxAngularAccelerationRadPSSq: Number.POSITIVE_INFINITY,
      nominalVoltage: global.nominalVoltage,
      unlimited: true,
    };
  }
  return global;
}

function pointZoneForPos(zones: PointTowardsZone[], pos: number): PointTowardsZone | null {
  for (const z of zones) {
    if (pos >= z.minWaypointRelativePos && pos <= z.maxWaypointRelativePos) {
      return z;
    }
  }
  return null;
}

export function generatePathPoints(path: ParsedPath): PathPoint[] {
  const points: PathPoint[] = [];
  const lastWpPos = path.waypoints.length - 1;

  const mkPoint = (pos: number, target: RotationTarget | null): PathPoint => ({
    position: samplePath(path, pos),
    constraints: constraintsForPos(path.constraintZones, path.globalConstraints, pos),
    waypointPos: pos,
    distanceAlongPath: 0,
    rotationTarget: target,
    maxV: Number.POSITIVE_INFINITY,
  });

  const unaddedTargets = [...path.rotationTargets].sort(
    (a, b) => a.waypointRelativePos - b.waypointRelativePos,
  );

  // First point.
  points.push(mkPoint(0, null));

  let pos = TARGET_INCREMENT;
  while (pos < lastWpPos) {
    let position = samplePath(path, pos);
    const prevPos = pos - TARGET_INCREMENT;

    const distance = dist(points[points.length - 1]!.position, position);
    if (distance <= 0.01) {
      pos = Math.min(pos + TARGET_INCREMENT, lastWpPos);
      continue;
    }

    const delta = distance - TARGET_SPACING;
    if (delta > TARGET_SPACING * 0.25) {
      // Too far apart — re-derive the probe step from actual spacing.
      const correctIncrement = (TARGET_SPACING * TARGET_INCREMENT) / distance;
      pos = pos - TARGET_INCREMENT + correctIncrement;
      position = samplePath(path, pos);
      if (dist(points[points.length - 1]!.position, position) - TARGET_SPACING > TARGET_SPACING * 0.25) {
        pos = pos - correctIncrement * 0.5;
        position = samplePath(path, pos);
      }
    } else if (delta < -TARGET_SPACING * 0.25) {
      const correctIncrement = (TARGET_SPACING * TARGET_INCREMENT) / distance;
      pos = pos - TARGET_INCREMENT + correctIncrement;
      position = samplePath(path, pos);
      if (dist(points[points.length - 1]!.position, position) - TARGET_SPACING < -TARGET_SPACING * 0.25) {
        pos = pos + correctIncrement * 0.5;
        position = samplePath(path, pos);
      }
    }

    // Rotation targets within (prevPos, pos): attach to a point.
    let target: RotationTarget | null = null;
    const prevPoint = points[points.length - 1]!;
    while (
      unaddedTargets.length > 0 &&
      (unaddedTargets[0] as RotationTarget).waypointRelativePos >= prevPos &&
      (unaddedTargets[0] as RotationTarget).waypointRelativePos <= pos
    ) {
      const t = unaddedTargets.shift() as RotationTarget;
      if (Math.abs(t.waypointRelativePos - prevPos) < 0.001) {
        prevPoint.rotationTarget = t;
      } else if (Math.abs(t.waypointRelativePos - pos) < 0.001) {
        target = t;
      } else {
        points.push(mkPoint(t.waypointRelativePos, t));
      }
    }

    points.push(mkPoint(pos, target));
    pos = Math.min(pos + TARGET_INCREMENT, lastWpPos);
  }

  // End point: keep re-probing until it is close enough to the last point.
  let trueIncrement = lastWpPos - (pos - TARGET_INCREMENT);
  pos = lastWpPos;
  let invalid = true;
  while (invalid) {
    let position = samplePath(path, pos);
    const distance = dist(points[points.length - 1]!.position, position);
    if (distance <= 0.01) break;

    const prevPos = pos - trueIncrement;
    const delta = distance - TARGET_SPACING;
    if (delta > TARGET_SPACING * 0.25) {
      const correctIncrement = (TARGET_SPACING * trueIncrement) / distance;
      pos = pos - trueIncrement + correctIncrement;
      trueIncrement = correctIncrement;
      position = samplePath(path, pos);
      if (dist(points[points.length - 1]!.position, position) - TARGET_SPACING > TARGET_SPACING * 0.25) {
        pos = pos - correctIncrement * 0.5;
        trueIncrement = correctIncrement * 0.5;
        position = samplePath(path, pos);
      }
    } else {
      invalid = false;
    }

    if (unaddedTargets.length > 0) {
      const t = unaddedTargets[0] as RotationTarget;
      if (Math.abs(t.waypointRelativePos - prevPos) <= Math.abs(t.waypointRelativePos - pos)) {
        points[points.length - 1]!.rotationTarget = unaddedTargets.shift() as RotationTarget;
      }
    }

    points.push(mkPoint(pos, null));
    pos = lastWpPos;
  }

  // End rotation is the goal end state rotation.
  const last = points[points.length - 1]!;
  last.rotationTarget = {
    waypointRelativePos: lastWpPos,
    rotationRad: path.goalEndState.rotationRad,
  };

  // Tight-curve subdivision (radii per the GUI).
  for (let i = 1; i < points.length - 1; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const c = points[i + 1]!;
    const radius = Math.abs(calculateRadius(a.position, b.position, c.position));
    if (!Number.isFinite(radius)) continue;

    const mkInserted = (wpPos: number): PathPoint => {
      const np = mkPoint(wpPos, null);
      np.constraints = b.constraints;
      return np;
    };

    if (radius < 0.25) {
      // Match the Dart insertion order: [a, p33, p67, b, a33, a67, c].
      points.splice(i, 0, mkInserted(a.waypointPos + (b.waypointPos - a.waypointPos) * 0.67));
      points.splice(i, 0, mkInserted(a.waypointPos + (b.waypointPos - a.waypointPos) * 0.33));
      const bIdx = i + 2;
      points.splice(bIdx + 1, 0, mkInserted(b.waypointPos + (c.waypointPos - b.waypointPos) * 0.67));
      points.splice(bIdx + 1, 0, mkInserted(b.waypointPos + (c.waypointPos - b.waypointPos) * 0.33));
      i += 4;
    } else if (radius < 0.5) {
      points.splice(i, 0, mkInserted(a.waypointPos + (b.waypointPos - a.waypointPos) * 0.5));
      const bIdx = i + 1;
      points.splice(bIdx + 1, 0, mkInserted(b.waypointPos + (c.waypointPos - b.waypointPos) * 0.5));
      i += 2;
    }
  }

  // Distance, maxV, point-towards rotation overrides.
  for (let i = 1; i < points.length; i++) {
    const p = points[i]!;
    const q = points[i - 1]!;
    p.distanceAlongPath = q.distanceAlongPath + dist(p.position, q.position);
  }
  for (let i = 1; i < points.length - 1; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const c = points[i + 1]!;
    const radius = calculateRadius(a.position, b.position, c.position);
    if (Number.isFinite(radius)) {
      b.maxV = Math.min(
        Math.sqrt(b.constraints.maxAccelerationMPSSq * Math.abs(radius)),
        b.constraints.maxVelocityMPS,
      );
    } else {
      b.maxV = b.constraints.maxVelocityMPS;
    }

    const zone = pointZoneForPos(path.pointTowardsZones, b.waypointPos);
    if (zone) {
      const dx = zone.fieldPosition.x - b.position.x;
      const dy = zone.fieldPosition.y - b.position.y;
      b.rotationTarget = {
        waypointRelativePos: b.waypointPos,
        rotationRad: Math.atan2(dy, dx) + zone.rotationOffsetRad,
      };
    }
  }

  return points;
}
