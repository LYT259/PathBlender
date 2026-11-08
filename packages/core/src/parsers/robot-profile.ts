/**
 * Robot profile files: bumper geometry + module layout imported as data,
 * applied to a robot's collision footprint (user request 2026-09-20).
 *
 * Recognized today are two project settings formats, in both cases by
 * shape — never the file name:
 * - PathPlanner settings.json (format facts, MIT-licensed upstream):
 *   - v2025.2.7 (authoritative): every field top-level flat —
 *     { robotWidth, robotLength, holonomicMode, robotMass, robotMOI,
 *     wheelCOF, driveWheelRadius, driveGearing, maxDriveSpeed,
 *     driveMotorType, driveCurrentLimit, flModuleX…brModuleY,
 *     robotTrackwidth, defaultMaxVel, defaultMaxAccel, defaultMaxAngVel,
 *     defaultMaxAngAccel, defaultNominalVoltage, … } (verified against
 *     home_page.dart _saveProjectSettingsToFile at tag v2025.2.7)
 *   - 2024 compat: { robotConfig: { robotWidth, robotLength, modules:
 *     [{x,y},…], … }, generationSettings: {…} }
 *   - 2023- compat: top-level { robotWidth, robotLength, moduleLocations:
 *     [{x,y},…], isHolonomic }
 * - Choreo project file `.chor` (red book v1.15, §6.6 companion read):
 *   { name, version, type: "Swerve"|"Differential", config: { bumper:
 *   {front,side,back}, frontLeft, backLeft, mass, … } } — the config
 *   section mirrors the embedded .traj config, but project-form values
 *   may be expression-wrapped {exp, val} pairs ("65 kg" / 65).
 * Anything else returns null so the caller can keep looking for a
 * trajectory — and a project file without a usable bumper is likewise
 * not a profile (there would be nothing to apply).
 */

import type { ModuleLocation, RobotGeometry } from '../types';
import { DEFAULT_GEOMETRY } from '../types';
import { asArray, asRecord, num, parseJson } from './json';

/**
 * Drive-train dynamics carried by a profile, consumed when regenerating
 * PathPlanner `.path` imports so the timeline reflects the real robot
 * instead of the app default (red book §6.6 consumption matrix, landed
 * 2026-10-04). Every field is optional and plausibility-guarded at its
 * mapping site; a profile carrying none of these regenerates nothing.
 */
export interface ProfileDynamics {
  massKG?: number;
  /** Moment of inertia about the center of rotation, kg·m². */
  moiKGm2?: number;
  wheelCOF?: number;
  wheelRadiusM?: number;
  driveGearing?: number;
  /** Free speed at the wheel, m/s (derived from motor-shaft values). */
  maxDriveVelocityMPS?: number;
  /** Raw upstream `driveMotorType` string (e.g. 'krakenX60', 'falcon500FOC');
   * motor-model resolution and unknown-type handling happen downstream. */
  driveMotorType?: string;
  /** Upstream `driveCurrentLimit`, amps per drive motor exactly as written in
   * the file (upstream multiplies by motor count when building its module
   * config, RobotConfig.fromPrefs at v2025.2.7). */
  driveCurrentLimitA?: number;
}

/** PP settings.json generation defaults, carried as parsed project data. */
export interface ProfileDefaultConstraints {
  maxVelMPS?: number;
  maxAccelMPSS?: number;
  maxAngVelRadPS?: number;
  maxAngAccelRadPSSq?: number;
  /** Upstream `defaultNominalVoltage`, volts — caps the motor model during
   * generation (trajectory.dart feeds it into the current calculation). */
  nominalVoltageV?: number;
}

export interface RobotProfile {
  name: string;
  /** Bumper box for collision checking. */
  geometry: RobotGeometry;
  moduleLocations: ModuleLocation[];
  /** Extras carried for display; optional in every source format. */
  massKG?: number;
  holonomic?: boolean;
  /** Drive-train numbers for `.path` regeneration; absent → geometry-only. */
  dynamics?: ProfileDynamics;
  /** Project-wide generation defaults; only recognized in PP settings.json. */
  defaultConstraints?: ProfileDefaultConstraints;
  /**
   * Generation-relevant fields the file carried but whose values the guards
   * rejected: upstream settings.json field name (e.g. 'driveCurrentLimit') →
   * raw value as found in the file. Distinguishes "invalid" from "absent"
   * for downstream per-parameter provenance (consumed by the config
   * resolver; Task 2 provenance 'invalid' state). Undefined on clean files.
   */
  rejectedGenerationFields?: Readonly<Record<string, unknown>>;
}

