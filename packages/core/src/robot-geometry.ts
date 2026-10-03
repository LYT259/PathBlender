/**
 * Per-season, rule-maximum robot geometry — the MK5i-chassis plan
 * (user decision 2026-10-02): every robot defaults to the largest
 * chassis + bumper its season's rules allow, as a two-layer model
 * (frame rectangle inside a bumper ring; the bumper box is the
 * collision footprint). File-provided sizes always win.
 *
 * Resolution happens at consumption time from the selected field's
 * year, so switching seasons instantly re-sizes default-geometry
 * robots (parsers bake only a placeholder, see DEFAULT_GEOMETRY).
 *
 * Every number below is verified against that season's official game
 * manual (primary sources, checked 2026-10-02): 2023–2026 from the
 * local reference/ archive PDFs; 2019/2020/2022 from the official
 * firstinspires season-manual PDFs. Excerpts and rule numbers in
 * PathBlender_底盘与队号方案.md §2. Perimeter-capped seasons take the
 * max-area square (perimeter/4 per side).
 */

import type { ModuleLocation, RobotGeometry, Trajectory } from './types';
import type { SessionTrajectory } from './session';

/** Inches to meters. */
const IN_M = 0.0254;

export interface SeasonRobotProfile {
  /** Rule-max chassis (frame) rectangle, meters. */
  chassis: { lengthM: number; widthM: number };
  /** Bumper depth per side, meters. */
  bumperDepthM: number;
  /** Collision footprint: chassis inflated by the bumper on all sides. */
  outer: RobotGeometry;
}

function profile(frameLIn: number, frameWIn: number, bumperIn: number): SeasonRobotProfile {
  return {
    chassis: { lengthM: frameLIn * IN_M, widthM: frameWIn * IN_M },
    bumperDepthM: bumperIn * IN_M,
    outer: {
      lengthM: (frameLIn + 2 * bumperIn) * IN_M,
      widthM: (frameWIn + 2 * bumperIn) * IN_M,
      offsetX: 0,
      offsetY: 0,
    },
  };
}

/** Frame sides + bumper depth per side, inches, each row rule-verified. */
const SEASONS: Readonly<Record<number, { frame: [number, number]; bumper: number; src: string }>> = {
  // R3 FRAME PERIMETER ≤ 120 in (→ 30×30 in max square); bumper ¾ in
  // plywood + 2½ in noodles → 3.25 in nominal.
  2019: { frame: [30, 30], bumper: 3.25, src: '2019 R3 ≤120 in + ¾+2½ bumper' },
  // R3 FRAME PERIMETER ≤ 120 in; bumper ¾ in plywood + 2½ in noodles.
  2020: { frame: [30, 30], bumper: 3.25, src: '2020 R3 ≤120 in + ¾+2½ bumper' },
  // R104 FRAME PERIMETER ≤ 120 in; bumper ¾ in plywood + 2½ in noodles.
  2022: { frame: [30, 30], bumper: 3.25, src: '2022 R104 ≤120 in + ¾+2½ bumper' },
  // R104 FRAME PERIMETER ≤ 120 in; R408 construction ¾ in + 2½ in.
  2023: { frame: [30, 30], bumper: 3.25, src: '2023 R104 ≤120 in + R408' },
  2024: { frame: [30, 30], bumper: 3.25, src: '2024 R104 ≤120 in + R408' },
  // R403 caps bumper extension at 4 in per side (explicit).
  2025: { frame: [30, 30], bumper: 4, src: '2025 R104 ≤120 in + R403 ≤4 in' },
  // 2026 tightened the perimeter itself: R104 ROBOT PERIMETER ≤ 110 in
  // (→ 27.5×27.5 in max square); R403 bumper ≤ 4.0 in per side.
  // 2026 frame 27.0 (not the 27.5 rule max): the shipped CAD chassis
  // (user-built Onshape frame, 2026-10-03) lands on the MK5i plate hole
  // grid in whole-inch steps — 27.5 is unreachable, 27.0 is the largest
  // legal档位. The CAD outline ships unscaled; the default follows it.
  2026: { frame: [27, 27], bumper: 4, src: '2026 R104 ≤110 in + R403 ≤4.0 in' },
};

const FALLBACK_YEAR = 2025;

/**
 * Rule-max profile for a season. Unknown years (custom fields carry
 * year 0) fall back to the 2025 profile — the latest full ruleset and
 * a conservative square for any recent custom practice field.
 */
export function seasonRobotProfile(year: number): SeasonRobotProfile {
  const spec = SEASONS[year] ?? SEASONS[FALLBACK_YEAR]!;
  return profile(spec.frame[0], spec.frame[1], spec.bumper);
}

/**
 * Re-resolve a session robot's default geometry against a season.
 * File-geometry robots pass through unchanged (same reference);
 * default-geometry robots get the season's rule-max bumper box.
 */
export function withSeasonGeometry<T extends { trajectory: Trajectory }>(st: T, year: number): T {
  if (st.trajectory.geometrySource === 'file') return st;
  const outer = seasonRobotProfile(year).outer;
  const g = st.trajectory.geometry;
  if (
    g.lengthM === outer.lengthM && g.widthM === outer.widthM &&
    g.offsetX === outer.offsetX && g.offsetY === outer.offsetY
  ) {
    return st;
  }
  return { ...st, trajectory: { ...st.trajectory, geometry: outer } };
}

