/**
 * ViewCube region picking (user handoff 2026-10-14): clicking must land in
 * the region the cursor visually sits on. The classifier works in the same
 * texture-pixel space the faces are painted in, so these tests pin the
 * boundary math itself — panel inset, rounded corners, edge strips, corner
 * pads — plus the painting/picking round trip: any direction the picker can
 * return must light exactly the faces whose normal it contains.
 */

import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import {
  VIEWCUBE_APPEARANCE,
  viewcubeDirectionAt,
  viewcubeFaceRegion,
} from '../src/viewcube-appearance';

const S = VIEWCUBE_APPEARANCE.textureSize;
const HALF = S / 2 - VIEWCUBE_APPEARANCE.faceInset; // 208 px panel extent
const px = (face: number, xFromCenter: number, yFromCenter: number) =>
  viewcubeDirectionAt(face, (S / 2 + xFromCenter) / S, (S / 2 + yFromCenter) / S);

const norm = (d: readonly number[]) => d.join(',');

/** All 26 pickable directions: 6 faces, 12 edges, 8 corners. */
const ALL_26 = (() => {
  const dirs: string[] = [];
  for (const x of [-1, 0, 1]) for (const y of [-1, 0, 1]) for (const z of [-1, 0, 1]) {
    if (x || y || z) dirs.push([x, y, z].join(','));
  }
  return dirs;
})();

describe('viewcube region classifier', () => {
  it('returns only canonical ±1/0 directions across a dense grid', () => {
    const seen = new Set<string>();
    for (let face = 0; face < 6; face++) {
      for (let x = -S / 2; x <= S / 2; x += 8) {
        for (let y = -S / 2; y <= S / 2; y += 8) {
          const dir = px(face, x, y);
          expect(dir, `face ${face} at (${x},${y})`).not.toBeNull();
          const key = norm(dir!);
          expect(ALL_26).toContain(key);
          seen.add(key);
        }
      }
    }
    // Every one of the 26 is reachable from at least one face/point.
    expect([...seen].sort()).toEqual([...ALL_26].sort());
  });

  it('treats the panel interior as the face and stops at the inset', () => {
    expect(px(4, 0, 0)).toEqual([0, 0, 1]); // front face center
    // Just inside / outside the panel's straight edge (inset 48 px).
    expect(px(4, HALF - 1, 0)).toEqual([0, 0, 1]);
    expect(px(4, HALF + 1, 0)).toEqual([1, 0, 1]); // right–front edge
    expect(px(4, 0, -(HALF - 1))).toEqual([0, 0, 1]);
    expect(px(4, 0, -(HALF + 1))).toEqual([0, -1, 1]); // bottom–front
  });

  it('keeps the strip pick zone on the nearest feature past the corner arc', () => {
    // Past the right straight edge but still beside the panel's y span:
    // the nearest strip is the right edge, not the corner pad.
    expect(px(4, HALF + 7, -106)).toEqual([1, 0, 1]);
    // Fell off the rounded corner diagonally (beyond the 72 px arc, but
    // inside both straight-edge extents) → corner.
    expect(px(4, HALF - 8, HALF - 8)).toEqual([1, 1, 1]);
    // Deep in two rim bands → corner; texture corners too.
    expect(px(4, HALF + 40, HALF + 40)).toEqual([1, 1, 1]);
    expect(px(4, -S / 2, -S / 2)).toEqual([-1, -1, 1]);
    expect(px(4, S / 2 - 1, -S / 2 + 1)).toEqual([1, -1, 1]);
    // Mid-bevel points (outermost 24 px band) pick edges, not faces.
    expect(px(4, S / 2 - 1, 0)).toEqual([1, 0, 1]);
    expect(px(4, 0, S / 2 - 1)).toEqual([0, 1, 1]);
  });

  it('rejects invalid faces only', () => {
    expect(viewcubeDirectionAt(-1, 0.5, 0.5)).toBeNull();
    expect(viewcubeDirectionAt(6, 0.5, 0.5)).toBeNull();
  });
});

