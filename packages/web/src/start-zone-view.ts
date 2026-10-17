import { sessionStartsInZone, startsInAllianceZone, type FieldPackage, type SessionTrajectory, type StartZoneRect } from '@pathblender/core';
import { sequenceViewFor } from './auto-sequence-state';

/**
 * Robots whose FIELD path renders gray (user 2026-10-09): the first leg the
 * robot actually drives — its first composed segment, or its single imported
 * route — starts outside the season's legal starting region. The field-side
 * twin of the composer's first-leg gate: the picker stops an illegal start
 * from being ARRANGED, the gray path shows the same verdict on paths that
 * are already there (imported files, restored sessions). Seasons without an
 * established starting region gate nothing.
 *
 * The robots here are the ALLIANCE VIEW (App derives them through
 * `robotsForAlliance`), so `field` must be supplied: it lets the predicate
 * flip a red-frame first sample back to blue, keeping the verdict identical
 * in both views (2026-10-17: without it the red view grayed every path).
 */
export function dimmedPathRobotIds(
  robots: readonly SessionTrajectory[],
  zone: readonly StartZoneRect[] | undefined,
  field?: FieldPackage,
): Set<string> {
  const ids = new Set<string>();
  if (!zone) return ids;
  for (const robot of robots) {
    if (!sessionStartsInZone(robot, zone, field)) ids.add(robot.trajectory.id);
  }
  return ids;
}

/**
 * Whether a route PREVIEW grays on the field: exactly while the composer's
 * picker would gate that route as a first leg — the target robot's
 * arrangement is empty (a legacy robot always shows its pseudo initial leg,
 * so it never gates) and the route starts outside the zone. Once clips
 * exist, pose continuity governs the picker and mid-field routes stay
 * colored there, so the field must not gray them either.
 */
export function previewDimsPath(
  target: SessionTrajectory | undefined,
  route: SessionTrajectory | undefined,
  zone: readonly StartZoneRect[] | undefined,
): boolean {
  if (!zone || !route || !target) return false;
  return sequenceViewFor(target).segments.length === 0
    && !startsInAllianceZone(route.trajectory, zone);
}
