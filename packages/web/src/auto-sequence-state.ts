/**
 * Auto-sequence state wiring: the editor's controlled view of a robot's
 * composition and the session mutations that persist it. The composition
 * lives ON the SessionTrajectory (`sequence`), so undo/redo, autosave and
 * session-file export all pick it up through the ordinary robot store —
 * there is no parallel draft state.
 */

import type { AutoSequenceSegment, SessionRouteOption, SessionTrajectory } from '@pathblender/core';
import { displayName, sameRouteTrajectory } from './route-library';

export type { AutoSequenceSegment };

export interface AutoSequenceView {
  /** Team route choices the editor can pick from (same set sampling resolves). */
  routes: SessionRouteOption[];
  /** The composition being edited; a legacy robot starts as one segment. */
  segments: AutoSequenceSegment[];
}

export interface AutoSequenceRow extends AutoSequenceSegment {
  route: SessionRouteOption;
  startS: number;
  endS: number;
}

/** Presentation arithmetic only, never a trajectory generation/interpolation path. */
export function sequenceRows(
  segments: readonly AutoSequenceSegment[],
  routes: readonly SessionRouteOption[],
): AutoSequenceRow[] {
  let endS = 0;
  return segments.flatMap((segment) => {
    const route = routes.find((option) => option.id === segment.routeId);
    if (!route) return [];
    const startS = endS + segment.waitBeforeS;
    endS = startS + route.trajectory.durationS;
    return [{ ...segment, route, startS, endS }];
  });
}

const pseudoRouteId = (robot: SessionTrajectory) => `current:${robot.trajectory.id}`;

/**
 * The editor's input view. Legacy robots (no composition yet) are shown as
 * a single segment — current route + start delay — so the same editor
 * replaces the old read-only delay display; the first edit materializes a
 * real sequence. Dangling segment route ids (edited/deleted library) heal
 * onto the current route instead of rendering an unselectable value.
 */
export function sequenceViewFor(robot: SessionTrajectory | undefined): AutoSequenceView {
  if (!robot) return { routes: [], segments: [] };
  const options = robot.routeOptions ?? [];
  const current = options.find((route) => route.id === robot.routeId)
    ?? options.find((route) => sameRouteTrajectory(route.trajectory, robot.trajectory));
  const routes: SessionRouteOption[] = current ? options : [
    { id: pseudoRouteId(robot), relPath: displayName(robot.trajectory), trajectory: robot.trajectory },
    ...options,
  ];
  const sequence = robot.sequence;
  if (sequence && sequence.segments.length > 0) {
    const fallbackId = current?.id ?? routes[0]?.id;
    const segments = sequence.segments.map((segment) =>
      routes.some((route) => route.id === segment.routeId) || !fallbackId
        ? segment
        : { ...segment, routeId: fallbackId },
    );
    return { routes, segments };
  }
  const initialRoute = current ?? routes[0];
  return {
    routes,
    segments: initialRoute
      ? [{ id: `initial:${robot.trajectory.id}`, routeId: initialRoute.id, waitBeforeS: Math.max(0, robot.startDelayS) }]
      : [],
  };
}

/**
 * Commit an arrangement onto the robot: stores the sequence (dropping it
 * when every segment was removed, which returns the slot to legacy single-
 * route behavior) and keeps `startDelayS` mirroring the first segment's
 * wait so every legacy consumer stays in sync.
 */
export function applySequenceSegments(
  robot: SessionTrajectory,
  segments: readonly AutoSequenceSegment[],
): SessionTrajectory {
  const sanitized = segments.map((segment) => ({
    ...segment,
    waitBeforeS: Number.isFinite(segment.waitBeforeS) ? Math.max(0, segment.waitBeforeS) : 0,
  }));
  return {
    ...robot,
    sequence: sanitized.length > 0 ? { segments: sanitized } : undefined,
    startDelayS: sanitized[0] ? Math.max(0, sanitized[0]!.waitBeforeS) : robot.startDelayS,
  };
}
