/**
 * Applying an imported robot profile to a trajectory (red book §6.6
 * companion read, landed 2026-10-04).
 *
 * Geometry always applies. When the profile carries drive-train dynamics
 * and the trajectory is a regenerable PathPlanner import (`.path` files and
 * `.auto` routines carry no samples — their timeline comes from generation
 * against a robot config), the timeline is regenerated against the real
 * robot instead of the app default. The regenerated trajectory records its
 * timing provenance (Trajectory.timingSource): 'full-config' when every
 * dynamics parameter came from the profile, 'partial-config' when some
 * still fall back to defaults — the warning then names them, so a partial
 * application never erases the estimate story (§16.39 direction 4).
 * Full-config is still a plan, never a measurement of the real robot.
 * Choreo imports embed their samples and are never regenerated (timingSource
 * stays undefined); WPILOG-derived trajectories are logged reality, never
 * regenerated either (timingSource stays 'logged').
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
 *
 * applyProfileToRobot is the robot-level entry every UI surface (upload,
 * select, folder import) delegates to: one call applies the profile to the
 * current trajectory and every route option, so composed sequences — which
 * resolve through routeOptions — always see the same config. The single-path
 * seam regeneratePathTimeline owns the timing state for whichever config
 * regenerated a timeline (profile or default), so an edited trajectory can
 * never carry a stale provenance claim.
 */

import { DCMotor } from './pathplanner/dc-motor';
import { generateTrajectory } from './pathplanner/generation';
import { generateAutoTrajectory } from './parsers/pathplanner-auto';
import { makeRobotConfig } from './pathplanner/robot-config';
import type { RobotConfig } from './pathplanner/robot-config';
import type { ParsedPath } from './pathplanner/path-model';
import type { RobotProfile } from './parsers/robot-profile';
import type { SessionTrajectory } from './session';
import type { TimingSource, Trajectory, TrajectoryEvent, TrajectorySample } from './types';
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
 * Timing state + honesty warnings for a regeneration against a profile
 * config. "regenerated with real robot config" is reserved for a complete
 * config; a partial config keeps the estimate story with the defaulted
 * parameters named (§16.39 direction 4). An unknown motor string appends
 * the fallback note regardless of completeness (it always costs full
 * completeness anyway).
 */
function configTimingWarnings(
  profile: RobotProfile,
  provenance: DynamicsProvenance,
  unknownMotorType: string | undefined,
): { timingSource: TimingSource; warnings: string[] } {
  const warnings: string[] = [];
  let timingSource: TimingSource;
  if (dynamicsConfigComplete(provenance)) {
    timingSource = 'full-config';
    warnings.push(`regenerated with real robot config from profile "${profile.name}"`);
  } else {
    timingSource = 'partial-config';
    const defaulted = DYNAMICS_PARAM_KEYS.filter((key) => provenance[key] !== 'file');
    warnings.push(
      `timing re-estimated with partial robot config from profile "${profile.name}" — defaults fill: ${defaulted.join(', ')}`,
    );
  }
  if (unknownMotorType) {
    warnings.push(
      `drive motor "${unknownMotorType}" not supported (timing uses the default Kraken X60 model)`,
    );
  }
  return { timingSource, warnings };
}

/**
 * Upstream-identical physics can degenerate: with e.g. ≤~30 A per motor the
 * torque-loss term at max drive speed cancels acceleration entirely and the
 * generator emits samples that never leave t=0 (trajectory.dart torqueLoss
 * at v2025.2.7). A zero-duration timeline must not read as a valid plan.
 */
function zeroDurationWarning(durationS: number): string[] {
  return durationS === 0
    ? ['generated timeline has zero duration — the robot cannot move under this config; not a valid motion plan']
    : [];
}

/** The parse-time default-config estimate (parsers/pathplanner-path.ts
 * writes the identical notice at import); a regeneration that falls back to
 * the default robot re-issues it. */
const DEFAULT_CONFIG_TIMING_WARNING =
  'generated with default robot config (Kraken X60 swerve) — timing is an estimate; attach a PathPlanner settings.json profile for real geometry and timing';

/** One regenerated .path timeline plus the timing state for the config that
 * produced it. */
export interface PathRegeneration {
  samples: TrajectorySample[];
  durationS: number;
  events: TrajectoryEvent[];
  timingSource: TimingSource;
  warnings: string[];
}