describe('picker → painter round trip', () => {
  it('lights exactly the faces each direction touches, with the right kind', () => {
    for (const key of ALL_26) {
      const dir = key.split(',').map(Number) as [number, number, number];
      const axisFaces = dir.filter((v) => v !== 0).length; // 1 face, 2 edge, 3 corner
      const lit = [0, 1, 2, 3, 4, 5].filter((f) => viewcubeFaceRegion(f, dir));
      expect(lit.length, key).toBe(axisFaces);
      for (const f of lit) {
        expect(viewcubeFaceRegion(f, dir)!.kind, key).toBe(
          axisFaces === 1 ? 'face' : axisFaces === 2 ? 'edge' : 'corner',
        );
      }
    }
  });

  it('classifies every sampled point into a region the picker can also paint', () => {
    // For each face and each sampled uv the returned direction must make
    // that face itself one of the lit ones (a pick on face F can never
    // return a direction that does not include F's normal).
    const faceNormals: [number, number, number][] = [
      [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
    ];
    for (let face = 0; face < 6; face++) {
      for (let x = -S / 2; x <= S / 2; x += 16) {
        for (let y = -S / 2; y <= S / 2; y += 16) {
          const dir = px(face, x, y)!;
          const n = faceNormals[face]!;
          const along = dir[0] * n[0] + dir[1] * n[1] + dir[2] * n[2];
          expect(along, `face ${face} at (${x},${y})`).toBe(1);
          expect(viewcubeFaceRegion(face, dir), `face ${face} at (${x},${y})`).not.toBeNull();
        }
      }
    }
  });
});

describe('classifier vs real raycast geometry', () => {
  // The pick pipeline raycasts the appearance mesh and classifies hit.uv.
  // This replays that raycast against the exact RoundedBoxGeometry with a
  // grid of orientations and asserts the uv-based answer matches the
  // physical hit point: inside the panel → the face; deep in a bevel band →
  // that edge/corner with the physical signs (2026-10-14 acceptance round;
  // guards FACE_FRAMES against silent axis/sign edits).
  const SIZE = 1.55;
  const geometry = new RoundedBoxGeometry(SIZE, SIZE, SIZE, 5, 0.09);
  const mesh = new THREE.Mesh(
    geometry,
    Array.from({ length: 6 }, () => new THREE.MeshBasicMaterial()),
  );
  const group = new THREE.Group();
  group.add(mesh);
  const cam = new THREE.PerspectiveCamera(38, 1, 0.1, 20);
  cam.position.set(0, 0, 3.6);
  cam.lookAt(0, 0, 0);
  const ray = new THREE.Raycaster();
  const ptr = new THREE.Vector2();

  it('deep-band hits pick the physically correct region', () => {
    const orientations: THREE.Quaternion[] = [];
    for (const [x, y, z] of [
      [0, 0, 1], [1, 0, 0], [0, 1, 0], [0, -1, 0], [1, 1, 1], [1, -1, 1],
      [1, 0, -1], [-1, 1, -1], [-1, -1, -1], [0.4, 0.7, 1], [-1, 0.3, 0.8],
    ]) {
      const dummy = new THREE.PerspectiveCamera();
      dummy.position.set(x, y, z).normalize().multiplyScalar(10);
      dummy.lookAt(0, 0, 0);
      orientations.push(dummy.quaternion.clone().invert());
    }
    const DEEP = 244; // ≥488 px of 512: geometrically on the bevel, past the rim
    const mism: string[] = [];
    let checked = 0;
    for (const q of orientations) {
      group.quaternion.copy(q);
      mesh.updateMatrixWorld(true);
      for (let i = 0; i <= 60; i++) {
        for (let j = 0; j <= 60; j++) {
          ptr.set((i / 60) * 2 - 1, -((j / 60) * 2 - 1));
          ray.setFromCamera(ptr, cam);
          const hit = ray.intersectObject(mesh, false)[0];
          if (!hit || hit.uv === undefined || hit.face?.materialIndex === undefined) continue;
          const p = mesh.worldToLocal(hit.point.clone());
          const dx = Math.abs(hit.uv.x * 512 - 256);
          const dy = Math.abs(hit.uv.y * 512 - 256);
          // The outer corner quadrant (both axes past ~490 px) rides the
          // tessellated corner sphere, where triangle UVs disagree with the
          // ideal mapping — sub-pixel at the real 110 px control; skip it.
          if (dx > 228 && dy > 228) continue;
          if (dx < 150 && dy < 150) {
            // Well inside the panel: must classify as the plain face.
            const want = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]][hit.face.materialIndex]!;
            expect(viewcubeDirectionAt(hit.face.materialIndex, hit.uv.x, hit.uv.y)).toEqual(want);
            checked++;
          } else if (dx >= DEEP || dy >= DEEP) {
            // Deep bevel band. The painted rim also runs over the flat face
            // for ~24 px, so a shallow axis may legitimately add a component
            // (pick-zone choice); only the PHYSICAL bevel components — the
            // non-zero truth axes — are binding, with matching signs.
            const truth: [number, number, number] = [0, 0, 0];
            for (let a = 0; a < 3; a++) {
              const v = a === 0 ? p.x : a === 1 ? p.y : p.z;
              if (Math.abs(v) > 0.68) truth[a] = Math.sign(v);
            }
            const got = viewcubeDirectionAt(hit.face.materialIndex, hit.uv.x, hit.uv.y);
            if (got) {
              for (let a = 0; a < 3; a++) {
                if (truth[a] !== 0 && got[a] !== truth[a]) {
                  mism.push(`face=${hit.face.materialIndex} uv=(${hit.uv.x.toFixed(3)},${hit.uv.y.toFixed(3)}) got=${got.join(',')} truth=${truth.join(',')}`);
                }
              }
            } else {
              mism.push(`face=${hit.face.materialIndex} uv=(${hit.uv.x.toFixed(3)},${hit.uv.y.toFixed(3)}) got=null truth=${truth.join(',')}`);
            }
            checked++;
          }
        }
      }
    }
    expect(mism, `${mism.length}/${checked} mismatches:\n${mism.slice(0, 10).join('\n')}`).toEqual([]);
    expect(checked).toBeGreaterThan(1000);
  });
});