/** Plausible free speed at the wheel — guards a misread vmax unit. */
function plausibleWheelSpeedMPS(v: number): boolean {
  return v > 0.5 && v < 15;
}

/**
 * v2025.2.7 flat module corners, in the same stable order upstream
 * RobotConfig.fromPrefs builds its layout: [fl, fr, bl, br]. All eight
 * values must be finite or the flat set counts as absent (all-or-nothing)
 * and the caller falls back to the legacy nested arrays.
 */
const FLAT_MODULE_KEYS = [
  ['flModuleX', 'flModuleY'],
  ['frModuleX', 'frModuleY'],
  ['blModuleX', 'blModuleY'],
  ['brModuleX', 'brModuleY'],
] as const;

function readFlatModuleLocations(source: Record<string, unknown>): ModuleLocation[] | null {
  const corners: ModuleLocation[] = [];
  for (const [xKey, yKey] of FLAT_MODULE_KEYS) {
    const x = num(source[xKey], Number.NaN);
    const y = num(source[yKey], Number.NaN);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    corners.push({ x, y });
  }
  return corners;
}

function readModuleLocations(source: Record<string, unknown>): ModuleLocation[] {
  return readFlatModuleLocations(source) ?? readNestedModuleLocations(source);
}

function readNestedModuleLocations(source: Record<string, unknown>): ModuleLocation[] {
  const raw = asArray(source.modules) ?? asArray(source.moduleLocations);
  if (!raw) return [];
  const locations: ModuleLocation[] = [];
  for (const entry of raw) {
    const m = asRecord(entry);
    if (!m) continue;
    const x = num(m.x, NaN);
    const y = num(m.y, NaN);
    if (Number.isFinite(x) && Number.isFinite(y)) locations.push({ x, y });
  }
  return locations;
}

/**
 * Shared Choreo config → geometry mapper, consumed from two places
 * (red book v1.15: one mapper, two consumers): the embedded `.traj`
 * `trajectory.config` snapshot and the `.chor` project config section
 * (same fields — format facts from real samples 2026-09-12).
 *
 * bumper {front, side, back} are half-extents from chassis center to
 * bumper outer edge (e.g. 0.4064 → 0.81 m overall, plausible for a
 * ~32 in chassis). Module corner positions give the wheel layout.
 */
export function geometryFromConfig(cfg: Record<string, unknown>): {
  geometry: RobotGeometry;
  modules: ModuleLocation[];
  fromFile: boolean;
} {
  const bumper = asRecord(cfg.bumper);
  const front = bumper ? num(bumper.front, Number.NaN) : Number.NaN;
  const side = bumper ? num(bumper.side, Number.NaN) : Number.NaN;
  const back = bumper ? num(bumper.back, Number.NaN) : Number.NaN;
  const hasBumper =
    Number.isFinite(front) && Number.isFinite(side) && Number.isFinite(back);

  const fl = asRecord(cfg.frontLeft);
  const bl = asRecord(cfg.backLeft);
  const modules: ModuleLocation[] = [];
  if (fl && bl) {
    const flx = num(fl.x, Number.NaN);
    const fly = num(fl.y, Number.NaN);
    const blx = num(bl.x, Number.NaN);
    const bly = num(bl.y, Number.NaN);
    if ([flx, fly, blx, bly].every(Number.isFinite)) {
      // Symmetric swerve layout: mirror the left modules to the right.
      modules.push(
        { x: flx, y: fly },
        { x: flx, y: -fly },
        { x: blx, y: bly },
        { x: blx, y: -bly },
      );
    }
  }

  if (!hasBumper) {
    return { geometry: DEFAULT_GEOMETRY, modules, fromFile: false };
  }
  const len = front + back;
  const wid = side * 2;
  // Guard against nonsense half-extent interpretations (e.g. depth reading).
  const plausible = len > 0.3 && len < 1.6 && wid > 0.3 && wid < 1.6;
  return {
    geometry: plausible
      ? { lengthM: len, widthM: wid, offsetX: (front - back) / 2, offsetY: 0 }
      : DEFAULT_GEOMETRY,
    modules,
    fromFile: plausible,
  };
}

/**
 * Project-form config values may be expression-wrapped ({exp: '65 kg',
 * val: 65}); the embedded .traj form carries plain numbers. Unwrap the
 * pairs so both forms feed the same geometryFromConfig. Depth-capped:
 * external files are untrusted.
 */
