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
    expect(bumperWeave().image.data.length).toBe(32 * 32 * 4);
  });
});
