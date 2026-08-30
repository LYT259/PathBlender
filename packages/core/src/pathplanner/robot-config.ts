/**
 * Robot configuration for PathPlanner trajectory generation.
 * Defaults mirror the PathPlanner GUI (MIT) lib/util/prefs.dart Defaults —
 * a Kraken X60 swerve typical of current FRC robots. .path files do not
 * carry robot configs, so imports generate against these defaults
 * (user-adjustable later via the same UI as bumper geometry).
 */

import type { RobotGeometry } from '../types';
import { DCMotor } from './dc-motor';

export interface ModuleConfig {
  wheelRadiusM: number;
  maxDriveVelocityMPS: number;
  driveMotor: DCMotor;
  driveCurrentLimitA: number;
  wheelCOF: number;
}

export interface RobotConfig {
  massKG: number;
  moi: number;
  holonomic: boolean;
  moduleLocations: { x: number; y: number }[];
  moduleConfig: ModuleConfig;
  /** Per-module friction force N = COF * mass * g / numModules. */
  wheelFrictionForce: number;
  /** Max torque before wheels slip, per module (N·m). */
  maxTorqueFriction: number;
}

export function makeRobotConfig(partial?: {
  massKG?: number;
  moi?: number;
  holonomic?: boolean;
  moduleLocations?: { x: number; y: number }[];
  moduleConfig?: Partial<ModuleConfig> & {
    driveMotor?: DCMotor;
    driveGearing?: number;
  };
}): RobotConfig {
  const numMotors = partial?.holonomic === false ? 2 : 1;
  const mm = partial?.moduleConfig ?? {};
  const moduleConfig: ModuleConfig = {
    wheelRadiusM: mm.wheelRadiusM ?? 0.048,
    maxDriveVelocityMPS: mm.maxDriveVelocityMPS ?? 5.45,
    driveMotor:
      mm.driveMotor ??
      DCMotor.getKrakenX60(numMotors).withReduction(mm.driveGearing ?? 5.143),
    driveCurrentLimitA: mm.driveCurrentLimitA ?? 60 * numMotors,
    wheelCOF: mm.wheelCOF ?? 1.2,
  };
  const numModules = partial?.moduleLocations?.length ?? 4;
  const massKG = partial?.massKG ?? 74.088;
  return {
    massKG,
    moi: partial?.moi ?? 6.883,
    holonomic: partial?.holonomic ?? true,
    moduleLocations:
      partial?.moduleLocations ??
      (partial?.holonomic === false
        ? [
            { x: 0, y: 0.546 / 2 },
            { x: 0, y: -0.546 / 2 },
          ]
        : [
            { x: 0.273, y: 0.273 },
            { x: 0.273, y: -0.273 },
            { x: -0.273, y: 0.273 },
            { x: -0.273, y: -0.273 },
          ]),
    moduleConfig,
    wheelFrictionForce:
      (moduleConfig.wheelCOF * massKG * 9.8) / numModules,
    maxTorqueFriction:
      ((moduleConfig.wheelCOF * massKG * 9.8) / numModules) *
      moduleConfig.wheelRadiusM,
  };
}

/** Bumper geometry corresponding to the default config (GUI 0.9 × 0.9). */
export function defaultConfigGeometry(): RobotGeometry {
  return { lengthM: 0.9, widthM: 0.9, offsetX: 0, offsetY: 0 };
}
