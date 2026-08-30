/**
 * Conflict-mediation editing (report v1.4 §6.3).
 *
 * Positioning: a *mediator*, not an editor — the goal is resolving an
 * already-detected conflict by nudging existing waypoints, never creating
 * paths from scratch. Edits produce derived in-session copies: the imported
 * source data stays untouched, exports default to an `-adjusted` suffix.
 *
 * Time reparameterization:
 * - PathPlanner sources regenerate the full trajectory through the ported
 *   generator (same code path as import);
 * - Choreo sources degrade to "keep the original timing, remap geometry
 *   only" with an explicit warning (Choreo's optimizer is not ported).
 */

import { generateTrajectory } from './pathplanner/generation';
import { makeRobotConfig } from './pathplanner/robot-config';
import type { ParsedPath, Waypoint } from './pathplanner/path-model';
import type { ChoreoWaypoint } from './parsers/traj-editable';
import { remapChoreoGeometry } from './parsers/traj-editable';
import type { Trajectory, TrajectorySample } from './types';
import { trajectoryDuration } from './types';

/** Editable source data attached to a trajectory (undefined → not editable). */
export type EditablePath =
  | { kind: 'pathplanner'; path: ParsedPath }
  | {
      kind: 'choreo';
      version: string;
      waypoints: ChoreoWaypoint[];
      splits: number[];
      /** Original parsed root, passed through on export for max fidelity. */
      raw?: unknown;
    };

function withEditable(traj: Trajectory, editable: EditablePath): Trajectory {
  return {
    ...traj,
    editable,
    edited: true,
    original:
      traj.original ??
      {
        editable: traj.editable as EditablePath,
        samples: traj.samples,
        events: traj.events,
        warnings: traj.warnings,
        durationS: traj.durationS,
      },
  };
}

/** Reset a derived copy back to its imported state. */
export function resetToOriginal(traj: Trajectory): Trajectory {
  const o = traj.original;
  if (!o) return traj;
  const { edited: _edited, original: _original, ...rest } = traj;
  return {
    ...rest,
    editable: o.editable,
    samples: o.samples,
    events: o.events,
    warnings: o.warnings,
    durationS: o.durationS,
  };
}

function clonePp(traj: Trajectory): ParsedPath {
  const e = traj.editable;
  if (e?.kind !== 'pathplanner') throw new Error('trajectory is not a PathPlanner path');
  return structuredClone(e.path);
}

function cloneChoreo(traj: Trajectory): { version: string; waypoints: ChoreoWaypoint[]; splits: number[] } {
  const e = traj.editable;
  if (e?.kind !== 'choreo') throw new Error('trajectory is not a Choreo path');
  return structuredClone({ version: e.version, waypoints: e.waypoints, splits: e.splits, raw: e.raw });
}

// --- PathPlanner waypoint edits (anchor + control points) ---

export function movePpWaypoint(
  traj: Trajectory,
  idx: number,
  part: Partial<Pick<Waypoint, 'anchor' | 'prevControl' | 'nextControl'>>,
): Trajectory {
  const path = clonePp(traj);
  const wp = path.waypoints[idx];
  if (!wp) return traj;
  path.waypoints[idx] = { ...wp, ...part };
  return withEditable(traj, { kind: 'pathplanner', path });
}

export function addPpWaypoint(traj: Trajectory, afterIdx: number): Trajectory {
  const path = clonePp(traj);
  const a = path.waypoints[afterIdx];
  const b = path.waypoints[afterIdx + 1];
  if (!a || !b) return traj;
  // Insert at the midpoint of the segment; control points mirrored to keep
  // the bezier shape close to the original curve (mediation, not authoring).
  const mid = {
    x: (a.anchor.x + b.anchor.x) / 2,
    y: (a.anchor.y + b.anchor.y) / 2,
  };
  const wp: Waypoint = {
    anchor: mid,
    prevControl:
      a.nextControl != null
        ? { x: 2 * mid.x - a.nextControl.x, y: 2 * mid.y - a.nextControl.y }
        : null,
    nextControl:
      b.prevControl != null
        ? { x: 2 * mid.x - b.prevControl.x, y: 2 * mid.y - b.prevControl.y }
        : null,
  };
  path.waypoints.splice(afterIdx + 1, 0, wp);
  return withEditable(traj, { kind: 'pathplanner', path });
}

export function removePpWaypoint(traj: Trajectory, idx: number): Trajectory {
  const path = clonePp(traj);
  if (path.waypoints.length <= 2 || !path.waypoints[idx]) return traj;
  path.waypoints.splice(idx, 1);
  return withEditable(traj, { kind: 'pathplanner', path });
}

// --- Choreo waypoint edits (position/heading) ---

export function moveChoreoWaypoint(
  traj: Trajectory,
  idx: number,
  part: Partial<Pick<ChoreoWaypoint, 'x' | 'y' | 'heading'>>,
): Trajectory {
  const c = cloneChoreo(traj);
  const wp = c.waypoints[idx];
  if (!wp) return traj;
  c.waypoints[idx] = { ...wp, ...part };
  return withEditable(traj, { kind: 'choreo', ...c });
}

export function addChoreoWaypoint(traj: Trajectory, afterIdx: number): Trajectory {
  const c = cloneChoreo(traj);
  const a = c.waypoints[afterIdx];
  const b = c.waypoints[afterIdx + 1];
  if (!a || !b) return traj;
  c.waypoints.splice(afterIdx + 1, 0, {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
    heading: (a.heading + b.heading) / 2,
    intervals: Math.max(1, Math.round((a.intervals + b.intervals) / 2)),
    split: false,
    fixTranslation: false,
    fixHeading: false,
    overrideIntervals: false,
  });
  return withEditable(traj, { kind: 'choreo', ...c });
}

export function removeChoreoWaypoint(traj: Trajectory, idx: number): Trajectory {
  const c = cloneChoreo(traj);
  if (c.waypoints.length <= 2 || !c.waypoints[idx]) return traj;
  c.waypoints.splice(idx, 1);
  return withEditable(traj, { kind: 'choreo', ...c });
}

// --- Time reparameterization after a geometry edit ---

export function reparameterize(traj: Trajectory): Trajectory {
  const e = traj.editable;
  if (!e) return traj;

  if (e.kind === 'pathplanner') {
    const generated = generateTrajectory(e.path, makeRobotConfig());
    if (generated.samples.length < 2) return traj;
    const samples = generated.samples as TrajectorySample[];
    return {
      ...traj,
      samples,
      durationS: trajectoryDuration(samples),
      events: generated.events,
    };
  }

  // Choreo: keep the original time distribution, remap geometry onto the
  // edited waypoint polyline, warn about the degradation.
  const remapped = remapChoreoGeometry(traj.samples, e.waypoints);
  return {
    ...traj,
    samples: remapped,
    warnings: dedupe([
      ...traj.warnings,
      'edited geometry remapped with original timing (Choreo optimizer not ported)',
    ]),
  };
}

function dedupe(list: string[]): string[] {
  return [...new Set(list)];
}
