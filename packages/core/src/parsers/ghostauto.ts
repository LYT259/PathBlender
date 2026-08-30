/**
 * Team 103 Collaborative fork `.ghostauto` parser.
 *
 * Format facts confirmed from the fork's lib/auto/ghost_auto.dart (MIT):
 * { version:"1.0", name, teamName, bumperSize{width,height}, bumperOffset{x,y},
 *   holonomic, moduleLocations[{x,y}], states[{t,x,y,rotation,vx,vy,omega,
 *   moduleStates[]}] }. All fields have defaults in the fork's fromJson —
 * we are at least as forgiving. Bumper geometry ships with the file.
 */

import type {
  ModuleLocation,
  RobotGeometry,
  Trajectory,
  TrajectorySample,
} from '../types';
import { DEFAULT_GEOMETRY, teamNumberFromName, trajectoryDuration } from '../types';
import { asArray, asRecord, num, parseJson, str } from './json';
import { ParseError } from './parse-error';

export function parseGhostAuto(text: string, fileName: string): Trajectory {
  const root = asRecord(parseJson(text, fileName));
  if (!root) throw new ParseError('unrecognized-format', fileName, 'not a JSON object');

  const rawStates = asArray(root.states);
  if (!rawStates) {
    throw new ParseError('unrecognized-format', fileName, 'missing states array');
  }
  if (rawStates.length === 0) {
    throw new ParseError('empty-trajectory', fileName);
  }

  const samples: TrajectorySample[] = [];
  for (const raw of rawStates) {
    const rec = asRecord(raw);
    if (!rec) continue;
    const s: TrajectorySample = {
      t: num(rec.t, Number.NaN),
      x: num(rec.x, Number.NaN),
      y: num(rec.y, Number.NaN),
      heading: num(rec.rotation, 0),
      vx: num(rec.vx, 0),
      vy: num(rec.vy, 0),
      omega: num(rec.omega, 0),
    };
    if (![s.t, s.x, s.y].every(Number.isFinite)) continue;
    samples.push(s);
  }
  if (samples.length === 0) {
    throw new ParseError('empty-trajectory', fileName, 'no usable states');
  }

  // bumperSize: width = robot x (length), height = robot y (width), meters.
  const bs = asRecord(root.bumperSize);
  const widthM = bs ? num(bs.width, Number.NaN) : Number.NaN;
  const heightM = bs ? num(bs.height, Number.NaN) : Number.NaN;
  const plausible =
    Number.isFinite(widthM) &&
    Number.isFinite(heightM) &&
    widthM > 0.3 && widthM < 1.8 &&
    heightM > 0.3 && heightM < 1.8;
  const geometry: RobotGeometry = plausible
    ? {
        lengthM: widthM,
        widthM: heightM,
        offsetX: 0,
        offsetY: 0,
      }
    : DEFAULT_GEOMETRY;
  const bo = asRecord(root.bumperOffset);
  if (bo && (num(bo.x, 0) !== 0 || num(bo.y, 0) !== 0)) {
    geometry.offsetX = num(bo.x, 0);
    geometry.offsetY = num(bo.y, 0);
  }

  const moduleLocations: ModuleLocation[] = [];
  for (const raw of asArray(root.moduleLocations) ?? []) {
    const rec = asRecord(raw);
    if (!rec) continue;
    moduleLocations.push({ x: num(rec.x, 0), y: num(rec.y, 0) });
  }

  const warnings: string[] = [];
  if (!plausible) warnings.push('no usable bumperSize; using default geometry');

  return {
    id: crypto.randomUUID(),
    name: str(root.name, fileName.replace(/\.ghostauto$/i, '')),
    teamName: str(root.teamName, ''),
    teamNumber:
      teamNumberFromName(str(root.teamName, '')) || teamNumberFromName(fileName),
    source: 'ghostauto',
    alliance: 'blue',
    samples,
    durationS: trajectoryDuration(samples),
    geometry,
    geometrySource: plausible ? 'file' : 'default',
    moduleLocations,
    events: [],
    warnings,
  };
}
