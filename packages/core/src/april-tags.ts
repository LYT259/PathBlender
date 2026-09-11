/**
 * AprilTag field-layout parsing — accepts the official WPILib /
 * PhotonVision JSON (AprilTagFieldLayout), both the 2024+ format
 * ({ fields, tags: [{ ID, pose }] }) and the older lowercase variant.
 * Only the 2D projection is kept (x, y, heading) — enough for strategy
 * overlay rendering. Untrusted input: every field is optional-tolerated.
 */

export interface AprilTag {
  id: number;
  x: number;
  y: number;
  /** Tag facing direction in the field frame, radians (optional). */
  rotRad?: number;
  /** Mount height above the floor, meters (optional; 3D view only). */
  z?: number;
  /** Full 6-DOF orientation in the field frame as [x, y, z, w] (WPILib
   *  convention, rotation-only). Present for official layouts parsed from
   *  WPILib JSON and used by the 3D view to mount tags on surfaces. */
  quat?: [number, number, number, number];
}

export class AprilTagParseError extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = 'AprilTagParseError';
  }
}

interface Loose {
  [k: string]: unknown;
}

const rec = (v: unknown): Loose | undefined =>
  typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Loose) : undefined;
const num = (v: unknown, fallback = Number.NaN): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback;

/** Quaternion Z-rotation → heading (yaw), the only axis visible in 2D. */
function yawFromRotation(rot: Loose | undefined): number | undefined {
  if (!rot) return undefined;
  const q = rec(rot.quaternion);
  if (q) {
    // yaw = atan2(2(wz + xy), 1 - 2(y² + z²)); x,y≈0 for wall tags
    const w = num(q.W, 1);
    const z = num(q.Z, 0);
    const x = num(q.X, 0);
    const y = num(q.Y, 0);
    return Math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z));
  }
  if (typeof rot.angle === 'number') return rot.angle; // radians assumed
  return undefined;
}

/** Keep the full orientation when the source provides a sane quaternion. */
function quatFromRotation(rot: Loose | undefined): [number, number, number, number] | undefined {
  const q = rot ? rec(rot.quaternion) : undefined;
  if (!q) return undefined;
  const x = num(q.X, Number.NaN);
  const y = num(q.Y, Number.NaN);
  const z = num(q.Z, Number.NaN);
  const w = num(q.W, Number.NaN);
  if (![x, y, z, w].every(Number.isFinite)) return undefined;
  const norm = Math.hypot(x, y, z, w);
  return norm > 1e-9 ? [x / norm, y / norm, z / norm, w / norm] : undefined;
}

export function parseAprilTagLayout(text: string): {
  tags: AprilTag[];
  fieldLengthM?: number;
  fieldWidthM?: number;
} {
  let root: Loose | undefined;
  try {
    root = rec(JSON.parse(text));
  } catch (e) {
    throw new AprilTagParseError(
      e instanceof Error ? `not valid JSON: ${e.message}` : 'not valid JSON',
    );
  }
  if (!root) throw new AprilTagParseError('not a JSON object');

  const rawTags = Array.isArray(root.tags) ? root.tags : [];
  const tags: AprilTag[] = [];
  for (const raw of rawTags) {
    const t = rec(raw);
    if (!t) continue;
    const id = num(t.ID ?? t.id, Number.NaN);
    const pose = rec(t.pose);
    const tr = pose ? rec(pose.translation) : undefined;
    const x = tr ? num(tr.x, Number.NaN) : Number.NaN;
    const y = tr ? num(tr.y, Number.NaN) : Number.NaN;
    if (![id, x, y].every(Number.isFinite)) continue; // skip malformed entries
    const rot = pose ? rec(pose.rotation) : undefined;
    const rotRad = yawFromRotation(rot);
    const quat = quatFromRotation(rot);
    const z = tr ? num(tr.z, Number.NaN) : Number.NaN;
    const entry: AprilTag = { id, x, y };
    if (rotRad !== undefined) entry.rotRad = rotRad;
    if (Number.isFinite(z)) entry.z = z;
    if (quat) entry.quat = quat;
    tags.push(entry);
  }
  if (tags.length === 0) {
    throw new AprilTagParseError('no usable tags — expected WPILib/PhotonVision layout JSON');
  }

  const fields = rec(root.fields);
  const length = fields ? num(fields['field-length'], undefined as unknown as number) : undefined;
  const width = fields ? num(fields['field-width'], undefined as unknown as number) : undefined;

  return {
    tags,
    fieldLengthM: Number.isFinite(length) ? length : undefined,
    fieldWidthM: Number.isFinite(width) ? width : undefined,
  };
}
