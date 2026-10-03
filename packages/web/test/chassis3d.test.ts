import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { validateModuleTemplate } from '../src/chassis3d';

/** Minimal stand-in for the GLB template: a box of the given full
 *  extents (x = rolling, y = up, z = axle), floor at y=0. */
function boxTemplate(x: number, y: number, z: number): THREE.Group {
  const g = new THREE.Group();
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(x, y, z));
  mesh.position.y = y / 2;
  g.add(mesh);
  g.updateMatrixWorld(true);
  return g;
}

describe('validateModuleTemplate', () => {
  it('accepts the contract-shaped template (rolling = long plan axis +X)', () => {
    // Measured on the shipped mk5i-module.glb, 2026-10-03.
    expect(validateModuleTemplate(boxTemplate(0.2165, 0.1564, 0.1843))).not.toBeNull();
  });

  it('rejects an axle-on-+X rebuild (the ROLL_SWAP regression): plan axes swapped', () => {
    expect(validateModuleTemplate(boxTemplate(0.1843, 0.1564, 0.2165))).toBeNull();
  });

  it('rejects a unit-error template (inches export)', () => {
    expect(validateModuleTemplate(boxTemplate(8.52, 6.16, 7.26))).toBeNull();
  });

  it('rejects an empty template', () => {
    const g = new THREE.Group();
    g.updateMatrixWorld(true);
    expect(validateModuleTemplate(g)).toBeNull();
  });
});
