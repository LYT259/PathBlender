/**
 * Mediation-copy exporters (report v1.4 §6.3).
 *
 * Exporting is an explicit user action; callers default file names to an
 * `-adjusted` suffix so derived copies never masquerade as originals.
 * Key asymmetry: export is far easier than import — `.path` only stores
 * waypoints, PathPlannerLib regenerates the trajectory on the robot.
 */

import type { EditablePath } from './editing';
import type { PathConstraints } from './pathplanner/path-model';
import type { Trajectory } from './types';

const deg = (rad: number) => (rad * 180) / Math.PI;

/** Default file stem for an export: `<name>-adjusted`. */
export function adjustedName(name: string): string {
  return name.endsWith('-adjusted') ? name : `${name}-adjusted`;
}

function constraintsToJson(c: PathConstraints): Record<string, number | boolean> {
  return {
    maxVelocity: c.maxVelocityMPS,
    maxAcceleration: c.maxAccelerationMPSSq,
    maxAngularVelocity: deg(c.maxAngularVelocityRadPS),
    maxAngularAcceleration: deg(c.maxAngularAccelerationRadPSSq),
    nominalVoltage: c.nominalVoltage,
    unlimited: c.unlimited,
  };
}

function requirePp(traj: Trajectory): NonNullable<EditablePath> & { kind: 'pathplanner' } {
  const e = traj.editable;
  if (e?.kind !== 'pathplanner') {
    throw new Error(`"${traj.name}" has no editable PathPlanner waypoints`);
  }
  return e;
}

/** Export a derived `.path` (2025.0 schema; angles in degrees as on disk). */
export function exportPathPlannerPath(traj: Trajectory): string {
  const { path: p } = requirePp(traj);
  const root: Record<string, unknown> = {
    version: '2025.0',
    name: adjustedName(p.name),
    waypoints: p.waypoints.map((w) => ({
      anchor: w.anchor,
      prevControl: w.prevControl,
      nextControl: w.nextControl,
    })),
    rotationTargets: p.rotationTargets.map((t) => ({
      rotation: deg(t.rotationRad),
      waypointRelativePos: t.waypointRelativePos,
    })),
    constraintZones: p.constraintZones.map((z) => ({
      minWaypointRelativePos: z.minWaypointRelativePos,
      maxWaypointRelativePos: z.maxWaypointRelativePos,
      constraints: constraintsToJson(z.constraints),
    })),
    pointTowardsZones: p.pointTowardsZones.map((z) => ({
      minWaypointRelativePos: z.minWaypointRelativePos,
      maxWaypointRelativePos: z.maxWaypointRelativePos,
      name: z.name,
      fieldPosition: z.fieldPosition,
      rotationOffset: deg(z.rotationOffsetRad),
    })),
    eventMarkers: p.eventMarkers.map((m) => ({
      name: m.name,
      waypointRelativePos: m.waypointRelativePos,
      endWaypointRelativePos: m.endWaypointRelativePos,
    })),
    globalConstraints: constraintsToJson(p.globalConstraints),
    goalEndState: { velocity: p.goalEndState.velocityMPS, rotation: deg(p.goalEndState.rotationRad) },
    idealStartingState: { velocity: p.idealStartingState.velocityMPS, rotation: deg(p.idealStartingState.rotationRad) },
    reversed: p.reversed,
    folder: null,
    useDefaultConstraints: false,
  };
  return JSON.stringify(root, null, 2);
}

/** Export a derived `.ghostauto` (Team 103 fork schema). */
export function exportGhostAuto(traj: Trajectory): string {
  const root: Record<string, unknown> = {
    version: '1.0',
    name: adjustedName(traj.name),
    teamName: traj.teamName,
    bumperSize: { width: traj.geometry.lengthM, height: traj.geometry.widthM },
    bumperOffset: { x: traj.geometry.offsetX ?? 0, y: traj.geometry.offsetY ?? 0 },
    holonomic: true,
    moduleLocations: traj.moduleLocations.map((m) => ({ x: m.x, y: m.y })),
    states: traj.samples.map((s) => ({
      t: round(s.t, 4),
      x: round(s.x, 4),
      y: round(s.y, 4),
      rotation: round(s.heading, 4),
      vx: round(s.vx, 4),
      vy: round(s.vy, 4),
      omega: round(s.omega, 4),
    })),
  };
  return JSON.stringify(root, null, 2);
}

/** Export a derived Choreo `.traj` — Choreo sources only (needs the original
 *  file structure to stay GUI-openable). Dynamics fields ax/ay/alpha are
 *  rebuilt by numerical differentiation; fx/fy are omitted (0). */
export function exportTraj(traj: Trajectory): string {
  const e = traj.editable;
  if (e?.kind !== 'choreo' || !e.raw || typeof e.raw !== 'object') {
    throw new Error(`"${traj.name}" is not a Choreo trajectory; export as .path or .ghostauto`);
  }
  const root = structuredClone(e.raw) as {
    snapshot?: { waypoints?: unknown };
    trajectory?: { waypoints?: unknown; samples?: unknown };
    events?: unknown;
  };
  if (root.snapshot) root.snapshot.waypoints = e.waypoints;
  if (root.trajectory) {
    root.trajectory.waypoints = e.splits;
    root.trajectory.samples = traj.samples.map((s, i, arr) => {
      const prev = arr[i - 1];
      const dt = prev && s.t > prev.t ? s.t - prev.t : 0.02;
      const ax = prev ? (s.vx - prev.vx) / dt : 0;
      const ay = prev ? (s.vy - prev.vy) / dt : 0;
      const alpha = prev ? (s.omega - prev.omega) / dt : 0;
      return {
        t: round(s.t, 4),
        x: round(s.x, 4),
        y: round(s.y, 4),
        heading: round(s.heading, 4),
        vx: round(s.vx, 4),
        vy: round(s.vy, 4),
        omega: round(s.omega, 4),
        ax: round(ax, 4),
        ay: round(ay, 4),
        alpha: round(alpha, 4),
      };
    });
  }
  return JSON.stringify(root, null, 2);
}

function round(v: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}
