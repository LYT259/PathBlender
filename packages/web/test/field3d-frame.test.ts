/**
 * The 3D frame is checked against official data, tag by tag (report §6.7):
 * positions against the anchors published with the AdvantageScope field
 * model, facings against the WPILib layouts themselves. This exists because
 * four rounds of 3D corrections were fought by looking at screenshots, and
 * the last one still left the plates turned 90° about the vertical from their
 * own walls and the robots mirrored end-for-end against the field.
 */

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { FIELDS, REBUILT_2026, type AprilTag } from '@pathblender/core';
// The official model's own tag table, imported straight from the shipped
// asset so this check can never drift from what the app renders.
import asset2026 from '../public/fields3d/2026-rebuilt/config.json';
import {
  TAG_PATTERN_YAW_RAD,
  fieldRenderBounds,
  headingToRender,
  tagFacing,
  tagRenderPose,
  worldToRender,
} from '../src/field3d-frame';

const ASSET_2026 = asset2026 as unknown as {
  aprilTags: { id: number; position: [number, number, number]; rotations: { axis: string; degrees: number }[] }[];
  driverStations: [number, number][];
};

/** The render frame's linear map: wp direction (a, b, c) -> (-a, c, -b). */
const toRender = (v: [number, number, number]) =>
  new THREE.Vector3(-v[0], v[2], -v[1]);

const tagQuaternionMatrix = (tag: AprilTag) =>
  new THREE.Matrix4().makeRotationFromQuaternion(
    tag.quat
      ? new THREE.Quaternion(...tag.quat).normalize()
      : new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), tag.rotRad ?? 0),
  );

/** All layouts the app ships, welded and AndyMark alike. */
const ALL_TAGS: AprilTag[] = FIELDS.flatMap((f) => [
  ...(f.aprilTags ?? []),
  ...(f.aprilTagsAndyMark ?? []),
]);

describe('3D render frame matches the official asset anchors', () => {
  const { cx, cy } = fieldRenderBounds(REBUILT_2026);

  it('covers every 2026 tag the asset publishes', () => {
    expect(ASSET_2026.aprilTags).toHaveLength(32);
    expect(REBUILT_2026.aprilTags).toHaveLength(32);
  });

  it.each(ASSET_2026.aprilTags.map((t) => [t.id, t] as const))(
    'places tag %i within 2 mm of its asset anchor',
    (_id, asset) => {
      const wp = REBUILT_2026.aprilTags!.find((t) => t.id === asset.id)!;
      const { position } = tagRenderPose(wp, cx, cy);
      // Asset tuples are Z-up: [x, y(depth), z(height)] -> render (X, height, Y).
      // The published anchors are themselves rounded to the millimetre, so the
      // tolerance is set just above that rounding rather than below it.
      const err = Math.max(
        Math.abs(position.x - asset.position[0]),
        Math.abs(position.y - asset.position[2]),
        Math.abs(position.z - asset.position[1]),
      );
      expect(err).toBeLessThan(0.002);
    },
  );

  it('rejects the mirrored and unmirrored alternatives, so the fit is not a coincidence', () => {
    // A 180°-symmetric field makes a wrong frame look plausible; the tag *ids*
    // do not. End-for-end partners sit ~16.5 m away, so any wrong sign shows
    // up as a meter-scale miss rather than a rounding difference.
    const dx = REBUILT_2026.aprilTags!.find((t) => t.id === 1)!.x - cx;
    const asset1 = ASSET_2026.aprilTags.find((t) => t.id === 1)!;
    expect(-dx).toBeCloseTo(asset1.position[0], 2); // the frame we use
    // The unmirrored alternative misses by metres, not rounding.
    expect(Math.abs(dx - asset1.position[0])).toBeGreaterThan(1);
  });

  it('puts the blue alliance at +X, where the asset puts its driver stations', () => {
    const [blueX] = worldToRender(0, 0, cx, cy);
    expect(blueX).toBeGreaterThan(0);
    // The asset's own station row that carries blue's y order sits at +X too.
    const blueRow = ASSET_2026.driverStations.filter(([x]) => x > 0);
    expect(blueRow).toHaveLength(3);
    const yInRender = blueRow.map(([, y]) => y).sort((a, b) => a - b);
    const blueStationYs = [-3.07975, -1.25095, 1.8288].sort((a, b) => a - b);
    yInRender.forEach((y, i) => expect(y).toBeCloseTo(blueStationYs[i]!, 4));
  });
});

