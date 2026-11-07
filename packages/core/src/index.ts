/**
 * @pathblender/core — pure-function core: parsers → unified trajectory
 * model → fusion & collision. Zero DOM; publishable as a standalone package.
 */

export type {
  Alliance,
  ModuleLocation,
  Pose2d,
  RobotGeometry,
  TimingSource,
  Trajectory,
  TrajectoryEvent,
  TrajectoryGap,
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
  mirrorAcrossLongAxis,
  routeStartRegion,
  startsInAllianceZone,
  withFieldVariant,
} from './field';
export type { FieldArtStyle, FieldImageCalibration, FieldPackage, StartRegionClass, StartRegionGeometry, StartZoneRect } from './field';
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
export {
  // WPILOG binary log import (2026-11): inspect → user selection → extract.
  isWpilogFileName,
  looksLikeWpilog,
  inspectWpilog,
  detectAutoIntervals,
  extractWpilogTrajectory,
  parseStructSchema,
  buildStructSet,
  decodeStructValue,
  parseFileDescriptor,
  decodeProtoPayload,
  decodePrimitive,
  recognizePose,
  buildSamples,
  LENGTH_TO_M,
  HEADING_TO_RAD,
} from './parsers';
export type {
  WpilogInspection,
  PoseCandidate,
  PoseCandidateKind,
  PoseSamplePreview,
  WpilogAutoInterval,
  WpilogExtractionSelection,
  WpilogPoseSelection,
  LengthUnit,
  HeadingUnit,
  ParsedSchema,
  StructLayout,
  StructValue,
  ProtoMessageDesc,
  ProtoValue,
} from './parsers';
// CTRE .hoot (2026-11, HOOT desktop import): header probe gates the
// owlet-converter flow before any EULA/download work happens.
export {
  HOOT_COMPLIANCY_OFFSET,
  HOOT_MIN_COMPLIANCY,
  isHootFileName,
  probeHootFile,
} from './parsers/hoot';
export type { HootProbeResult } from './parsers/hoot';
export type { RobotProfile, ProfileDynamics, ProfileDefaultConstraints } from './parsers/robot-profile';
export {
  applyProfileToRobot,
  applyProfileToTrajectory,
  dynamicsConfigComplete,
  resolveRobotConfig,
} from './profile-apply';
export type {
  DynamicsParamKey,
  DynamicsParamSource,
  DynamicsProvenance,
  ResolvedRobotConfig,
} from './profile-apply';
export type { AutoSegment, ParsedAuto } from './parsers/pathplanner-auto';
export { generateAutoTrajectory, parseAutoStructure } from './parsers/pathplanner-auto';

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
export { BOUNDS_TOLERANCE_M, detectFieldBounds } from './collision/field-bounds';
export type {
  FieldBoundsOptions,
  OutOfBoundsInterval,
} from './collision/field-bounds';

export {
  COLORBLIND_COLORS,
  remapColorblind,
  SESSION_COLORS,
  activeEndT,
  activeStartT,
  deserializeSession,
  makeSession,
  samplePoseAt,
  sampleStateAt,
  serializeSession,
  sessionDuration,
  hasEmptyArrangement,
} from './session';
export type { SessionFileV1, SessionTrajectory, SessionRouteOption, SessionProfileOption, SessionSerializeOptions } from './session';

export {
  LIBRARY_CHAIN_TOLERANCES,
  SEQUENCE_JOIN_TOLERANCES,
  checkSequenceJoins,
  checkSequenceTiming,
  resolveSequence,
  routeConnectsAfter,
  sampleSequenceState,
  segmentDurationS,
  sequenceEventTimes,
  sessionStartsInZone,
} from './auto-sequence';
export type {
  AutoSequence,
  AutoSequenceSegment,
  ResolvedSequenceSegment,
  RouteContinuity,
  SequenceJoinIssue,
  SequenceJoinOptions,
  SequenceTimingIssue,
} from './auto-sequence';

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
export { activeActionsAt, groupedActionsAt, normalizeActionWord } from './action-words';
export type { ActionWord, ActionKind, ActionGroup } from './action-words';
