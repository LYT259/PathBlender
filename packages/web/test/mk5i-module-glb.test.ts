/**
 * Shipped mk5i-module.glb geometry contract — the numbers behind the
 * runtime `validateModuleTemplate` sanity check plus the module-plate
 * bolt-coverage invariant:
 *
 * Trajectory `moduleLocations` are steering-axis positions, so the
 * shipped GLB keeps the turret (fork + wheel) centered on the origin
 * while the box body (top plate, Krakens, L plate) spans nearly
 * symmetric local ±Z (+X = rolling). A 2026-10-04 experiment shifted
 * the box 41 mm toward local −Z (radially inward in the parked
 * windmill pose, scripts/cad/mk5i-box-offset.py) to match the
 * official SDS MK5i layout drawing (steering axis 2.58–2.62 in /
 * 2.55 in from two edges of the 7.45 in square envelope, measured at
 * 140.3 px/in) — REVERTED the same day: the governing ground truth is
 * the chassis CAD, not the envelope drawing. In mk5i-frame.glb the 20
 * long module mounting bolts sit in (±0.3302, ±0.3302) corner L
 * patterns; relative to the steering axis (±0.27625 m, diagonal
 * parked yaw) the corner bolt needs plate outboard reach
 * lz = +0.0763 m, and the shifted plate only reached +0.0507 — the
 * bolt floated 25.6 mm off the plate at every corner. The restored
 * (pre-shift) plate covers all 20 bolts with ≥15 mm margin. Full
 * story in scripts/cad/README.md.
 *
 * Accessor AABBs are read straight from the JSON chunk and composed
 * through node transforms — same technique as field3d-model.test.ts.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { MK5I_TURRET_PREFIX } from '../src/chassis3d';

const GLB = resolve(__dirname, '../public/models/mk5i-module.glb');

interface Gltf {
  nodes: {
    name?: string;
    mesh?: number;
    children?: number[];
    matrix?: number[];
    translation?: [number, number, number];
    rotation?: [number, number, number, number];
    scale?: [number, number, number];
  }[];
  meshes: { name?: string; primitives: { attributes: { POSITION: number } }[] }[];
  accessors: { min?: number[]; max?: number[] }[];
}

function gltfJson(path: string): Gltf {
  const buf = readFileSync(path);
  expect(buf.readUInt32LE(0)).toBe(0x46546c67); // 'glTF'
  const len = buf.readUInt32LE(8);
  let off = 12;
  while (off < len) {
    const clen = buf.readUInt32LE(off);
    const ctype = buf.readUInt32LE(off + 4);
    if (ctype === 0x4e4f534a) return JSON.parse(buf.toString('utf8', off + 8, off + 8 + clen));
    off += 8 + clen;
  }
  throw new Error(`no JSON chunk in ${path}`);
}

function localMatrix(n: Gltf['nodes'][number]): THREE.Matrix4 {
  if (n.matrix) return new THREE.Matrix4().fromArray(n.matrix);
  return new THREE.Matrix4().compose(
    new THREE.Vector3(...(n.translation ?? [0, 0, 0])),
    new THREE.Quaternion(...(n.rotation ?? [0, 0, 0, 1])),
    new THREE.Vector3(...(n.scale ?? [1, 1, 1])),
  );
}

/** Union of world-space POSITION AABBs per mesh-name bucket. */
function meshBuckets(js: Gltf): Map<string, THREE.Box3> {
  const out = new Map<string, THREE.Box3>();
  const isChild = new Set<number>();
  for (const n of js.nodes) for (const c of n.children ?? []) isChild.add(c);
  const walk = (i: number, parent: THREE.Matrix4) => {
    const n = js.nodes[i]!;
    const world = parent.clone().multiply(localMatrix(n));
    if (n.mesh !== undefined) {
      const mesh = js.meshes[n.mesh]!;
      const key = (mesh.name ?? '').startsWith('mk5i-box')
        ? 'box'
        : (mesh.name ?? '').startsWith('mk5i-turret')
          ? 'turret'
          : 'other';
      const bucket = out.get(key) ?? new THREE.Box3();
      for (const prim of mesh.primitives) {
        const acc = js.accessors[prim.attributes.POSITION]!;
        for (const cx of [acc.min![0]!, acc.max![0]!])
          for (const cy of [acc.min![1]!, acc.max![1]!])
            for (const cz of [acc.min![2]!, acc.max![2]!])
              bucket.expandByPoint(new THREE.Vector3(cx, cy, cz).applyMatrix4(world));
      }
      out.set(key, bucket);
    }
    for (const c of n.children ?? []) walk(c, world);
  };
  js.nodes.forEach((n, i) => {
    if (!isChild.has(i)) walk(i, new THREE.Matrix4());
  });
  return out;
}

describe('shipped mk5i-module.glb', () => {
  const buckets = meshBuckets(gltfJson(GLB));
  const box = buckets.get('box')!;
  const turret = buckets.get('turret')!;
  const whole = box.clone().union(turret);

  it('keeps the runtime template contract: height and rolling = long plan axis +X', () => {
    const h = whole.max.y - whole.min.y;
    expect(h).toBeGreaterThanOrEqual(0.1);
    expect(h).toBeLessThanOrEqual(0.35);
    expect(whole.max.x - whole.min.x).toBeGreaterThan(whole.max.z - whole.min.z);
  });

  it('carries a node matching the runtime turret prefix — no silent whole-pod fallback', () => {
    // 2026-10-04 regression: the code matched 'mk5i-turret-' while the asset
    // ships 'mk5i-turret', so buildChassis3D silently fell back to the
    // unsplit path and every module rendered at yaw 0. Pin name↔code drift.
    const js = gltfJson(GLB);
    expect(js.nodes.some((n) => (n.name ?? '').startsWith(MK5I_TURRET_PREFIX))).toBe(true);
  });

  it('centers the turret on the steering axis (moduleLocations are axis positions)', () => {
    expect(turret.min.y).toBeCloseTo(0, 3); // wheel on the floor
    expect(Math.abs(turret.min.x + turret.max.x)).toBeLessThanOrEqual(0.005);
    expect(Math.abs(turret.min.z + turret.max.z)).toBeLessThanOrEqual(0.005);
    expect(turret.max.x).toBeLessThanOrEqual(0.06);
    expect(turret.max.z).toBeLessThanOrEqual(0.06);
  });

  it('centers the box on the steering axis — the plate covers every chassis mounting bolt', () => {
    // Governing ground truth (2026-10-04 mk5i-frame.glb measurement):
    // the 20 long module bolts sit in (±0.3302, ±0.3302) corner L
    // patterns; relative to the steering axis (±0.27625 m, diagonal
    // parked yaw) the corner bolt needs plate outboard reach
    // lz = +0.0763 m. The reverted 41 mm inboard shift reached only
    // +0.0507 and floated the bolt 25.6 mm off the plate at all four
    // corners; the restored plate covers all 20 bolts ≥15 mm margin.
    expect(box.max.z).toBeGreaterThanOrEqual(0.0763);
    // Restored geometry measured 2026-10-04 (GLB byte-identical to
    // a0f2639): box z −0.0926..+0.0917 — symmetric within ~1 mm.
    expect(box.min.z).toBeLessThanOrEqual(-0.09);
    expect(box.max.z).toBeGreaterThanOrEqual(0.09);
    expect(Math.abs(box.min.z + box.max.z)).toBeLessThanOrEqual(0.005);
    // Rolling axis stays symmetric about the steering axis.
    expect(Math.abs(box.min.x + box.max.x)).toBeLessThanOrEqual(0.005);
  });
});
