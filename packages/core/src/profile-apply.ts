/**
 * Applying an imported robot profile to a trajectory (red book §6.6
 * companion read, landed 2026-10-04).
 *
 * Geometry always applies. When the profile carries drive-train dynamics
 * and the trajectory is a regenerable PathPlanner import (`.path` files
 * carry no samples — their timeline comes from generation against a robot
 * config), the timeline is regenerated against the real robot instead of
 * the app default: the "timing is an estimate" story ends there. Choreo
 * imports embed their samples and are never regenerated.
 *
 * The path's own constraint set is authoritative: a file marked
 * `unlimited` regenerates unlimited — profile generation defaults are
 * parsed data only and never backfill a path. Upstream at v2025.2.7
 * (lib/path/pathplanner_path.dart, verified at the pinned tag) loads
 * globalConstraints verbatim via `PathConstraints.fromJson(
 * json['globalConstraints'] ?? {})` and `_constraintsForPos` maps
 * `unlimited` to double-infinity constraints without ever merging project
 * settings into a loaded path.
 *
 * resolveRobotConfig is the single profile→generator-config seam: it maps
 * the profile onto a RobotConfig and records per-parameter provenance
 * (file / default / invalid / unsupported) for downstream timing honesty.
 */

import { DCMotor } from './pathplanner/dc-motor';
import { generateTrajectory } from './pathplanner/generation';
import { makeRobotConfig } from './pathplanner/robot-config';
import type { RobotConfig } from './pathplanner/robot-config';
import type { RobotProfile } from './parsers/robot-profile';
import type { Trajectory, TrajectorySample } from './types';
import { trajectoryDuration } from './types';

/** Generation-relevant dynamics parameters tracked in provenance. */
export type DynamicsParamKey =
  | 'massKG'
  | 'moiKGm2'
  | 'wheelCOF'
  | 'wheelRadiusM'
  | 'driveGearing'
  | 'maxDriveVelocityMPS'
  | 'driveMotorType'
  | 'driveCurrentLimitA'
  | 'moduleLocations'
  | 'holonomic';

/**
 * Where each parameter came from: 'file' = the profile carried a
 * guard-passing value; 'invalid' = present but rejected (parser guard or the
 * non-positive checks here); 'unsupported' = a motor string no known model
 * matches; 'default' = absent, the generator default applies.
 */
export type DynamicsParamSource = 'file' | 'default' | 'invalid' | 'unsupported';
export type DynamicsProvenance = Partial<Record<DynamicsParamKey, DynamicsParamSource>>;

export interface ResolvedRobotConfig {
  config: RobotConfig;
  provenance: DynamicsProvenance;
  /** Raw motor string when driveMotorType is not a known model. */
  unknownMotorType?: string;
}

const DYNAMICS_PARAM_KEYS: readonly DynamicsParamKey[] = [
  'massKG',
  'moiKGm2',
  'wheelCOF',
  'wheelRadiusM',
  'driveGearing',
  'maxDriveVelocityMPS',
  'driveMotorType',
  'driveCurrentLimitA',
  'moduleLocations',
  'holonomic',
];

/** Every generation input comes from the file — nothing fell back. */
export function dynamicsConfigComplete(provenance: DynamicsProvenance): boolean {
  return DYNAMICS_PARAM_KEYS.every((key) => provenance[key] === 'file');
}

/**
 * The single profile→generator-config seam: maps a RobotProfile onto a
 * RobotConfig and records, per parameter, whether the value came from the
 * file, was invalid, is an unsupported motor, or fell back to the default.
 * Mirrors upstream RobotConfig.fromPrefs / ModuleConfig.fromPrefs
 * (lib/trajectory/config.dart at v2025.2.7): numMotors = holonomic ? 1 : 2,
 * driveMotor = DCMotor.fromString(type, numMotors).withReduction(gearing ?? 5.143)
 * (upstream substitutes Defaults.driveGearing when the pref is absent; here
 * the reduction is provenance-gated so a non-positive gearing from an
 * untrusted hand-built profile also falls back to 5.143, never scales the
 * motor with the invalid value), driveCurrentLimit = per-motor file value ×
 * numMotors (the config field is the per-module total; the file field is
 * per motor).
 *
 * The profile's defaultNominalVoltage is deliberately not substituted into
 * the path constraints: upstream generation takes applied voltage only from
 * the path's own constraint sets (pathplanner_path.dart _constraintsForPos
 * L383-404 keeps globalConstraints.nominalVoltage even when unlimited;
 * PathConstraints.fromJson defaults it to 12.0 when absent) and never merges
 * project defaults into a loaded path.
 */
