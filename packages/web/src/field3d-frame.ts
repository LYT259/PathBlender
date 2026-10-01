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
import { fieldById, fieldImageWorldRect } from '@pathblender/core';

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
 * Official-field-model placement (the fifth round of this file's history —
 * see the header). The AdvantageScope assets are authored in a Y-up native
 * frame whose origin is the WPILib field centre; AdvantageScope mounts them
 * with the per-field `rotations` from the shipped `config.json` (verified in
 * AdvantageScope @ main, `field3d/workers/loadField.ts`: each entry
 * premultiplies, so [x 90°] → Rx(90°) and [x 90°, z 180°] →
 * Rz(180°)·Rx(90°)). Our render frame is the config frame with the Y/Z swap
 * `S(a,b,c) = (a,c,b)` (that swap is how the 2026 anchors relate the two —
 * see the test), so the full native→render map is `S·R_config`:
 *
 *   Rx(90°)          → (x, y, −z)   reflect Z   (2023, 2024, 2026)
 *   Rz(180°)·Rx(90°) → (−x, y, z)   reflect X   (2022, 2025)
 *
 * No rotation and no translation otherwise: the models are authored centred
 * on their season's official field centre (2025's 17.548 × 8.052 enclosure
 * frame — see `field.ts`), which `fieldRenderBounds` now reproduces. A
 * reflection is improper, so the loader keeps every material DoubleSide
 * (three.js flips shading normals for back faces under DoubleSide, which is
 * what makes a mirrored model light correctly).
 *
 * Numeric registration (the guarantee the tests re-run): every tag decal
 * mesh inside the four 2024–2026 models — `FE-00083_IDn` nodes, centres
 * taken from accessor min/max — lands within 11 mm horizontally and
 * 12/20 mm vertically of the WPILib layout mapped by `tagRenderPose`, with
 * id-for-id pairing; the old hard-coded `Ry(180°) + (0, 0.13, 1.16)` (fitted
 * to the retired Onshape model, engineering-log 2026.9.13) misses by up to
 * 16.8 m.
 */
export type FieldModelMirror = 'x' | 'z';

/** Derive the mirror axis from an AdvantageScope field config's rotations. */
export function configMirrorAxis(
  rotations: readonly { axis: string; degrees: number }[],
): FieldModelMirror {
  const turn = (deg: number) => ((deg % 360) + 360) % 360;
  return rotations.some((r) => r.axis === 'z' && Math.abs(turn(r.degrees) - 180) < 1e-6)
    ? 'x'
    : 'z';
}

/** Render-frame scale vector that mounts a native asset-model. */
export function fieldModelScale(mirror: FieldModelMirror): THREE.Vector3 {
  return mirror === 'x' ? new THREE.Vector3(-1, 1, 1) : new THREE.Vector3(1, 1, -1);
}

/**
 * Official 3D field models (AdvantageScopeAssets, BSD-3) per season and
 * construction variant; 2018–2020 have none and keep the hand-built
 * fallback. `mirror` is `configMirrorAxis` of the config.json shipped in
 * each model directory (asserted by test — it cannot drift from the
 * asset); `tagDecal` is the node-name pattern that identifies the model's
 * own tag meshes for the registration test (2022/2023 ship none).
 */
export interface Field3DModelEntry {
  welded: string;
  andymark?: string;
  mirror: FieldModelMirror;
  tagDecal?: RegExp;
}

export const FIELD3D_MODELS: Record<string, Field3DModelEntry> = {
  'rapidreact-2022': { welded: '2022-rapidreact', mirror: 'x' },
  'chargedup-2023': { welded: '2023-chargedup', mirror: 'z' },
  'crescendo-2024': {
    welded: '2024-crescendo',
    mirror: 'z',
    tagDecal: /FE-00083_ID(\d+)/,
  },

  'reefscape-2025': {
    welded: '2025-reefscape-welded',
    andymark: '2025-reefscape-andymark',
    mirror: 'x',
    tagDecal: /FE-00083_ID(\d+)/,
  },
  'rebuilt-2026': {
    welded: '2026-rebuilt',
    mirror: 'z',
    tagDecal: /FE-00083-ID(\d+)-Vinyl/,
  },
};

/**
 * Which tag list the 3D view mounts: the selected construction variant's
 * layout when the shipped assets include a model OF that build, otherwise
 * the layout of the model that will actually load.
 *
 * Why the fallback exists (2026 AndyMark, user report 2026-10-01): the
 * official AndyMark layout moves the hub/trench tags ~(−14, −13) mm and the
 * driver-station-wall tags ~−34 mm relative to welded, because the built
 * structures themselves sit at those offsets — but AdvantageScopeAssets
 * publishes exactly ONE 2026 model (welded; verified against its releases:
 * 2025 ships Welded+AndyMark zips, 2026 does not). Ray-casting every hub
 * tag's own normal on the welded model shows 9 of the 24 (ids 7, 9, 10,
 * 12, 17, 19, 20, 22, 24) land 6.8–7.2 mm BEHIND the hub's structural
 * panels (`GE-26305`/`GE-26308`/`GE-26327`) plus the blank tag vinyls —
 * fully hidden from the front, which reads as "this face has no AprilTag".
 * Mounting those coordinates is geometrically impossible on this model.
 *
 * So: 3D visualises the build it has a model of; the 2D overlay and every
 * data path keep the user's selected variant's official layout untouched.
 * Seasons without any official model (2018–2020, custom fields) always use
 * the package's own list — there is no model to contradict it.
 */
export function modelTagLayout(
  field: Pick<FieldPackage, 'id' | 'aprilTags'>,
  variant: 'welded' | 'andymark',
): AprilTag[] {
  const entry = FIELD3D_MODELS[field.id];
  if (entry && variant === 'andymark' && !entry.andymark) {
    // The default (welded) package of the same season is where this model's
    // own decals are (registration ≤ 2 mm; see the model test).
    return fieldById(field.id).aprilTags ?? field.aprilTags ?? [];
  }
  return field.aprilTags ?? [];
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
