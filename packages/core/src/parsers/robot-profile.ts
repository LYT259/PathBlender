/**
 * Robot profile files: bumper geometry + module layout imported as data,
 * applied to a robot's collision footprint (user request 2026-09-20).
 *
 * Recognized today is the PathPlanner project settings.json in both its
 * shapes (format facts, MIT-licensed upstream):
 * - 2024+: { robotConfig: { robotWidth, robotLength, modules: [{x,y},…], … } }
 * - 2023-: top-level { robotWidth, robotLength, moduleLocations: [{x,y},…], … }
 * Anything else returns null so the caller can keep looking for a
 * trajectory — the shape decides, never the file name.
 */

import type { ModuleLocation, RobotGeometry } from '../types';
import { DEFAULT_GEOMETRY } from '../types';
import { asArray, asRecord, num, parseJson } from './json';

export interface RobotProfile {
  name: string;
  /** Bumper box for collision checking. */
  geometry: RobotGeometry;
  moduleLocations: ModuleLocation[];
  /** Extras carried for display; optional in every source format. */
  massKG?: number;
  holonomic?: boolean;
}

function readModuleLocations(source: Record<string, unknown>): ModuleLocation[] {
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
  if (!((typeof width === 'number' && Number.isFinite(width)) ||
        (typeof length === 'number' && Number.isFinite(length)))) {
    return null;
  }

  const geometry: RobotGeometry = {
    ...DEFAULT_GEOMETRY,
    widthM: num(width, DEFAULT_GEOMETRY.widthM),
    lengthM: num(length, DEFAULT_GEOMETRY.lengthM),
  };
  const holonomic = source.holonomicMode !== undefined
    ? source.holonomicMode === true
    : root.isHolonomic === true;
  const massRaw = source.robotMassKg ?? source.robotMass ?? root.robotMassKg;
  const massKG = typeof massRaw === 'number' && Number.isFinite(massRaw) ? massRaw : undefined;

  return {
    name: profileNameFromPath(fileName),
    geometry,
    moduleLocations: readModuleLocations(source),
    massKG,
    holonomic,
  };
}

/**
 * A settings.json describes the project folder it lives in, so the folder
 * name is the friendliest identity ("254/settings.json" → "254"). At the
 * root of a drop there is no folder, and the file stem stands in.
 */
function profileNameFromPath(path: string): string {
  const parts = path.split('/').filter(Boolean);
  if (parts.length >= 2) return parts[parts.length - 2] as string;
  const stem = (parts[0] ?? '').replace(/\.json$/i, '');
  return stem === '' ? path : stem;
}
