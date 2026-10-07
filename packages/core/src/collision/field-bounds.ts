/**
 * Robot-vs-field-boundary check (study §6.2 field-collision first step:
 * the perimeter walls). Samples each robot's bumper OBB against the
 * playfield AABB [0,L]×[0,W] and reports exit intervals with the deepest
 * penetration and which edge was crossed.
 */

import type { FieldPackage } from '../field';
import type { Pose2d } from '../types';
import { activeEndT, activeStartT, samplePoseAt } from '../session';
import type { SessionTrajectory } from '../session';
import { poseToObb } from './obb';
import type { Obb } from './obb';

export interface OutOfBoundsInterval {
  robotId: string;
  startT: number;
  endT: number;
  /** Deepest bumper penetration beyond the boundary, meters. */
  maxPenetrationM: number;
  /** Edges crossed during the interval. */
  edges: ('far' | 'left' | 'near' | 'right')[];
  /** Pose at the deepest penetration. */
  worstPose: Pose2d;
}

export interface FieldBoundsOptions {
  stepS?: number;
}

/**
 * Boundary forgiveness, meters (user decisions 2026-10-04 and 2026-10-07):
 * a bumper that barely crosses the wall line is not a reportable "out of
 * bounds" — during a match a sub-inch overlap is plausibly a legal
 * wall-hug (field-model rounding, pose quantization), and only a clearly
 * visible incursion deserves the warning. The threshold is exactly
 * 1 inch (user rule: "只有等于或超过 1 英寸才报警"): penetrations below it
 * stay silent, at or above it the interval is reported with its measured
 * depth. The 2026-10-04 instance that set the previous 0.02 m value (the
 * welcome example's #8814 starting 3.6 mm over the line) stays forgiven;
 * the #8814 example's 0.9 in wall brush that triggered this change now
 * sits below the threshold too. A genuinely wall-crossing drive (half a
 * bumper, >0.05 m) remains well above and is still reported.
 */
export const BOUNDS_TOLERANCE_M = 0.0254;

/**
 * SAT overlap between an OBB and the playfield AABB. Returns the overlap
 * depth (0 when disjoint) and the edge(s) with the deepest crossing.
 */
function obbVsField(
  obb: Obb,
  field: FieldPackage,
): { depth: number; edges: OutOfBoundsInterval['edges'] } {
  const c = Math.cos(obb.angle);
  const s = Math.sin(obb.angle);
  // AABB of the OBB (exact for penetration depth vs axis-aligned walls).
  const ex = Math.abs(c) * obb.hl + Math.abs(s) * obb.hw;
  const ey = Math.abs(s) * obb.hl + Math.abs(c) * obb.hw;
  const x0 = obb.cx - ex;
  const x1 = obb.cx + ex;
  const y0 = obb.cy - ey;
  const y1 = obb.cy + ey;

  // Penetration beyond each wall (positive when outside).
  const far = x1 - field.lengthM; // +x red wall
  const near = -x0; // blue wall
  const left = y1 - field.widthM; // +y wall
  const right = -y0; // -y wall

  let depth = 0;
  const edges: OutOfBoundsInterval['edges'] = [];
  // ≥, not >: the user rule is "equal to or beyond 1 inch warns" — exactly
  // at the threshold already counts as out.
  const check = (d: number, edge: 'far' | 'left' | 'near' | 'right') => {
    if (d >= BOUNDS_TOLERANCE_M) {
      depth = Math.max(depth, d);
      edges.push(edge);
    }
  };
  check(far, 'far');
  check(left, 'left');
  check(near, 'near');
  check(right, 'right');
  return { depth, edges };
}

export function detectFieldBounds(
  robots: readonly SessionTrajectory[],
  field: FieldPackage,
  opts: FieldBoundsOptions = {},
): OutOfBoundsInterval[] {
  const step = opts.stepS ?? 0.05;
  const results: OutOfBoundsInterval[] = [];

  for (const robot of robots) {
    const from = activeStartT(robot);
    const to = activeEndT(robot);
    let open: OutOfBoundsInterval | undefined;

    for (let t = from; t <= to + 1e-9; t += step) {
      const pose = samplePoseAt(robot, t);
      const hit = obbVsField(poseToObb(pose, robot.trajectory.geometry), field);
      if (hit.depth > 0) {
        if (open) {
          open.endT = t;
          if (hit.depth > open.maxPenetrationM) {
            open.maxPenetrationM = hit.depth;
            open.worstPose = pose;
          }
          for (const e of hit.edges) {
            if (!open.edges.includes(e)) open.edges.push(e);
          }
        } else {
          open = {
            robotId: robot.trajectory.id,
            startT: t,
            endT: t,
            maxPenetrationM: hit.depth,
            edges: [...hit.edges],
            worstPose: pose,
          };
        }
      } else if (open) {
        if (t - open.endT > 1.5 * step) {
          results.push(open);
          open = undefined;
        }
      }
    }
    if (open) results.push(open);
  }
  return results.sort((a, b) => a.startT - b.startT);
}
