/**
 * Choreo-side editable data: the `snapshot.waypoints` array of a `.traj`
 * export (geometric waypoints with heading + constraint flags; the
 * `trajectory.waypoints` array in the file is time splits, not geometry),
 * plus the geometry-remap reparameterization used by §6.3 mediation edits.
 */

import type { TrajectorySample } from '../types';

export interface ChoreoWaypoint {
  x: number;
  y: number;
  heading: number;
  intervals: number;
  split: boolean;
  fixTranslation: boolean;
  fixHeading: boolean;
  overrideIntervals: boolean;
}

export function parseChoreoWaypoints(v: unknown): ChoreoWaypoint[] | undefined {
  if (!Array.isArray(v) || v.length < 2) return undefined;
  const out: ChoreoWaypoint[] = [];
  for (const w of v) {
    if (typeof w !== 'object' || w === null) return undefined;
    const r = w as Record<string, unknown>;
    if (typeof r.x !== 'number' || typeof r.y !== 'number') return undefined;
    out.push({
      x: r.x,
      y: r.y,
      heading: typeof r.heading === 'number' ? r.heading : 0,
      intervals: typeof r.intervals === 'number' ? r.intervals : 20,
      split: Boolean(r.split),
      fixTranslation: Boolean(r.fixTranslation),
      fixHeading: Boolean(r.fixHeading),
      overrideIntervals: Boolean(r.overrideIntervals),
    });
  }
  return out;
}

/**
 * Remap samples onto the (edited) waypoint polyline while keeping each
 * sample's timestamp, its normalized progress along the path, and its
 * speed profile. Heading interpolates the waypoint headings by progress
 * so per-waypoint heading constraints still read sensibly.
 */
export function remapChoreoGeometry(
  samples: readonly TrajectorySample[],
  waypoints: readonly ChoreoWaypoint[],
): TrajectorySample[] {
  if (waypoints.length < 2 || samples.length === 0) return [...samples];

  // Cumulative segment lengths of the waypoint polyline.
  const cum = [0];
  for (let i = 1; i < waypoints.length; i++) {
    const a = waypoints[i - 1] as ChoreoWaypoint;
    const b = waypoints[i] as ChoreoWaypoint;
    cum.push(cum[i - 1] as number + Math.hypot(b.x - a.x, b.y - a.y));
  }
  const total = cum[cum.length - 1] as number;

  const pointAt = (s: number): { x: number; y: number; heading: number } => {
    const d = Math.max(0, Math.min(1, s)) * total;
    let i = 1;
    while (i < cum.length - 1 && (cum[i] as number) < d) i++;
    const a = waypoints[i - 1] as ChoreoWaypoint;
    const b = waypoints[i] as ChoreoWaypoint;
    const segLen = (cum[i] as number) - (cum[i - 1] as number);
    const f = segLen > 1e-9 ? (d - (cum[i - 1] as number)) / segLen : 0;
    let dh = b.heading - a.heading;
    dh = Math.atan2(Math.sin(dh), Math.cos(dh));
    return {
      x: a.x + (b.x - a.x) * f,
      y: a.y + (b.y - a.y) * f,
      heading: a.heading + dh * f,
    };
  };

  const lastT = (samples[samples.length - 1] as TrajectorySample).t;
  return samples.map((s) => {
    const sNorm = lastT > 0 ? s.t / lastT : 0;
    const p = pointAt(sNorm);
    return { ...s, x: p.x, y: p.y, heading: p.heading };
  });
}