function unwrapExprValues(v: unknown, depth: number): unknown {
  const rec = asRecord(v);
  if (!rec || depth > 6) return v;
  const keys = Object.keys(rec);
  if (
    keys.length === 2 &&
    typeof rec.exp === 'string' &&
    typeof rec.val === 'number' &&
    Number.isFinite(rec.val)
  ) {
    return rec.val;
  }
  const out: Record<string, unknown> = {};
  for (const k of keys) out[k] = unwrapExprValues(rec[k], depth + 1);
  return out;
}

/**
 * Choreo config dynamics (mass/inertia/gearing/radius/vmax/cof — the same
 * section the geometry comes from, physically verified 2026-09-12). vmax is
 * a motor-shaft angular velocity: wheel free speed = vmax/gearing·radius.
 * The sample project (5100 RPM motor, 7.15 gearing, 48.2 mm wheels) maps to
 * ≈3.6 m/s under this reading; the guard rejects unit misreads instead of
 * shipping an absurd drive limit. tmax is NOT mapped: building the
 * generator's electrical motor model needs stall/free currents the config
 * does not carry.
 */
function choreoDynamics(unwrapped: Record<string, unknown>): ProfileDynamics | undefined {
  const massKG = num(unwrapped.mass, Number.NaN);
  const moiKGm2 = num(unwrapped.inertia, Number.NaN);
  const wheelCOF = num(unwrapped.cof, Number.NaN);
  const wheelRadiusM = num(unwrapped.radius, Number.NaN);
  const driveGearing = num(unwrapped.gearing, Number.NaN);
  const vmax = num(unwrapped.vmax, Number.NaN);
  const maxDriveVelocityMPS =
    Number.isFinite(vmax) && Number.isFinite(driveGearing) && Number.isFinite(wheelRadiusM)
      ? (vmax / driveGearing) * wheelRadiusM
      : Number.NaN;
  const dynamics: ProfileDynamics = {
    massKG: Number.isFinite(massKG) ? massKG : undefined,
    moiKGm2: Number.isFinite(moiKGm2) ? moiKGm2 : undefined,
    wheelCOF: Number.isFinite(wheelCOF) && wheelCOF > 0 ? wheelCOF : undefined,
    wheelRadiusM: Number.isFinite(wheelRadiusM) && wheelRadiusM > 0 ? wheelRadiusM : undefined,
    driveGearing: Number.isFinite(driveGearing) && driveGearing > 0 ? driveGearing : undefined,
    maxDriveVelocityMPS: plausibleWheelSpeedMPS(maxDriveVelocityMPS)
      ? maxDriveVelocityMPS
      : undefined,
  };
  return Object.values(dynamics).some((v) => v !== undefined) ? dynamics : undefined;
}

/**
 * The Choreo project shape: a top-level drive `type` plus a config
 * section carrying a usable bumper. `type` is the drive-mode authority
 * (red book v1.15): "Swerve" is holonomic, anything else is not.
 */
function choreoProjectProfile(
  root: Record<string, unknown>,
  fileName: string,
): RobotProfile | null {
  if (typeof root.type !== 'string') return null;
  const cfg = asRecord(root.config);
  if (!cfg) return null;
  const unwrapped = asRecord(unwrapExprValues(cfg, 0));
  if (!unwrapped) return null;
  const { geometry, modules, fromFile } = geometryFromConfig(unwrapped);
  if (!fromFile) return null;
  const massKG = num(unwrapped.mass, Number.NaN);
  return {
    name: profileNameFromPath(fileName),
    geometry,
    moduleLocations: modules,
    massKG: Number.isFinite(massKG) ? massKG : undefined,
    holonomic: root.type === 'Swerve',
    dynamics: choreoDynamics(unwrapped),
  };
}

/**
 * PP settings.json dynamics + generation defaults. Field names are the
 * v2025.2.7 top-level flat keys (verified against home_page.dart at the
 * pinned tag; the 2024 nested robotConfig/generationSettings shapes stay
 * supported as compatibility coverage). The only real sample today is the
 * upstream example settings.json under samples/pathplanner/reference/
 * (complete flat config); the sample library otherwise carries none of
 * these fields, so every field is optional and a file without them yields
 * no dynamics — behavior is then unchanged. 实测留待：遇到携带动力学字段
 * 的真机 settings.json 时回填样本.
 *
 * Present in the v2025.2.7 file but not consumed here:
 * - pathFolders, autoFolders — UI tree organization only, no generation role.
 * - robotFeatures — field-overlay display features (serialized feature JSON).
 * - bumperOffsetX/bumperOffsetY — bumper-box display/collision offset; no
 *   timing effect (candidate for future geometry mapping, not a generation
 *   input; robotWidth/robotLength already feed RobotGeometry).
 * - robotTrackwidth — consumed one level up (diff-drive module layout when
 *   holonomicMode is false), not a scalar dynamics field.
 */
