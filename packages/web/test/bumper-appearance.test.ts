import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { buildChassis3D } from '../src/chassis3d';
import { bumperColor } from '../src/robot-identity';
import { bumperMaterial, bumperWeave } from '../src/bumper-material';

const vis = {
  outer: { lengthM: 0.9, widthM: 0.8, offsetX: 0.03, offsetY: -0.02 },
  chassis: { lengthM: 0.75, widthM: 0.65, offsetX: 0.03, offsetY: -0.02 },
  bumperDepthM: 0.075,
};

describe('bumper presentation', () => {
  it('keeps the exact footprint when softening fabric edges', () => {
    const { group } = buildChassis3D(vis, [], bumperColor('red'));
    const bounds = new THREE.Box3().setFromObject(group);
    expect(bounds.min.x).toBeCloseTo(0.03 - 0.9 / 2, 6);
    expect(bounds.max.x).toBeCloseTo(0.03 + 0.9 / 2, 6);
    expect(bounds.min.z).toBeCloseTo(-0.02 - 0.8 / 2, 6);
    expect(bounds.max.z).toBeCloseTo(-0.02 + 0.8 / 2, 6);
  });

  it('builds four congruent mitered trapezoid rails on a square chassis (2026-10-04)', () => {
    const square = {
      outer: { lengthM: 0.889, widthM: 0.889, offsetX: 0, offsetY: 0 },
      chassis: { lengthM: 0.8, widthM: 0.8, offsetX: 0, offsetY: 0 },
      bumperDepthM: 0.1016,
    };
    const { group } = buildChassis3D(square, [], bumperColor('red'));
    const rails: THREE.Mesh[] = [];
    group.traverse((o) => { if (o.name === 'bumper-rail') rails.push(o as THREE.Mesh); });
    expect(rails).toHaveLength(4);
    // Signed-tetrahedron volume of each rail, in world space.
    const volume = (mesh: THREE.Mesh): number => {
      mesh.updateWorldMatrix(true, false);
      const pos = mesh.geometry.getAttribute('position');
      const idx = mesh.geometry.getIndex();
      const a = new THREE.Vector3(); const b = new THREE.Vector3(); const c = new THREE.Vector3();
      const cross = new THREE.Vector3();
      let vol = 0;
      const tris = (idx ? idx.count : pos.count) / 3;
      for (let t = 0; t < tris; t++) {
        const [ia, ib, ic] = idx ? [idx.getX(t * 3), idx.getX(t * 3 + 1), idx.getX(t * 3 + 2)] : [t * 3, t * 3 + 1, t * 3 + 2];
        a.fromBufferAttribute(pos, ia).applyMatrix4(mesh.matrixWorld);
        b.fromBufferAttribute(pos, ib).applyMatrix4(mesh.matrixWorld);
        c.fromBufferAttribute(pos, ic).applyMatrix4(mesh.matrixWorld);
        vol += a.dot(cross.crossVectors(b, c)) / 6;
      }
      return Math.abs(vol);
    };
    const volumes = rails.map(volume);
    // The user's core ask: every rail carries the SAME area/volume.
    for (const v of volumes) expect(v).toBeCloseTo(volumes[0]!, 8);
    // And each is the isosceles-trapezoid prism: (L + (L−2d))/2 × d × H.
    const bounds = new THREE.Box3().setFromObject(rails[0]!);
    const h = bounds.max.y - bounds.min.y;
    const L = 0.889; const d = 0.1016;
    const expected = ((L + (L - 2 * d)) / 2) * d * h;
    expect(volumes[0]!).toBeCloseTo(expected, 6);
  });

  it('centers all four number decals and places both negative faces outside the rail', () => {
    const { group } = buildChassis3D(vis, [], bumperColor('blue'), null, '2910');
    const decals: THREE.Object3D[] = [];
    group.traverse((object) => { if (object.name === 'bumper-team-number') decals.push(object); });
    expect(decals).toHaveLength(4);
    expect(decals.map((decal) => decal.position.toArray())).toEqual([
      [0, 0.115, 0.401], [0, 0.115, -0.401], [0.451, 0.115, 0], [-0.451, 0.115, 0],
    ]);
    for (const decal of decals) {
      const size = new THREE.Vector3();
      const geometry = (decal as THREE.Mesh).geometry;
      geometry.computeBoundingBox();
      geometry.boundingBox!.getSize(size);
      expect(size.x / size.y).toBeCloseTo(4, 6);
    }
  });

  it('reuses a single weave tile for both alliances', () => {
    const red = bumperMaterial(new THREE.Color(bumperColor('red')));
    const blue = bumperMaterial(new THREE.Color(bumperColor('blue')));
    expect(red.map).toBe(blue.map);
    expect(red.bumpMap).toBe(bumperWeave());
    expect(red.color.getHexString()).toBe('c8323e');
    expect(blue.color.getHexString()).toBe('2264cf');
    expect(bumperWeave().image.data.length).toBe(128 * 128 * 4);
  });
});
