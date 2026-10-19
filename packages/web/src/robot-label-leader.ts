import type { LayoutRect } from './callout-layout';

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const LEADER_PAD = 4;

export interface LeaderGeometry {
  d: string;
  points: [{ x: number; y: number }, ...{ x: number; y: number }[]];
  /** Obstacle corridors for plates placed after this one. */
  segments: LayoutRect[];
}

function segmentRect(a: { x: number; y: number }, b: { x: number; y: number }): LayoutRect {
  return {
    x: Math.min(a.x, b.x) - LEADER_PAD,
    y: Math.min(a.y, b.y) - LEADER_PAD,
    w: Math.abs(a.x - b.x) + 2 * LEADER_PAD,
    h: Math.abs(a.y - b.y) + 2 * LEADER_PAD,
  };
}

/**
 * Anchor dot → plate edge. When the plate sits straight above or below the
 * anchor, the line docks into the plate's horizontal edge (a mostly vertical
 * stroke); otherwise it leaves the nearest vertical edge via a short elbow.
 * The dot always marks the actual projected footprint center.
 */
export function leaderGeometry(anchor: { x: number; y: number }, rect: LayoutRect): LeaderGeometry {
  if (anchor.x >= rect.x - 1 && anchor.x <= rect.x + rect.w + 1) {
    const dockX = clamp(anchor.x, rect.x + 12, rect.x + rect.w - 12);
    const edgeY = anchor.y > rect.y + rect.h / 2 ? rect.y + rect.h : rect.y;
    return {
      points: [anchor, { x: dockX, y: edgeY }],
      d: `M ${anchor.x} ${anchor.y} L ${dockX} ${edgeY}`,
      segments: [segmentRect(anchor, { x: dockX, y: edgeY })],
    };
  }
  const edgeX = anchor.x < rect.x + rect.w / 2 ? rect.x : rect.x + rect.w;
  const edgeY = clamp(anchor.y, rect.y + 12, rect.y + rect.h - 12);
  const elbow = { x: edgeX + (anchor.x < edgeX ? -12 : 12), y: edgeY };
  return {
    points: [anchor, elbow, { x: edgeX, y: edgeY }],
    d: `M ${anchor.x} ${anchor.y} L ${elbow.x} ${elbow.y} L ${edgeX} ${edgeY}`,
    segments: [segmentRect(anchor, elbow), segmentRect(elbow, { x: edgeX, y: edgeY })],
  };
}