export interface RobotVisualGeometry {
  /** Collision footprint / drawn bumper outline. */
  outer: RobotGeometry;
  /** Chassis (frame) rectangle inside the bumper ring. */
  chassis: { lengthM: number; widthM: number; offsetX: number; offsetY: number };
  bumperDepthM: number;
}

/**
 * Two-layer visual geometry for one robot on a season's field: the
 * season's exact frame for default-geometry robots; for file-geometry
 * robots the frame is the file box inset by this season's bumper depth.
 */
export function robotVisualGeometry(t: Trajectory, year: number): RobotVisualGeometry {
  const p = seasonRobotProfile(year);
  if (t.geometrySource === 'file') {
    const g = t.geometry;
    return {
      outer: g,
      chassis: {
        lengthM: Math.max(g.lengthM - 2 * p.bumperDepthM, 0.05),
        widthM: Math.max(g.widthM - 2 * p.bumperDepthM, 0.05),
        offsetX: g.offsetX,
        offsetY: g.offsetY,
      },
      bumperDepthM: p.bumperDepthM,
    };
  }
  return {
    outer: p.outer,
    chassis: { lengthM: p.chassis.lengthM, widthM: p.chassis.widthM, offsetX: 0, offsetY: 0 },
    bumperDepthM: p.bumperDepthM,
  };
}

/** Corner inset for the default MK5i-style module layout, meters. */
/**
 * Default module layout as a fraction of the chassis half-dimension,
 * matched to the shipped MK5i frame CAD (plates bolt at ±10.375 in on
 * the 27 in frame → 10.375/13.5 ≈ 0.7685) so the app's modules sit on
 * the frame's plate zones for every season the frame scales to.
 */
const MODULE_INSET_FRACTION = 0.7685;

/**
 * Module positions for the MK5i-style rendering: the file's real
 * swerve-module layout when it carries one, else four corners placed
 * on the frame CAD's plate zones (proportional, scales with chassis).
 */
export function chassisModules(
  t: Pick<Trajectory, 'moduleLocations'>,
  chassis: { lengthM: number; widthM: number },
): ModuleLocation[] {
  if (t.moduleLocations.length > 0) return t.moduleLocations;
  const ix = Math.max((chassis.lengthM / 2) * MODULE_INSET_FRACTION, 0.05);
  const iy = Math.max((chassis.widthM / 2) * MODULE_INSET_FRACTION, 0.05);
  return [
    { x: ix, y: iy },
    { x: -ix, y: iy },
    { x: -ix, y: -iy },
    { x: ix, y: -iy },
  ];
}

/**
 * Per-corner installed yaw (radians) for the default MK5i layout — the
 * resting orientation each module is fastened at on a real chassis,
 * measured 2026-10-03 from the user's STEP assembly: each wheel's
 * rolling line is TANGENT to its corner diagonal, so the two motors
 * flank along the radial diagonal (FL/RR 45° line, FR/RL 135° line).
 * Exact rays FL -45°, FR -135°, RR 135°, RL 45° — the user verified
 * the motor sides against the CAD (the first cut pointed every pod
 * 180° the other way). Steering replaces it once moving.
 */
export function moduleBaseYaw(m: ModuleLocation): number {
  // radial - 90°: the CAD pins each module rotated with its corner, the
  // rolling direction (template +X) pointing tangentially — the pinwheel
  // resting pose. atan2 keeps the exact per-corner rays; the earlier
  // ±45° sign() collapsed both diagonals and pointed the rolling line
  // RADIALLY, 90° off the CAD on every corner. Wrapped to (-π, π].
  const a = Math.atan2(m.y, m.x) - Math.PI / 2;
  return a <= -Math.PI ? a + 2 * Math.PI : a;
}

/**
 * Ground speed below which a module counts as parked; the caller then
 * keeps its previous steering angle (user decision 2026-10-02: wheels
 * hold the last pointing when the robot stands still).
 */
export const STEERING_STATIC_MPS = 0.05;

export interface MotionState {
  heading: number;
  /** Field-frame linear velocity (TrajectorySample vx/vy). */
  vx: number;
  vy: number;
  omega: number;
}

/**
 * Per-module swerve steering angles for one sampled state: each wheel
 * points along the ground velocity of its own position,
 * v_point = v_robot + ω × r (robot frame), which degenerates to
 * "wheels along the heading" for differential drives on their own —
 * no drive-type flag needed. Returns null per module when that wheel
 * is effectively stationary.
 */
export function moduleSteeringAngles(
  s: MotionState,
  modules: readonly ModuleLocation[],
): (number | null)[] {
  const cos = Math.cos(s.heading);
  const sin = Math.sin(s.heading);
  // Field-frame velocity → robot frame (x forward, y left).
  const vrx = s.vx * cos + s.vy * sin;
  const vry = -s.vx * sin + s.vy * cos;
  return modules.map((m) => {
    const px = vrx - s.omega * m.y;
    const py = vry + s.omega * m.x;
    return Math.hypot(px, py) < STEERING_STATIC_MPS ? null : Math.atan2(py, px);
  });
}