export function resolveRobotConfig(profile: RobotProfile): ResolvedRobotConfig {
  const d = profile.dynamics ?? {};
  const rejected = profile.rejectedGenerationFields ?? {};

  // 'file' for a positive finite value, 'invalid' when the value is present
  // but unusable (non-positive here, or dropped by the parser's guards and
  // recorded in rejectedGenerationFields), 'default' when absent. External
  // profiles are untrusted: nonsense values never reach the dynamics.
  const scalar = (value: number | undefined, rejectedField: string): DynamicsParamSource =>
    value !== undefined && value > 0
      ? 'file'
      : value !== undefined || rejected[rejectedField] !== undefined
        ? 'invalid'
        : 'default';

  let unknownMotorType: string | undefined;
  let driveMotorSource: DynamicsParamSource;
  if (d.driveMotorType !== undefined) {
    if (DCMotor.isKnownMotorType(d.driveMotorType)) {
      driveMotorSource = 'file';
    } else {
      driveMotorSource = 'unsupported';
      unknownMotorType = d.driveMotorType;
    }
  } else {
    driveMotorSource = rejected.driveMotorType !== undefined ? 'invalid' : 'default';
  }

  const sources: Record<DynamicsParamKey, DynamicsParamSource> = {
    massKG: scalar(d.massKG, 'robotMass'),
    moiKGm2: scalar(d.moiKGm2, 'robotMOI'),
    wheelCOF: scalar(d.wheelCOF, 'wheelCOF'),
    wheelRadiusM: scalar(d.wheelRadiusM, 'driveWheelRadius'),
    driveGearing: scalar(d.driveGearing, 'driveGearing'),
    maxDriveVelocityMPS: scalar(d.maxDriveVelocityMPS, 'maxDriveSpeed'),
    driveMotorType: driveMotorSource,
    driveCurrentLimitA: scalar(d.driveCurrentLimitA, 'driveCurrentLimit'),
    moduleLocations: profile.moduleLocations.length > 0 ? 'file' : 'default',
    holonomic: typeof profile.holonomic === 'boolean' ? 'file' : 'default',
  };

  const fromFile = (source: DynamicsParamSource, value: number | undefined): number | undefined =>
    source === 'file' ? value : undefined;
  const numMotors = profile.holonomic === false ? 2 : 1;
  const knownMotor = driveMotorSource === 'file' ? d.driveMotorType : undefined;
  const config = makeRobotConfig({
    massKG: fromFile(sources.massKG, d.massKG),
    moi: fromFile(sources.moiKGm2, d.moiKGm2),
    holonomic: profile.holonomic,
    moduleLocations: profile.moduleLocations.length > 0 ? profile.moduleLocations : undefined,
    moduleConfig: {
      wheelRadiusM: fromFile(sources.wheelRadiusM, d.wheelRadiusM),
      maxDriveVelocityMPS: fromFile(sources.maxDriveVelocityMPS, d.maxDriveVelocityMPS),
      driveGearing: fromFile(sources.driveGearing, d.driveGearing),
      wheelCOF: fromFile(sources.wheelCOF, d.wheelCOF),
      driveMotor:
        knownMotor !== undefined
          ? DCMotor.fromString(knownMotor, numMotors).withReduction(
              fromFile(sources.driveGearing, d.driveGearing) ?? 5.143,
            )
          : undefined,
      // File value is per motor; the config limit is the per-module total.
      driveCurrentLimitA:
        sources.driveCurrentLimitA === 'file' && d.driveCurrentLimitA !== undefined
          ? d.driveCurrentLimitA * numMotors
          : undefined,
    },
  });
  return { config, provenance: sources, unknownMotorType };
}

/**
 * Apply a profile to one trajectory. Pure: returns a derived copy, source
 * data untouched. The applied provenance (geometrySource='file') engages
 * the v1.14 read-only lock upstream.
 */
export function applyProfileToTrajectory(traj: Trajectory, profile: RobotProfile): Trajectory {
  const base: Trajectory = {
    ...traj,
    geometry: profile.geometry,
    moduleLocations:
      profile.moduleLocations.length > 0 ? profile.moduleLocations : traj.moduleLocations,
    geometrySource: 'file',
    massKG: profile.massKG,
    holonomic: profile.holonomic,
  };

  const editable = traj.editable;
  const d = profile.dynamics;
  if (editable?.kind !== 'pathplanner' || !d) return base;

  // Real-robot regeneration through the profile→config seam. Fields the
  // profile omits (or that were rejected as invalid) fall back to the
  // generator defaults one by one, so a mass-only profile still re-times
  // the path on real mass. The path is regenerated verbatim: an unlimited
  // global-constraints marker stays unlimited — upstream v2025.2.7
  // (lib/path/pathplanner_path.dart, verified at the pinned tag) loads
  // globalConstraints from the file JSON as-is and maps `unlimited` to
  // unconstrained values in _constraintsForPos without merging project
  // settings, so profile generation defaults never backfill the path.
  const { config, unknownMotorType } = resolveRobotConfig(profile);
  const path = editable.path;
  const generated = generateTrajectory(path, config);
  if (generated.samples.length < 2) return base;
  const samples = generated.samples as TrajectorySample[];
  return {
    ...base,
    editable: { kind: 'pathplanner', path },
    samples,
    durationS: trajectoryDuration(samples),
    events: generated.events,
    warnings: [
      `regenerated with real robot config from profile "${profile.name}"`,
      ...(unknownMotorType
        ? [
            `drive motor "${unknownMotorType}" not supported (timing uses the default Kraken X60 model)`,
          ]
        : []),
      // Same condition as the parse-time warning (parsers/pathplanner-path.ts):
      // it lives in the trajectory warnings, not parseWarnings, so
      // regeneration re-issues it for a path that is still unlimited.
      ...(!Number.isFinite(path.globalConstraints.maxVelocityMPS)
        ? ['path has unlimited global constraints; results may be unrealistic']
        : []),
      ...path.parseWarnings,
    ],
  };
}
