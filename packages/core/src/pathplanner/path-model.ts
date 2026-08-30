/**
 * PathPlanner .path model + JSON parsing.
 * Format version 2025.0 confirmed from real samples (docs/formats).
 * Angles in the file are degrees; the model converts to radians.
 */

import { asArray, asRecord, num, str } from '../parsers/json';
import { ParseError } from '../parsers/parse-error';
import type { Vec2 } from './geometry';

export interface PathConstraints {
  maxVelocityMPS: number;
  maxAccelerationMPSSq: number;
  maxAngularVelocityRadPS: number;
  maxAngularAccelerationRadPSSq: number;
  nominalVoltage: number;
  unlimited: boolean;
}

export interface Waypoint {
  prevControl: Vec2 | null;
  anchor: Vec2;
  nextControl: Vec2 | null;
}

export interface RotationTarget {
  /** Position along the path in waypoint units (i to i+1 → i…i+1). */
  waypointRelativePos: number;
  rotationRad: number;
}

export interface ConstraintZone {
  minWaypointRelativePos: number;
  maxWaypointRelativePos: number;
  constraints: PathConstraints;
}

export interface PointTowardsZone {
  minWaypointRelativePos: number;
  maxWaypointRelativePos: number;
  name: string;
  fieldPosition: Vec2;
  rotationOffsetRad: number;
}

export interface PathEventMarker {
  name: string;
  waypointRelativePos: number;
  endWaypointRelativePos: number | null;
}

export interface ParsedPath {
  name: string;
  version: string;
  waypoints: Waypoint[];
  rotationTargets: RotationTarget[];
  constraintZones: ConstraintZone[];
  pointTowardsZones: PointTowardsZone[];
  eventMarkers: PathEventMarker[];
  globalConstraints: PathConstraints;
  goalEndState: { velocityMPS: number; rotationRad: number };
  idealStartingState: { velocityMPS: number; rotationRad: number };
  reversed: boolean;
  /** Non-fatal format findings (legacy fields, unknown version) for UI warnings. */
  parseWarnings: string[];
}

function vec2(v: unknown): Vec2 {
  const r = asRecord(v);
  return { x: r ? num(r.x, 0) : 0, y: r ? num(r.y, 0) : 0 };
}

function constraintsFromJson(v: unknown): PathConstraints {
  const r = asRecord(v) ?? {};
  return {
    maxVelocityMPS: num(r.maxVelocity, Number.POSITIVE_INFINITY),
    maxAccelerationMPSSq: num(r.maxAcceleration, Number.POSITIVE_INFINITY),
    maxAngularVelocityRadPS: (num(r.maxAngularVelocity, Number.POSITIVE_INFINITY) * Math.PI) / 180,
    maxAngularAccelerationRadPSSq: (num(r.maxAngularAcceleration, Number.POSITIVE_INFINITY) * Math.PI) / 180,
    nominalVoltage: num(r.nominalVoltage, 12),
    unlimited: Boolean(r.unlimited ?? false),
  };
}

export function parsePathJson(text: string, fileName: string): ParsedPath {
  let root: Record<string, unknown> | undefined;
  try {
    root = asRecord(JSON.parse(text));
  } catch (e) {
    throw new ParseError('invalid-json', fileName, e instanceof Error ? e.message : undefined);
  }
  if (!root) throw new ParseError('unrecognized-format', fileName, 'not a JSON object');

  const waypointsJson = asArray(root.waypoints);
  if (!waypointsJson || waypointsJson.length < 2) {
    throw new ParseError('empty-trajectory', fileName, 'path needs ≥ 2 waypoints');
  }
  const waypoints: Waypoint[] = [];
  for (const w of waypointsJson) {
    const r = asRecord(w);
    if (!r?.anchor) {
      throw new ParseError('unrecognized-format', fileName, 'waypoint missing anchor');
    }
    waypoints.push({
      anchor: vec2(r.anchor),
      prevControl: r.prevControl != null ? vec2(r.prevControl) : null,
      nextControl: r.nextControl != null ? vec2(r.nextControl) : null,
    });
  }

  const rotationTargets: RotationTarget[] = [];
  for (const t of asArray(root.rotationTargets) ?? []) {
    const r = asRecord(t);
    if (!r) continue;
    rotationTargets.push({
      waypointRelativePos: num(r.waypointRelativePos, 0),
      rotationRad: (num(r.rotation, 0) * Math.PI) / 180,
    });
  }

  const constraintZones: ConstraintZone[] = [];
  for (const z of asArray(root.constraintZones) ?? []) {
    const r = asRecord(z);
    if (!r) continue;
    constraintZones.push({
      minWaypointRelativePos: num(r.minWaypointRelativePos, 0),
      maxWaypointRelativePos: num(r.maxWaypointRelativePos, 0),
      constraints: constraintsFromJson(r.constraints),
    });
  }

  const pointTowardsZones: PointTowardsZone[] = [];
  for (const z of asArray(root.pointTowardsZones) ?? []) {
    const r = asRecord(z);
    if (!r) continue;
    pointTowardsZones.push({
      minWaypointRelativePos: num(r.minWaypointRelativePos, 0),
      maxWaypointRelativePos: num(r.maxWaypointRelativePos, 0),
      name: str(r.name, ''),
      fieldPosition: vec2(r.fieldPosition),
      rotationOffsetRad: (num(r.rotationOffset, 0) * Math.PI) / 180,
    });
  }

  const eventMarkers: PathEventMarker[] = [];
  for (const m of asArray(root.eventMarkers) ?? []) {
    const r = asRecord(m);
    if (!r) continue;
    eventMarkers.push({
      name: str(r.name, ''),
      waypointRelativePos: num(r.waypointRelativePos, 0),
      endWaypointRelativePos:
        r.endWaypointRelativePos != null ? num(r.endWaypointRelativePos, 0) : null,
    });
  }

  const goal = asRecord(root.goalEndState) ?? {};
  const ideal = asRecord(root.idealStartingState) ?? {};

  const parseWarnings: string[] = [];
  const version = str(root.version, '');
  if (version !== '2025.0') {
    parseWarnings.push(
      `format version "${version || 'missing'}" (expected 2025.0) — parsed best-effort`,
    );
  }
  // Pre-2025 exports carried constraints as a typed list on the root object;
  // only the 2025 numeric zone/global constraints participate in generation.
  const legacyConstraints = asArray(root.constraints) ?? [];
  if (legacyConstraints.length > 0) {
    parseWarnings.push(
      `legacy "constraints" list (${legacyConstraints.length} entries) is not applied — pre-2025 constraint types are ignored`,
    );
  }
  if (root.isReversed === true) {
    parseWarnings.push('legacy "isReversed" flag applied as "reversed"');
  }

  return {
    name: str(root.name, fileName.replace(/\.path$/i, '')),
    version,
    waypoints,
    rotationTargets,
    constraintZones,
    pointTowardsZones,
    eventMarkers,
    globalConstraints: constraintsFromJson(root.globalConstraints),
    goalEndState: {
      velocityMPS: num(goal.velocity, 0),
      rotationRad: (num(goal.rotation, 0) * Math.PI) / 180,
    },
    idealStartingState: {
      velocityMPS: num(ideal.velocity, 0),
      rotationRad: (num(ideal.rotation, 0) * Math.PI) / 180,
    },
    reversed: Boolean(root.reversed ?? root.isReversed ?? false),
    parseWarnings,
  };
}
