/**
 * The 3D view's ONE coordinate frame.
 *
 * Everything the 3D scene places — AprilTag faces, the field model, robot
 * boxes, trajectory tubes, the fallback structures — goes through the
 * functions here, so a transform can no longer drift between one layer and
 * the next. That drift is the recurring bug in this file's history (four
 * rounds of 3D corrections, engineering-log 2026.9.7 → 9.13): tags were
 * fitted to the official assets while the robots kept an earlier, X-mirrored
 * mapping, so the two layers disagreed about which end of the field is blue.
 *
 * Frame choice (report §6.7 — official data only, never eyeballed):
 * the render frame is the AdvantageScopeAssets "wall-blue" frame, so the tag
 * anchors published with the field models land where we put the tags. That
 * frame maps a WPILib field point (x, y) to
 *
 *     X = -(x - cx)      Z = -(y - cy)      Y = up (height)
 *
 * verified per tag against `packages/web/public/fields3d/2026-rebuilt/
 * config.json`: all 32 anchors match to 1.3 mm with matching ids (the other
 * three sign combinations miss by up to 16.5 m, so this is not a symmetric
 * coincidence). Consequences worth knowing:
 *   - the blue alliance sits at +X, and the mapping is a reflection (det -1),
 *     which is why tag orientations need the explicit conjugation below
 *     rather than a plain rotation;
 *   - a robot's heading therefore transforms as `pi - heading`, not the
 *     identity — the box has to turn the mirrored way or it drives sideways.
 */

import * as THREE from 'three';
import type { AprilTag, FieldPackage } from '@pathblender/core';
import { fieldImageWorldRect } from '@pathblender/core';

/** Field centre in meters — the render frame is centered on the playfield. */
export function fieldCenter(field: FieldPackage): { cx: number; cy: number } {
  const { cx, cy } = fieldRenderBounds(field);
  return { cx, cy };
}

/**
 * Center point plus full image size, from whichever calibration the package
 * carries. Everything the 3D scene sizes itself against comes through here.
 */
export function fieldRenderBounds(field: FieldPackage): {
  cx: number;
  cy: number;
  /** Image extent along X / Z of the render frame, meters. */
  width: number;
  depth: number;
} {
  const rect = field.image
    ? fieldImageWorldRect(field.image, field.lengthM, field.widthM)
    : { left: -0.5, right: field.lengthM + 0.5, bottom: -0.5, top: field.widthM + 0.5 };
  return {
    cx: (rect.left + rect.right) / 2,
    cy: (rect.bottom + rect.top) / 2,
    width: rect.right - rect.left,
    depth: rect.top - rect.bottom,
  };
}

/** WPILib field point → render-frame horizontal pair (X, Z). */
export function worldToRender(x: number, y: number, cx: number, cy: number): [number, number] {
  return [-(x - cx), -(y - cy)];
}

/** Three.js position for a field point at the given height. */
export function worldToRenderVec3(
  x: number,
  y: number,
  height: number,
  cx: number,
  cy: number,
): THREE.Vector3 {
  const [X, Z] = worldToRender(x, y, cx, cy);
  return new THREE.Vector3(X, height, Z);
}

/** Robot heading (WPILib radians) → `mesh.rotation.y` in the render frame. */
export function headingToRender(headingRad: number): number {
  return Math.PI - headingRad;
}

/**
 * In-plane turn of the printed pattern about the plate's own normal.
 *
 * Zero is the only value that keeps a wall tag upright. Measured against the
 * facing above, the plate's up axis lands exactly on the render vertical and
 * its right axis exactly on the horizontal for all 32 tags of 2026; a
 * quarter-turn here sends that right axis vertical instead. The previous round
 * set π/2 here to cure "crooked tags" — but a turn about the normal cannot
 * change what a plate faces, and the plates were crooked because their facing
 * sat 90° away from their own walls (see `tagFacing`). With the facing
 * corrected, this term goes back to 0 and the rows stay horizontal.
 *
 * Against the rotations published in `fields3d/2026-rebuilt/config.json` the
 * rendered plates now agree for every tag up to one global 90° constant — the
 * asset's own canonical-image convention, which no layout file states. Only
 * its ±180° ambiguity remains open, and a real 36h11 decoder settles it (the
 * decode must return the plate's own id); both readings still draw rows
 * horizontally, which is what the uprightness guard in the test protects.
 */
