/**
 * @pathblender/core — pure-function core: parsers → unified trajectory
 * model → fusion & collision. Zero DOM; publishable as a standalone package.
 */

export type {
  Alliance,
  ModuleLocation,
  Pose2d,
  RobotGeometry,
  Trajectory,
  TrajectoryEvent,
  TrajectorySample,
  TrajectorySource,
} from './types';
export { DEFAULT_GEOMETRY, teamNumberFromName, trajectoryDuration } from './types';

export {
  CUSTOM_FIELD_ID,
  FIELDS,
  REBUILT_2026,
  applyAllianceChange,
  fieldById,
  flipPoseToBlue,
  makeCustomField,
  withFieldVariant,
} from './field';
export type { FieldArtStyle, FieldImageCalibration, FieldPackage } from './field';
export { fieldImageWorldRect } from './field';

export { lerpAngle, sampleTrajectory, wrapAngle } from './math';
export {
  addChoreoWaypoint,
  addPpWaypoint,
  moveChoreoWaypoint,
  movePpWaypoint,
  reparameterize,
  removeChoreoWaypoint,
  removePpWaypoint,
  resetToOriginal,
} from './editing';
export type { EditablePath } from './editing';
export { adjustedName, exportGhostAuto, exportPathPlannerPath, exportTraj } from './exporters';

export {
  detectFormat,
  parsePathFile,
  parseRobotProfile,
  parseTraj,
  parseGhostAuto,
  parsePathPlannerPath,
  parsePathPlannerAuto,
  ParseError,
} from './parsers';
export type { DetectedFormat, ParseErrorKind } from './parsers';
export type { RobotProfile } from './parsers/robot-profile';
export type { AutoSegment } from './parsers/pathplanner-auto';

// PathPlanner trajectory generation (Phase 2 port, MIT-licensed upstream).
export { DCMotor } from './pathplanner/dc-motor';
export { makeRobotConfig, defaultConfigGeometry } from './pathplanner/robot-config';
export type { ModuleConfig, RobotConfig } from './pathplanner/robot-config';
export { generatePathPoints, samplePath } from './pathplanner/path-points';
export type { PathPoint } from './pathplanner/path-points';
export { generateTrajectory } from './pathplanner/generation';
export type { GeneratedTrajectory } from './pathplanner/generation';
export { parsePathJson } from './pathplanner/path-model';
export type {
  ConstraintZone,
  ParsedPath,
  PathConstraints,
  Waypoint,
} from './pathplanner/path-model';

export { parseAprilTagLayout, AprilTagParseError } from './april-tags';
export type { AprilTag } from './april-tags';
export { obbOverlap, poseToObb, centerDistance } from './collision/obb';
export type { Obb } from './collision/obb';
export { detectCollisions, minimumSeparation } from './collision/detect';
export { autoResolveConflicts } from './resolve';
export type { CollisionInterval, DetectOptions } from './collision/detect';
export { detectFieldBounds } from './collision/field-bounds';
export type {
  FieldBoundsOptions,
  OutOfBoundsInterval,
} from './collision/field-bounds';

export {
  SESSION_COLORS,
  activeEndT,
  activeStartT,
  deserializeSession,
  makeSession,
  samplePoseAt,
  sampleStateAt,
  serializeSession,
  sessionDuration,
} from './session';
export type { SessionFileV1, SessionTrajectory, SessionRouteOption, SessionProfileOption } from './session';

export {
  STEERING_STATIC_MPS,
  chassisModules,
  moduleBaseYaw,
  moduleSteeringAngles,
  robotVisualGeometry,
  seasonRobotProfile,
  withSeasonGeometry,
} from './robot-geometry';
export type { MotionState, RobotVisualGeometry, SeasonRobotProfile } from './robot-geometry';