function ppDynamics(source: Record<string, unknown>): {
  dynamics?: ProfileDynamics;
  rejected?: Record<string, unknown>;
} {
  const rejected: Record<string, unknown> = {};
  /** Record a present-but-rejected field: invalid ≠ absent for provenance. */
  const reject = (field: string, raw: unknown, ok: boolean): void => {
    if (raw !== undefined && !ok) rejected[field] = raw;
  };

  const massRaw = source.robotMass ?? source.robotMassKg;
  const moiRaw = source.robotMOI;
  const cofRaw = source.wheelCOF;
  const radiusRaw = source.driveWheelRadius;
  const gearingRaw = source.driveGearing;
  const maxSpeedRaw = source.maxDriveSpeed;
  const motorRaw = source.driveMotorType;
  const currentRaw = source.driveCurrentLimit;

  const massKG = num(massRaw, Number.NaN);
  const moiKGm2 = num(moiRaw, Number.NaN);
  const wheelCOF = num(cofRaw, Number.NaN);
  const wheelRadiusM = num(radiusRaw, Number.NaN);
  const driveGearing = num(gearingRaw, Number.NaN);
  const maxDriveVelocityMPS = num(maxSpeedRaw, Number.NaN);
  const driveMotorType =
    typeof motorRaw === 'string' && motorRaw.length > 0 ? motorRaw : undefined;
  const driveCurrentLimitA = num(currentRaw, Number.NaN);

  reject('robotMass', massRaw, Number.isFinite(massKG));
  reject('robotMOI', moiRaw, Number.isFinite(moiKGm2));
  reject('wheelCOF', cofRaw, Number.isFinite(wheelCOF) && wheelCOF > 0);
  reject('driveWheelRadius', radiusRaw, Number.isFinite(wheelRadiusM) && wheelRadiusM > 0);
  reject('driveGearing', gearingRaw, Number.isFinite(driveGearing) && driveGearing > 0);
  reject('maxDriveSpeed', maxSpeedRaw, plausibleWheelSpeedMPS(maxDriveVelocityMPS));
  reject('driveMotorType', motorRaw, driveMotorType !== undefined);
  reject('driveCurrentLimit', currentRaw, Number.isFinite(driveCurrentLimitA) && driveCurrentLimitA > 0);

  const dynamics: ProfileDynamics = {
    massKG: Number.isFinite(massKG) ? massKG : undefined,
    moiKGm2: Number.isFinite(moiKGm2) ? moiKGm2 : undefined,
    wheelCOF: Number.isFinite(wheelCOF) && wheelCOF > 0 ? wheelCOF : undefined,
    wheelRadiusM: Number.isFinite(wheelRadiusM) && wheelRadiusM > 0 ? wheelRadiusM : undefined,
    driveGearing: Number.isFinite(driveGearing) && driveGearing > 0 ? driveGearing : undefined,
    maxDriveVelocityMPS: plausibleWheelSpeedMPS(maxDriveVelocityMPS)
      ? maxDriveVelocityMPS
      : undefined,
    driveMotorType,
    driveCurrentLimitA:
      Number.isFinite(driveCurrentLimitA) && driveCurrentLimitA > 0
        ? driveCurrentLimitA
        : undefined,
  };
  return {
    dynamics: Object.values(dynamics).some((v) => v !== undefined) ? dynamics : undefined,
    rejected: Object.keys(rejected).length > 0 ? rejected : undefined,
  };
}

