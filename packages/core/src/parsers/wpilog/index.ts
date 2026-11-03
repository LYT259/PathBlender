/**
 * WPILOG import (public surface). Binary entry — separate from
 * parsePathFile, which stays text-only for the JSON formats. The flow is
 * two-step by design: inspect (what does this log contain?) → extract
 * (the user's confirmed choice), because parsing the container must never
 * be mistaken for recovering a route.
 */

export { readWpilogHeader, catalogWpilog, scanWpilogRecords, WPILOG_MAGIC } from './container';
export type {
  WpilogHeader,
  WpilogDataRecord,
  WpilogEntry,
  WpilogCatalog,
  WpilogScanResult,
  WpilogStopReason,
  WpilogRecordHandler,
} from './container';

export {
  parseStructSchema,
  buildStructSet,
  buildStructLayout,
  decodeStructValue,
} from './struct';
export type { ParsedSchema, StructLayout, StructField, StructValue } from './struct';

export { parseFileDescriptor, decodeProtoPayload } from './protobuf';
export type { ProtoMessageDesc, ProtoValue } from './protobuf';

export {
  inspectWpilog,
  detectAutoIntervals,
  decodePrimitive,
  recognizePose,
} from './inspect';
export type {
  WpilogInspection,
  PoseCandidate,
  PoseCandidateKind,
  PoseSamplePreview,
  WpilogAutoInterval,
  RecognizedPose,
} from './inspect';

export {
  extractWpilogTrajectory,
  buildSamples,
  LENGTH_TO_M,
  HEADING_TO_RAD,
} from './extract';
export type {
  WpilogExtractionSelection,
  WpilogPoseSelection,
  LengthUnit,
  HeadingUnit,
  TrajectoryGap,
} from './extract';

/** File-name check used by the UI to route .wpilog files to the dialog. */
export function isWpilogFileName(name: string): boolean {
  return /\.wpilog$/i.test(name);
}

/** Content check: the 6-byte magic at the head of the bytes. */
export function looksLikeWpilog(bytes: Uint8Array): boolean {
  if (bytes.length < 6) return false;
  const magic = 'WPILOG';
  for (let i = 0; i < magic.length; i++) {
    if (bytes[i] !== magic.charCodeAt(i)) return false;
  }
  return true;
}