export const TAG_PATTERN_YAW_RAD = 0;

/** WPILib tag pose (x, y, z, quat|rotRad) → render-frame position + quaternion. */
export function tagRenderPose(
  tag: Pick<AprilTag, 'x' | 'y'> & Partial<AprilTag>,
  cx: number,
  cy: number,
): { position: THREE.Vector3; quaternion: THREE.Quaternion } {
  const [X, Z] = worldToRender(tag.x, tag.y, cx, cy);
  const position = new THREE.Vector3(X, tag.z ?? 0.55, Z);
  // Post-multiplying keeps the pattern turn inside the plate's own plane, so
  // it cannot disturb the position or the facing asserted below.
  const quaternion = tagFacing(tag).multiply(
    new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), TAG_PATTERN_YAW_RAD),
  );
  return { position, quaternion };
}

/**
 * The plate's facing, without the pattern term: the part the official data
 * pins, and what the tests compare against the layouts and the asset config.
 *
 * The AprilTag/WPILib tag frame puts +X out of the tag face (the normal) and
 * +Z along the image's up direction. The layouts say so, they do not merely
 * allow it: every FRC wall tag stores a yaw-only rotation about the field Z,
 * so a +Z normal would stand every wall tag on its edge facing the ceiling
 * and a +X normal is the reading that keeps faces vertical and turned to
 * their wall. The tilted cases confirm it — 2025 Reefscape's four reef-top
 * tags (4, 5, 14, 15) carry a 30° rotation about the tag's own Y, which is
 * exactly those faces' known 30° lean from vertical, whereas it would mean a
 * meaningless in-plane spin of an upright plate under a +Y-normal reading.
 * `PlaneGeometry` is the other shape (its +Z is the normal, its +Y is up), so
 * the plate is posed from the two official directions it has to honour:
 *
 *   normal ← L(R_wp · x̂)   up ← L(R_wp · ẑ)   right ← up × normal
 *
 * Going through an explicit orthonormal basis (rather than the product of
 * rotation matrices the previous version used) matters here: the render frame
 * is reached through a reflection, and an improper matrix cannot be turned
 * into a quaternion at all — `setFromRotationMatrix` silently returns junk on
 * one. The old chain hid that by conjugating twice; the cost was that every
 * plate sat 90° about the vertical away from its own wall.
 */
export function tagFacing(tag: Pick<AprilTag, 'x' | 'y'> & Partial<AprilTag>): THREE.Quaternion {
  const R = new THREE.Matrix4().makeRotationFromQuaternion(
    tag.quat
      ? new THREE.Quaternion(tag.quat[0], tag.quat[1], tag.quat[2], tag.quat[3]).normalize()
      : new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), tag.rotRad ?? 0),
  );
  // L: wp direction (a, b, c) -> render (X, Y, Z) = (-a, c, -b). Three stores
  // matrices column-major, so column k is R.elements[4k .. 4k+3].
  const renderDir = (k: number) =>
    new THREE.Vector3(-R.elements[k]!, R.elements[k + 2]!, -R.elements[k + 1]!);
  const normal = renderDir(0).normalize(); // R · x̂  — out of the tag face
  const up = renderDir(8).normalize(); //    R · ẑ  — up the tag image
  // x̂ ⊥ ẑ in the tag frame and L preserves angles, so `up × normal` is already
  // unit length; normalize() only absorbs float drift.
  const right = new THREE.Vector3().crossVectors(up, normal).normalize();
  const basis = new THREE.Matrix4().makeBasis(right, up, normal);
  return new THREE.Quaternion().setFromRotationMatrix(basis);
}
