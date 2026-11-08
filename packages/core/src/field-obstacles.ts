/**
 * Field-obstacle footprints (red book §6.2 long-term item: robot OBB vs
 * field elements). Obstacle hulls are convex blue-world-frame polygons
 * programmatically extracted from the bundled official-CAD GLBs (see
 * scripts/field-obstacles/extract-footprints.mjs) — never hand-typed
 * (red book §6.7 geometry discipline).
 */

import type { FieldPackage } from './field';
import { FIELD_OBSTACLE_DATA } from './field-obstacles-data';

export interface HullPoint {
  x: number;
  y: number;
}

export interface FieldObstacle {
  /** Stable id, e.g. 'hub-blue'. Alliance-paired elements get a -blue/-red suffix. */
  id: string;
  /** English source name from the official CAD part tree (proper noun, shown as-is — same precedent as FieldPackage.name in the field picker). */
  name: string;
  /** Convex hull, counterclockwise, no repeated closing point, blue world frame meters. */
  hull: readonly HullPoint[];
  /** Height band of the in-band source vertices, meters. */
  zMinM: number;
  zMaxM: number;
}

export interface FieldObstacleVariantSet {
  welded: readonly FieldObstacle[];
  andymark?: readonly FieldObstacle[];
}

/**
 * Obstacle set for a bundled season field. Custom fields carry no obstacles
 * (no geometry source exists); seasons without an AndyMark extraction fall
 * back to the welded set (the AndyMark deltas measured in field3d-frame.ts
 * are far below the 3 in collision tolerance).
 */
export function obstaclesForField(
  field: Pick<FieldPackage, 'id'>,
  variant: 'welded' | 'andymark',
): readonly FieldObstacle[] {
  const set = FIELD_OBSTACLE_DATA[field.id];
  if (!set) return [];
  if (variant === 'andymark') return set.andymark ?? set.welded;
  return set.welded;
}
