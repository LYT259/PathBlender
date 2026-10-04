/**
 * Shipped mk5i-module.glb geometry contract — the numbers behind the
 * runtime `validateModuleTemplate` sanity check plus the wheel-bias
 * invariant baked in 2026-10-04 (scripts/cad/mk5i-box-offset.py):
 *
 * On the real MK5i the wheel is biased to the corner of the drivebase
 * — the steering axis sits 2.58–2.62 in / 2.55 in from two edges of
 * the 7.45 in square module envelope (official SDS MK5i layout
 * drawing, measured at 140.3 px/in). Trajectory `moduleLocations` are
 * steering-axis positions, so the shipped GLB must keep the turret
 * (fork + wheel) centered on the origin while the box body (top
 * plate, Krakens, L plate) reaches mostly toward local −Z (radially
 * inward in the parked windmill pose, +X = rolling). The pre-2026-10-04
 * GLB centered the box on the axis and rendered every module hanging
 * ~4 cm past the frame rails into the bumper zone.
 *
 * Accessor AABBs are read straight from the JSON chunk and composed
 * through node transforms — same technique as field3d-model.test.ts.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

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

  it('centers the turret on the steering axis (moduleLocations are axis positions)', () => {
    expect(turret.min.y).toBeCloseTo(0, 3); // wheel on the floor
    expect(Math.abs(turret.min.x + turret.max.x)).toBeLessThanOrEqual(0.005);
    expect(Math.abs(turret.min.z + turret.max.z)).toBeLessThanOrEqual(0.005);
    expect(turret.max.x).toBeLessThanOrEqual(0.06);
    expect(turret.max.z).toBeLessThanOrEqual(0.06);
  });

  it('biases the box toward local −Z — the wheel sits at the drivebase corner', () => {
    // Measured 2026-10-04 after mk5i-box-offset.py: z −0.1336..+0.0507,
    // vs the SDS drawing's 4.90 in / 2.55 in envelope margins.
    expect(box.min.z).toBeLessThanOrEqual(-0.12);
    expect(box.max.z).toBeGreaterThanOrEqual(0.03);
    expect(box.max.z).toBeLessThanOrEqual(0.075);
    expect(-box.min.z).toBeGreaterThanOrEqual(2 * box.max.z);
    // Rolling axis stays symmetric about the steering axis.
    expect(Math.abs(box.min.x + box.max.x)).toBeLessThanOrEqual(0.005);
  });
});