/**
 * Regenerate one .path timeline — against the profile's config when it
 * carries dynamics, else the app default — and rebuild the timing state and
 * warnings for the config actually used. Shared by applyProfileToTrajectory
 * and reparameterize so whichever config regenerated the samples owns the
 * provenance claim: an edited trajectory never keeps a stale full-config or
 * zero-duration story from an earlier regeneration under a different config.
 * Undefined when the generator degenerates below two samples; callers keep
 * their previous timeline then.
 */
export function regeneratePathTimeline(path: ParsedPath, profile?: RobotProfile): PathRegeneration | undefined {
  const resolved = profile?.dynamics ? resolveRobotConfig(profile) : undefined;
  const generated = generateTrajectory(path, resolved?.config ?? makeRobotConfig());
  if (generated.samples.length < 2) return undefined;
  const samples = generated.samples as TrajectorySample[];
  const durationS = trajectoryDuration(samples);
  const state = profile && resolved
    ? configTimingWarnings(profile, resolved.provenance, resolved.unknownMotorType)
    : { timingSource: 'default-config' as const, warnings: [DEFAULT_CONFIG_TIMING_WARNING] };
  const warnings = [
    ...state.warnings,
    // Same condition as the parse-time warning (parsers/pathplanner-path.ts):
    // it lives in the trajectory warnings so every regeneration re-issues it
    // for a path that is still unlimited.
    ...(!Number.isFinite(path.globalConstraints.maxVelocityMPS)
      ? ['path has unlimited global constraints; results may be unrealistic']
      : []),
    ...zeroDurationWarning(durationS),
    ...path.parseWarnings,
  ];
  return { samples, durationS, events: generated.events, timingSource: state.timingSource, warnings };
}

/**
 * Apply a profile to a whole robot: the current trajectory and every route
 * option. Composed sequences resolve through routeOptions, so they see the
 * regenerated timelines too — no separate handling needed. Bookkeeping
 * (profileOptions/profileId) stays with the caller; geometry-guarded entry
 * points decide before calling. Pure: returns a derived copy.
 */
export function applyProfileToRobot(robot: SessionTrajectory, profile: RobotProfile): SessionTrajectory {
  const apply = (trajectory: Trajectory): Trajectory => applyProfileToTrajectory(trajectory, profile);
  return {
    ...robot,
    trajectory: apply(robot.trajectory),
    routeOptions: robot.routeOptions?.map((option) => ({ ...option, trajectory: apply(option.trajectory) })),
  };
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
  if (!d) return base;

  if (editable?.kind === 'pathplanner') {
    // Real-robot regeneration through the profile→config seam. Fields the
    // profile omits (or that were rejected as invalid) fall back to the
    // generator defaults one by one, so a mass-only profile still re-times
    // the path on real mass — and the timing state says which story that is.
    // The path is regenerated verbatim: an unlimited global-constraints
    // marker stays unlimited — upstream v2025.2.7
    // (lib/path/pathplanner_path.dart, verified at the pinned tag) loads
    // globalConstraints from the file JSON as-is and maps `unlimited` to
    // unconstrained values in _constraintsForPos without merging project
    // settings, so profile generation defaults never backfill the path.
    const path = editable.path;
    const regenerated = regeneratePathTimeline(path, profile);
    if (!regenerated) return base;
    return {
      ...base,
      editable: { kind: 'pathplanner', path },
      ...regenerated,
    };
  }

  if (editable?.kind === 'pathplanner-auto') {
    // Routines regenerate the same way as single paths: every referenced
    // path re-generates against the profile config and the segments chain
    // again (waits/named commands are structure, not config-dependent).
    // generateAutoTrajectory reports command-tree, per-path parse, and
    // chaining warnings only — it never claims a config (the generator
    // default claim belongs to parsePathPlannerAuto; timing warnings
    // against the applied profile are built by the timing layer).
    const { config, provenance, unknownMotorType } = resolveRobotConfig(profile);
    const { timingSource, warnings } = configTimingWarnings(profile, provenance, unknownMotorType);
    const auto = editable.auto;
    const generated = generateAutoTrajectory(auto, config);
    if (generated.samples.length < 2) return base;
    // Same unlimited-constraints honesty marker the single-path branch
    // re-issues: regenerating through a routine must not lose it.
    if (Object.values(auto.paths).some((p) => !Number.isFinite(p.globalConstraints.maxVelocityMPS))) {
      warnings.push('path has unlimited global constraints; results may be unrealistic');
    }
    const durationS = trajectoryDuration(generated.samples);
    warnings.push(...zeroDurationWarning(durationS), ...generated.warnings);
    return {
      ...base,
      editable: { kind: 'pathplanner-auto', auto },
      samples: generated.samples,
      durationS,
      events: generated.events,
      timingSource,
      warnings,
    };
  }

  return base;
}
