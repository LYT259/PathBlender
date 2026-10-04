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

  it('builds one continuous closed bumper ring around the footprint (2026-10-04)', () => {
    const square = {
      outer: { lengthM: 0.889, widthM: 0.889, offsetX: 0, offsetY: 0 },
      chassis: { lengthM: 0.8, widthM: 0.8, offsetX: 0, offsetY: 0 },
      bumperDepthM: 0.1016,
    };
    const { group } = buildChassis3D(square, [], bumperColor('red'));
    const rings: THREE.Mesh[] = [];
    group.traverse((o) => { if (o.name === 'bumper-rail') rings.push(o as THREE.Mesh); });
    // The user's core ask: a single seamless band, not four rails.
    expect(rings).toHaveLength(1);
    // Signed-tetrahedron volume of the ring, in world space.
    const mesh = rings[0]!;
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
    // Square ring prism: (outer square − inner square) × height.
    const bounds = new THREE.Box3().setFromObject(mesh);
    const h = bounds.max.y - bounds.min.y;
    const L = 0.889; const d = 0.1016;
    const expected = (L * L - (L - 2 * d) * (L - 2 * d)) * h;
    expect(Math.abs(vol)).toBeCloseTo(expected, 6);
    // The ring spans the full outer square on both axes.
    expect(bounds.min.x).toBeCloseTo(-L / 2, 6);
    expect(bounds.max.x).toBeCloseTo(L / 2, 6);
    expect(bounds.min.z).toBeCloseTo(-L / 2, 6);
    expect(bounds.max.z).toBeCloseTo(L / 2, 6);
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
