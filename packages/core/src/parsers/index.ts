/**
 * Unified parse entry point: detect the format from JSON structure
 * (never from the file extension — users rename files), then dispatch.
 */

import type { Trajectory } from '../types';
import { asArray, asRecord, parseJson } from './json';
import { ParseError } from './parse-error';
import { parseGhostAuto } from './ghostauto';
import { parseTraj } from './traj';
import { parsePathPlannerPath } from './pathplanner-path';
import { parsePathPlannerAuto } from './pathplanner-auto';

export { ParseError } from './parse-error';
export type { ParseErrorKind } from './parse-error';
export { parseTraj } from './traj';
export { parseGhostAuto } from './ghostauto';
export { parsePathPlannerPath } from './pathplanner-path';
export { parsePathPlannerAuto } from './pathplanner-auto';
export { parseRobotProfile } from './robot-profile';
export type { RobotProfile } from './robot-profile';

export type DetectedFormat =
  | 'choreo-traj'
  | 'ghostauto'
  | 'pathplanner-path'
  | 'pathplanner-auto'
  | 'unknown';

export function detectFormat(text: string, fileName: string): DetectedFormat {
  const root = asRecord(parseJson(text, fileName));
  if (!root) return 'unknown';

  const traj = asRecord(root.trajectory);
  if (traj && asArray(traj.samples)) return 'choreo-traj';
  // Ungenerated Choreo export: has the project skeleton but no trajectory.
  if (root.version !== undefined && root.snapshot !== undefined) return 'choreo-traj';

  if (asArray(root.states) !== undefined) {
    if (asRecord(root.bumperSize) || root.teamName !== undefined) return 'ghostauto';
    return 'ghostauto'; // states[] with defaults everywhere is still a ghost
  }

  const waypoints = asArray(root.waypoints);
  if (waypoints && root.globalConstraints !== undefined) return 'pathplanner-path';
  if (root.command !== undefined && root.resetOdom !== undefined) {
    return 'pathplanner-auto';
  }

  return 'unknown';
}

export function parsePathFile(
  text: string,
  fileName: string,
  resolvePath?: (pathName: string) => string | undefined,
): Trajectory {
  const format = detectFormat(text, fileName);
  switch (format) {
    case 'choreo-traj':
      return parseTraj(text, fileName);
    case 'ghostauto':
      return parseGhostAuto(text, fileName);
    case 'pathplanner-path':
      return parsePathPlannerPath(text, fileName);
    case 'pathplanner-auto':
      return parsePathPlannerAuto(text, fileName, resolvePath ?? (() => undefined));
    default:
      throw new ParseError(
        'unrecognized-format',
        fileName,
        'supported: Choreo .traj, .ghostauto, PathPlanner .path',
      );
  }
}