describe('3D tag plates face their official normals', () => {
  const centres = new Map(FIELDS.map((f) => [f.id, fieldRenderBounds(f)]));
  const tagsWithLayout = FIELDS.flatMap((f) =>
    (f.aprilTags ?? []).map((t) => ({ tag: t, field: f })),
  );

  it.each(tagsWithLayout.map(({ tag, field }, i) => [i, tag.id, field.id] as const))(
    'tag #%i on %s: normal and up axis agree with the layout',
    (index) => {
      const { tag, field } = tagsWithLayout[index]!;
      const { cx, cy } = centres.get(field.id)!;
      const facing = tagFacing(tag);
      const R = tagQuaternionMatrix(tag);
      // Tag frame: +X is out of the face, +Z is image up. PlaneGeometry:
      // +Z is the normal, +Y is up.
      const wantNormal = toRender([R.elements[0], R.elements[1], R.elements[2]]);
      const wantUp = toRender([R.elements[8], R.elements[9], R.elements[10]]);
      const gotNormal = new THREE.Vector3(0, 0, 1).applyQuaternion(facing);
      const gotUp = new THREE.Vector3(0, 1, 0).applyQuaternion(facing);
      expect(gotNormal.distanceTo(wantNormal)).toBeLessThan(1e-6);
      expect(gotUp.distanceTo(wantUp)).toBeLessThan(1e-6);
      expect(gotNormal.length()).toBeCloseTo(1, 6);
    },
  );

  it('stands every yaw-only wall tag upright with a horizontal normal', () => {
    for (const { tag } of tagsWithLayout.filter(({ tag }) => !tag.quat)) {
      const gotNormal = new THREE.Vector3(0, 0, 1).applyQuaternion(tagFacing(tag));
      const gotUp = new THREE.Vector3(0, 1, 0).applyQuaternion(tagFacing(tag));
      expect(Math.abs(gotNormal.y)).toBeLessThan(1e-9); // never floor- or ceiling-facing
      expect(gotUp.y).toBeGreaterThan(0.999);
    }
  });

  it('faces outer-wall tags back over the field, not into the wall', () => {
    const { cx, cy } = centres.get(REBUILT_2026.id)!;
    // Tags 13-16 on the +x wall, 29-32 on the -x wall: both must look inward.
    for (const id of [13, 14, 15, 16, 29, 30, 31, 32]) {
      const tag = REBUILT_2026.aprilTags!.find((t) => t.id === id)!;
      const { position } = tagRenderPose(tag, cx, cy);
      const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(tagFacing(tag));
      const towardCentre = new THREE.Vector3(-position.x, 0, -position.z);
      expect(normal.dot(towardCentre)).toBeGreaterThan(0.9);
    }
  });
});

describe('3D plates stay upright, and the pattern turn stays the only free term', () => {
  const { cx, cy } = fieldRenderBounds(REBUILT_2026);

  it('draws every plate with horizontal rows and a vertical up axis', () => {
    // The guard against the previous round's cure: a quarter-turn in the
    // plate's own plane sends the tag's rows vertical, which reads as a
    // crooked tag and decodes as a different rotation.
    for (const asset of ASSET_2026.aprilTags) {
      const wp = REBUILT_2026.aprilTags!.find((t) => t.id === asset.id)!;
      const q = tagRenderPose(wp, cx, cy).quaternion;
      expect(new THREE.Vector3(1, 0, 0).applyQuaternion(q).y).toBeCloseTo(0, 9);
      expect(new THREE.Vector3(0, 1, 0).applyQuaternion(q).y).toBeCloseTo(1, 9);
    }
  });

  it('agrees with the asset rotation field up to one global 90° constant', () => {
    const offsets = new Set<number>();
    for (const asset of ASSET_2026.aprilTags) {
      const wp = REBUILT_2026.aprilTags!.find((t) => t.id === asset.id)!;
      const full = tagRenderPose(wp, cx, cy).quaternion;
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(full);
      const ours = (Math.atan2(right.z, right.x) * 180) / Math.PI;
      const theirs = asset.rotations.find((r) => r.axis === 'z')!.degrees;
      offsets.add(Math.round((((theirs - ours) % 360) + 360) % 360));
    }
    // One value for all 32 tags: no per-tag error hiding behind the texture.
    expect(offsets.size).toBe(1);
    const [residual] = [...offsets];
    expect(residual! % 90).toBe(0);
  });

  it('keeps the turn inside the plate plane (it cannot move a plate or its face)', () => {
    const tag = REBUILT_2026.aprilTags![0]!;
    const withTurn = tagRenderPose(tag, cx, cy);
    const facing = tagFacing(tag);
    expect(
      new THREE.Vector3(0, 0, 1)
        .applyQuaternion(withTurn.quaternion)
        .distanceTo(new THREE.Vector3(0, 0, 1).applyQuaternion(facing)),
    ).toBeLessThan(1e-9);
    expect(TAG_PATTERN_YAW_RAD).toBe(0);
  });
});

describe('the whole scene shares one mapping', () => {
  it('mirrors X and Z about the field centre', () => {
    expect(worldToRender(1, 1, 0, 0)).toEqual([-1, -1]);
    expect(worldToRender(0, 0, 2, 3)).toEqual([2, 3]);
  });

  it('turns a robot heading with the reflection', () => {
    // A robot driving toward +x must point toward render -X, i.e. pi - heading.
    expect(headingToRender(0)).toBeCloseTo(Math.PI, 12);
    expect(headingToRender(Math.PI / 2)).toBeCloseTo(Math.PI / 2, 12);
    const heading = 0.7;
    // Where the nose points after `mesh.rotation.y = headingToRender(h)`:
    // three maps a local +X to (cos φ, 0, -sin φ).
    const phi = headingToRender(heading);
    const nose = new THREE.Vector3(Math.cos(phi), 0, -Math.sin(phi));
    // …and where the world direction of travel lands under the same mapping.
    const [dx, dy] = worldToRender(Math.cos(heading), Math.sin(heading), 0, 0);
    expect(nose.distanceTo(new THREE.Vector3(dx, 0, dy))).toBeLessThan(1e-9);
  });
});