function ppDefaultConstraints(root: Record<string, unknown>): ProfileDefaultConstraints | undefined {
  // v2025.2.7 writes these top-level flat; the nested generationSettings
  // object is the older compatibility shape (same keys, same units).
  const source = asRecord(root.generationSettings) ?? root;
  const DEG_TO_RAD = Math.PI / 180;
  const maxVelMPS = num(source.defaultMaxVel, Number.NaN);
  const maxAccelMPSS = num(source.defaultMaxAccel, Number.NaN);
  // Angular values are degrees in the file (upstream PathConstraints carries
  // maxAngularVelocityDeg/maxAngularAccelerationDeg; the generator converts
  // via Units.degreesToRadians — trajectory.dart at v2025.2.7).
  const maxAngVelRadPS = num(source.defaultMaxAngVel, Number.NaN) * DEG_TO_RAD;
  const maxAngAccelRadPSSq = num(source.defaultMaxAngAccel, Number.NaN) * DEG_TO_RAD;
  const nominalVoltageV = num(source.defaultNominalVoltage, Number.NaN);
  const dc: ProfileDefaultConstraints = {
    maxVelMPS: Number.isFinite(maxVelMPS) && maxVelMPS > 0 ? maxVelMPS : undefined,
    maxAccelMPSS: Number.isFinite(maxAccelMPSS) && maxAccelMPSS > 0 ? maxAccelMPSS : undefined,
    maxAngVelRadPS: Number.isFinite(maxAngVelRadPS) && maxAngVelRadPS > 0 ? maxAngVelRadPS : undefined,
    maxAngAccelRadPSSq: Number.isFinite(maxAngAccelRadPSSq) && maxAngAccelRadPSSq > 0 ? maxAngAccelRadPSSq : undefined,
    nominalVoltageV: Number.isFinite(nominalVoltageV) && nominalVoltageV > 0 ? nominalVoltageV : undefined,
  };
  return Object.values(dc).some((v) => v !== undefined) ? dc : undefined;
}

/**
 * Parse a robot profile, or null when the JSON is not one. Throws the shared
 * invalid-json ParseError for non-JSON text (same error either parser would
 * give, so callers can fall through to trajectory parsing on null alone).
 */
export function parseRobotProfile(text: string, fileName: string): RobotProfile | null {
  const root = asRecord(parseJson(text, fileName));
  if (!root) return null;

  const nested = asRecord(root.robotConfig);
  const source = nested ?? root;
  const width = source.robotWidth;
  const length = source.robotLength;
  // Shape test: at least one finite dimension makes this a profile file.
  if ((typeof width === 'number' && Number.isFinite(width)) ||
      (typeof length === 'number' && Number.isFinite(length))) {
    const geometry: RobotGeometry = {
      ...DEFAULT_GEOMETRY,
      widthM: num(width, DEFAULT_GEOMETRY.widthM),
      lengthM: num(length, DEFAULT_GEOMETRY.lengthM),
    };
    // "File didn't say" must stay undefined, not false: the value feeds the
    // generator's holonomic/differential switch downstream, and a file that
    // simply omits the field must not silently become a diff-drive robot.
    const holonomicRaw = source.holonomicMode ?? root.isHolonomic;
    const holonomic = typeof holonomicRaw === 'boolean' ? holonomicRaw : undefined;
    const massRaw = source.robotMassKg ?? source.robotMass ?? root.robotMassKg;
    const massKG = typeof massRaw === 'number' && Number.isFinite(massRaw) ? massRaw : undefined;

    let moduleLocations = readModuleLocations(source);
    // Upstream ignores the corner fields entirely when the project is not
    // holonomic and builds the layout from robotTrackwidth instead
    // (RobotConfig.fromPrefs at v2025.2.7: (0, ±trackwidth/2)). Without a
    // usable trackwidth we keep whatever layout the file carried — upstream
    // would fall back to its own 0.546 m default, which we do not invent.
    if (holonomic === false) {
      const trackwidth = num(source.robotTrackwidth ?? root.robotTrackwidth, Number.NaN);
      if (Number.isFinite(trackwidth) && trackwidth > 0) {
        moduleLocations = [
          { x: 0, y: trackwidth / 2 },
          { x: 0, y: -trackwidth / 2 },
        ];
      }
    }

    const { dynamics, rejected } = ppDynamics(source);
    return {
      name: profileNameFromPath(fileName),
      geometry,
      moduleLocations,
      massKG,
      holonomic,
      dynamics,
      rejectedGenerationFields: rejected,
      defaultConstraints: ppDefaultConstraints(root),
    };
  }

  return choreoProjectProfile(root, fileName);
}

/**
 * A settings.json describes the project folder it lives in, so the folder
 * name is the friendliest identity ("254/settings.json" → "254"). At the
 * root of a drop there is no folder, and the file stem stands in. The
 * `.chor` case mirrors this — "choreo/choreo.chor" → "choreo" (the tool
 * folder name; the full relPath stays visible in the profile list title).
 */
function profileNameFromPath(path: string): string {
  const parts = path.split('/').filter(Boolean);
  if (parts.length >= 2) return parts[parts.length - 2] as string;
  const stem = (parts[0] ?? '').replace(/\.json$/i, '');
  return stem === '' ? path : stem;
}
