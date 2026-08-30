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
    const rotRad = yawFromRotation(pose ? rec(pose.rotation) : undefined);
    tags.push(rotRad === undefined ? { id, x, y } : { id, x, y, rotRad });
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
