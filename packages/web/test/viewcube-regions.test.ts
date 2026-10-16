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
  FACE_FRAMES,
  VIEWCUBE_APPEARANCE,
  VIEWCUBE_LABEL_KEYS,
  viewcubeDirectionAt,
  viewcubeFaceRegion,
  viewcubeFlyAzimuth,
  viewcubeGlyphUp,
} from '../src/viewcube-appearance';
import { CAM_HOME } from '../src/field3d-models';

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

describe('labels and glyphs pair with the 3D home view', () => {
  // 2026-10-16 regressions, both sides of the same coin: (a) the label
  // arrays drifted between the scaffold bake and the locale repaint after
  // the home-camera flip, so the resting cube read "Back" facing the user;
  // (b) the ±Y faces' glyphs stayed painted for the pre-flip reading
  // direction and landed upside down. These tests derive the home view's
  // screen axes from CAM_HOME alone — the same numbers FieldCanvas3D's
  // camera poses with — so any future home change that breaks the pairing
  // or the upright reading fails here, per face.
  const len = Math.hypot(CAM_HOME[0], CAM_HOME[1], CAM_HOME[2]);
  const cam = [CAM_HOME[0] / len, CAM_HOME[1] / len, CAM_HOME[2] / len];
  const dot3 = (a: readonly number[], b: readonly number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross3 = (a: readonly number[], b: readonly number[]) => [
    a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0],
  ];
  const norm3 = (v: readonly number[]) => {
    const l = Math.hypot(v[0], v[1], v[2]) || 1;
    return [v[0] / l, v[1] / l, v[2] / l];
  };
  const screenAxes = (camDir: readonly number[]) => {
    const D = [-camDir[0], -camDir[1], -camDir[2]]; // lookAt origin
    const up = [0, 1, 0];
    const right = norm3(cross3(D, up)); // unnormalized it is |sinφ| long and
    // every >0.99 pairing below silently never fires — normalize before compare.
    const screenUp = norm3([
      up[0] - dot3(up, D) * D[0], up[1] - dot3(up, D) * D[1], up[2] - dot3(up, D) * D[2],
    ]);
    return { D, right, screenUp };
  };
  const home = screenAxes(cam);

  it('the face the home view looks from is Front; screen-right is Right; screen-left is Left', () => {
    const horiz = norm3([cam[0], 0, cam[2]]); // camera azimuth: the side of the field
    for (let f = 0; f < 6; f++) {
      const n = FACE_FRAMES[f]!.n;
      if (dot3(n, horiz) > 0.99) expect(VIEWCUBE_LABEL_KEYS[f], `face ${f} faces the camera`).toBe('vc.front');
      if (dot3(n, horiz) < -0.99) expect(VIEWCUBE_LABEL_KEYS[f], `face ${f} faces away`).toBe('vc.back');
      if (dot3(n, home.right) > 0.99) expect(VIEWCUBE_LABEL_KEYS[f], `face ${f} sits screen-right`).toBe('vc.right');
      if (dot3(n, home.right) < -0.99) expect(VIEWCUBE_LABEL_KEYS[f], `face ${f} sits screen-left`).toBe('vc.left');
    }
  });

  it('every glyph visible in the home view reads upright', () => {
    for (let f = 0; f < 6; f++) {
      const n = FACE_FRAMES[f]!.n;
      if (dot3(n, home.D) < -0.01) {
        // Face turned toward the camera (visible at home): its glyph's up
        // must lean with the screen's up, not against it.
        expect(dot3(viewcubeGlyphUp(f), home.screenUp), `face ${f} visible at home`).toBeGreaterThan(0);
      }
    }
    // The bottom face mirrors this at the below-field mirror of home
    // (where it is the visible one) — CAM_HOME with the elevation negated.
    const below = screenAxes([cam[0], -cam[1], cam[2]]);
    expect(dot3(viewcubeGlyphUp(3), below.screenUp), 'bottom face at the mirrored view').toBeGreaterThan(0);
    // Side faces stay world-up regardless of azimuth (camera up is +Y, no roll).
    for (const f of [0, 1, 4, 5]) {
      expect(viewcubeGlyphUp(f)[1], `side face ${f}`).toBeGreaterThan(0.99);
    }
  });
});

const r_s = (th: number, sinPhi: number) => Math.sin(th) * sinPhi;
const r_c = (th: number, sinPhi: number) => Math.cos(th) * sinPhi;
describe('fly-to azimuth keeps the promise "blue on the left"', () => {
  // 2026-10-16 user report (screen recording): clicking the cube's Top
  // landed a plan view reading red-left/blue-right. Root cause: pole
  // directions have no horizontal component, so the spherical theta
  // collapsed to atan2(0,0)=0 — an arbitrary side of the field. The
  // azimuth those landings must carry is the home one, the only side
  // whose plan view keeps blue left (matching every other view, the 2D
  // sheet and field3d-home-orientation.test.ts) — a camera that never
  // rolls cannot give blue-left AND north-up in a plan view; the promise
  // picks blue-left, so the plan view is north-down. Single code path:
  // no season or construction variant reaches here, one fix covers all.
  const POLE_PHI = 0.02; // flyTo's off-the-pole clamp, mirrored here

  it('pole directions land on the home azimuth, not atan2(0,0)=0', () => {
    expect(viewcubeFlyAzimuth([0, 1, 0])).toBeCloseTo(Math.PI, 12);
    expect(viewcubeFlyAzimuth([0, -1, 0])).toBeCloseTo(Math.PI, 12);
  });

  it('the plan view the pole azimuth gives keeps blue left and the Top glyph upright', () => {
    const th = viewcubeFlyAzimuth([0, 1, 0]);
    // Camera at (theta, phi=POLE_PHI, r) looking at the target: the
    // landing pose flyTo tweens to.
    const sph = { s: Math.sin(POLE_PHI), c: Math.cos(POLE_PHI) };
    const pos = [r_s(th, sph.s), sph.c, r_c(th, sph.s)];
    const D = pos.map((v) => -v); // lookAt origin
    const up = [0, 1, 0];
    const dot3 = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    const cross3 = (a: number[], b: number[]) => [
      a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0],
    ];
    const right = cross3(D, up);
    const screenUp = [
      up[0] - dot3(up, D) * D[0], up[1] - dot3(up, D) * D[1], up[2] - dot3(up, D) * D[2],
    ];
    // Screen right must point AWAY from the render frame's blue end (+X):
    expect(right[0], 'blue (+X) must sit screen-left').toBeLessThan(0);
    // And the Top glyph's painted up (viewcubeGlyphUp(2)) leans with the
    // screen's up — the widget's marker reads upright in the plan view.
    expect(dot3([...viewcubeGlyphUp(2)], screenUp), 'Top glyph upright').toBeGreaterThan(0);
  });

  it('non-pole directions keep their own azimuth', () => {
    expect(viewcubeFlyAzimuth([1, 0, 0])).toBeCloseTo(Math.PI / 2, 12);
    expect(viewcubeFlyAzimuth([0, 0, 1])).toBeCloseTo(0, 12);
    expect(viewcubeFlyAzimuth([-1, 0, -1])).toBeCloseTo(-3 * Math.PI / 4, 12);
  });
});

