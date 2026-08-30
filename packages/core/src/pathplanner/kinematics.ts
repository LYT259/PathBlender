/**
 * Swerve kinematics: chassis speeds ↔ module speeds, and wheel-speed
 * desaturation. Ported from WPILib/PPLib semantics (BSD-3/MIT); the module
 * math is the standard v_i = v_chassis + ω × r_i in the robot frame.
 */

export interface ChassisSpeeds {
  vx: number;
  vy: number;
  omega: number;
}

export interface ModuleState {
  speedMPS: number;
  angleRad: number;
}

export interface Vec2 {
  x: number;
  y: number;
}

/** Field-frame chassis speeds → robot-frame module speed vectors. */
export function toModuleStates(
  speeds: ChassisSpeeds,
  moduleLocations: Vec2[],
): ModuleState[] {
  return moduleLocations.map((m) => {
    // ω × r for planar rotation about the origin: (-ω·y, ω·x)
    const vx = speeds.vx - speeds.omega * m.y;
    const vy = speeds.vy + speeds.omega * m.x;
    return { speedMPS: Math.hypot(vx, vy), angleRad: Math.atan2(vy, vx) };
  });
}

/** Robot-frame module speed vectors → chassis speeds (exact for the symmetric
 * module layouts of real swerve drives, where Σrᵢ = 0). */
export function toChassisSpeeds(
  states: ModuleState[],
  moduleLocations: Vec2[],
): ChassisSpeeds {
  const n = states.length;
  let vx = 0;
  let vy = 0;
  let omega = 0;
  for (let i = 0; i < n; i++) {
    const s = states[i] as ModuleState;
    const m = moduleLocations[i] as Vec2;
    vx += s.speedMPS * Math.cos(s.angleRad);
    vy += s.speedMPS * Math.sin(s.angleRad);
    // ωᵢ = (vᵢ − v_c)·(−yᵢ, xᵢ)/|rᵢ|²; the v_c term vanishes in the sum for
    // symmetric layouts (Σrᵢ = 0).
    const mxv = -s.speedMPS * Math.sin(s.angleRad) * m.y + s.speedMPS * Math.cos(s.angleRad) * m.x;
    omega += mxv / (m.x * m.x + m.y * m.y);
  }
  return { vx: vx / n, vy: vy / n, omega: omega / n };
}

/**
 * Scale module speeds down so that neither the module max speed nor the
 * chassis translation/rotation limits are exceeded. Ported 1:1 from
 * PathPlannerTrajectory.desaturateWheelSpeeds (MIT).
 */
export function desaturateWheelSpeeds(
  moduleStates: ModuleState[],
  desiredSpeeds: ChassisSpeeds,
  maxModuleSpeedMPS: number,
  maxTranslationSpeed: number,
  maxRotationSpeed: number,
): void {
  let realMaxSpeed = 0.0;
  for (const s of moduleStates) {
    realMaxSpeed = Math.max(realMaxSpeed, Math.abs(s.speedMPS));
  }
  if (realMaxSpeed === 0) return;

  let translationPct = 0.0;
  if (Math.abs(maxTranslationSpeed) > 1e-8) {
    translationPct =
      Math.hypot(desiredSpeeds.vx, desiredSpeeds.vy) / maxTranslationSpeed;
  }
  let rotationPct = 0.0;
  if (Math.abs(maxRotationSpeed) > 1e-8) {
    rotationPct = Math.abs(desiredSpeeds.omega) / Math.abs(maxRotationSpeed);
  }
  const maxPct = Math.max(translationPct, rotationPct);

  let scale = Math.min(1.0, maxModuleSpeedMPS / realMaxSpeed);
  if (maxPct > 0) {
    scale = Math.min(scale, 1.0 / maxPct);
  }
  for (const s of moduleStates) {
    s.speedMPS *= scale;
  }
}

/** Rotate field-frame speeds into the robot frame. */
export function fieldToRobot(speeds: ChassisSpeeds, robotAngle: number): ChassisSpeeds {
  const c = Math.cos(-robotAngle);
  const s = Math.sin(-robotAngle);
  return {
    vx: speeds.vx * c - speeds.vy * s,
    vy: speeds.vx * s + speeds.vy * c,
    omega: speeds.omega,
  };
}

/** Rotate robot-frame speeds into the field frame. */
export function robotToField(speeds: ChassisSpeeds, robotAngle: number): ChassisSpeeds {
  const c = Math.cos(robotAngle);
  const s = Math.sin(robotAngle);
  return {
    vx: speeds.vx * c - speeds.vy * s,
    vy: speeds.vx * s + speeds.vy * c,
    omega: speeds.omega,
  };
}
