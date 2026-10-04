// The ground tape always shows each robot's full route, wherever the
// playback head sits (user request 2026-10-04); the showTrail toggle only
// decides whether the tape is drawn at all. Preserve the old 3D tube's
// 10 cm diameter as the tape width in both views.
export const TRAIL_WIDTH_M = 0.1;
export const TRAIL_HEIGHT_M = 0.006;

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
