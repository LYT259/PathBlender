import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { buildChassis3D, validateModuleTemplate } from '../src/chassis3d';
import { moduleBaseYaw } from '@pathblender/core';
import type { ModuleLocation, RobotVisualGeometry } from '@pathblender/core';

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

const VIS: RobotVisualGeometry = {
  outer: { lengthM: 0.6858, widthM: 0.6858, offsetX: 0, offsetY: 0 },
  chassis: { lengthM: 0.6858, widthM: 0.6858, offsetX: 0, offsetY: 0 },
  bumperDepthM: 0.0826,
};

/** The 2026 default layout: pods at ±10.375 in. */
const MODULES: ModuleLocation[] = [
  { x: 0.27625, y: 0.27625 },
  { x: 0.27625, y: -0.27625 },
  { x: -0.27625, y: 0.27625 },
  { x: -0.27625, y: -0.27625 },
];

/** Split-GLB stand-in: one box node + one turret node. */
function splitTemplate(): THREE.Group {
  const g = new THREE.Group();
  const box = new THREE.Mesh(new THREE.BoxGeometry(0.2165, 0.1, 0.1843));
  box.name = 'mk5i-box-a';
  box.position.y = 0.1;
  const turret = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.1, 0.12));
  turret.name = 'mk5i-turret-a';
  turret.position.y = 0.05;
  g.add(box, turret);
  return g;
}

describe('buildChassis3D', () => {
  it('splits mk5i-turret-* nodes into the steering pivot; the box stays frozen', () => {
    const c = buildChassis3D(VIS, MODULES, '#ff0000', splitTemplate());
    expect(c.turrets).toHaveLength(MODULES.length);
    for (let i = 0; i < MODULES.length; i++) {
      const pod = c.pods[i]!;
      const turret = c.turrets[i]!;
      expect(turret).not.toBe(pod);
      expect(turret.children.some((n) => n.name.startsWith('mk5i-turret-'))).toBe(true);
      // Both park at the installed yaw; steering later drives only the turret.
      expect(turret.rotation.y).toBeCloseTo(-moduleBaseYaw(MODULES[i]!), 10);
      const box = pod.children.find((n) => n !== turret)!;
      expect(box.rotation.y).toBeCloseTo(-moduleBaseYaw(MODULES[i]!), 10);
      expect(box.children.some((n) => n.name.startsWith('mk5i-box-'))).toBe(true);
      expect(box.children.some((n) => n.name.startsWith('mk5i-turret-'))).toBe(false);
    }
  });

  it('keeps module local y=0 (wheel bottoms) on the field floor', () => {
    const c = buildChassis3D(VIS, MODULES, '#ff0000', splitTemplate());
    c.group.updateMatrixWorld(true);
    for (const pod of c.pods) {
      expect(pod.getWorldPosition(new THREE.Vector3()).y).toBeCloseTo(0, 10);
    }
  });

  it('falls back to whole-pod steering when the template has no turret nodes', () => {
    const c = buildChassis3D(VIS, MODULES, '#ff0000', boxTemplate(0.2165, 0.1564, 0.1843));
    for (let i = 0; i < MODULES.length; i++) expect(c.turrets[i]).toBe(c.pods[i]);
  });

  it('procedural fallback steers the whole pod too', () => {
    const c = buildChassis3D(VIS, MODULES, '#ff0000');
    for (let i = 0; i < MODULES.length; i++) expect(c.turrets[i]).toBe(c.pods[i]);
  });
});
