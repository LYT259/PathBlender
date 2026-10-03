import type { SessionTrajectory } from '@pathblender/core';
import { samplePoseAt } from '@pathblender/core';

// Preserve the old 3D tube's 10 cm diameter as the tape width in both views.
export const TRAIL_WIDTH_M = 0.1;
export const TRAIL_HEIGHT_M = 0.006;

/** Index of the first sample after the playback clock, respecting start delays. */
export function trailEndIndex(robot: SessionTrajectory, globalT: number): number {
  const samples = robot.trajectory.samples;
  const time = globalT - robot.startDelayS;
  let lo = 0, hi = samples.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (samples[mid]!.t <= time) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export function trailPoints(robot: SessionTrajectory, globalT: number) {
  const end = trailEndIndex(robot, globalT);
  if (!end) return [];
  const points = robot.trajectory.samples.slice(0, end).map(({ x, y }) => ({ x, y }));
  if (end < robot.trajectory.samples.length) points.push(samplePoseAt(robot, globalT));
  return points;
}

/** Flat, independent segment quads with small round joins. Each vertex carries
 * local trajectory time, allowing the GPU to reveal a partial segment without
 * rebuilding geometry at playback frame rate. No curve smoothing changes the route. */
export function groundTrailData(samples: readonly { x: number; y: number; t: number }[]) {
  const positions: number[] = [], times: number[] = [];
  const half = TRAIL_WIDTH_M / 2;
  const vertex = (x: number, y: number, t: number) => { positions.push(x, y); times.push(t); };
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1]!, b = samples[i]!;
    const dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy);
    if (length < 1e-9) continue;
    const nx = -dy / length * half, ny = dx / length * half;
    vertex(a.x + nx, a.y + ny, a.t); vertex(a.x - nx, a.y - ny, a.t); vertex(b.x + nx, b.y + ny, b.t);
    vertex(b.x + nx, b.y + ny, b.t); vertex(a.x - nx, a.y - ny, a.t); vertex(b.x - nx, b.y - ny, b.t);
    // A join only appears when the robot has actually reached it.
    if (i < samples.length - 1) for (let j = 0; j < 12; j++) {
      const p = j * Math.PI / 6, q = (j + 1) * Math.PI / 6;
      vertex(b.x, b.y, b.t);
      vertex(b.x + half * Math.cos(p), b.y + half * Math.sin(p), b.t);
      vertex(b.x + half * Math.cos(q), b.y + half * Math.sin(q), b.t);
    }
  }
  return { positions, times };
}
