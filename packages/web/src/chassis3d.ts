/**
 * Procedural MK5i-style chassis for the 3D view (plan A, user decision
 * 2026-10-02: no external CAD assets; if this is ever swapped for a
 * glTF model it must be built from the official SDS model — a
 * hand-modeled approximation looks wrong at close range, per the user).
 *
 * Layered like the real thing and sized by each robot's resolved
 * geometry: a bumper skirt ring, a frame deck, and one swerve pod per
 * module (roller wheel + gearbox block). Total height ≈ 0.16 m — a
 * real chassis cross-section, replacing the old abstract 0.45 m box.
 *
 * Frame conventions (derived from field3d-frame.ts): the group sits at
 * the robot's pose on the floor; robot-frame x is local +X (forward),
 * robot-frame y is local +Z (left); a robot-frame yaw angle maps to
 * local rotation.y with the opposite sign (the render frame reflects).
 */

import * as THREE from 'three';
import type { ModuleLocation, RobotVisualGeometry } from '@pathblender/core';

/** 4 in wheel (typical MK5i fit). */
const WHEEL_RADIUS_M = 0.0508;
const WHEEL_WIDTH_M = 0.04;
/** Bumper skirt cross-section: 5 in tall, at real bumper height. */
const BUMPER_H_M = 0.127;
const BUMPER_Y_M = 0.115;

export interface Chassis3D {
  group: THREE.Group;
  /** Steering pivots, one per module — drive code sets rotation.y. */
  pods: THREE.Group[];
}

export function buildChassis3D(
  vis: RobotVisualGeometry,
  modules: readonly ModuleLocation[],
  color: string,
): Chassis3D {
  const group = new THREE.Group();

  // Everything with a fixed offset from the pose lives in `body`, so a
  // non-zero geometry offset shifts the whole chassis, not just one layer.
  const body = new THREE.Group();
  body.position.set(vis.outer.offsetX, 0, vis.outer.offsetY);
  group.add(body);

  const tint = new THREE.Color(color);
  const bumperMat = new THREE.MeshStandardMaterial({ color: tint, roughness: 0.85 });
  const frameMat = new THREE.MeshStandardMaterial({ color: tint, roughness: 0.45, metalness: 0.25 });
  const wheelMat = new THREE.MeshStandardMaterial({ color: 0x1c1c1e, roughness: 0.8 });
  const podMat = new THREE.MeshStandardMaterial({ color: 0x3a3a3c, roughness: 0.55, metalness: 0.35 });

  const add = (
    parent: THREE.Object3D,
    w: number,
    h: number,
    d: number,
    x: number,
    y: number,
    z: number,
    mat: THREE.Material,
  ) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    parent.add(mesh);
    return mesh;
  };

  // Bumper skirt: four boxes forming the ring at the outer footprint.
  const L = vis.outer.lengthM;
  const W = vis.outer.widthM;
  const d = vis.bumperDepthM;
  add(body, L, BUMPER_H_M, d, 0, BUMPER_Y_M, (W - d) / 2, bumperMat);
  add(body, L, BUMPER_H_M, d, 0, BUMPER_Y_M, -(W - d) / 2, bumperMat);
  add(body, d, BUMPER_H_M, W - 2 * d, (L - d) / 2, BUMPER_Y_M, 0, bumperMat);
  add(body, d, BUMPER_H_M, W - 2 * d, -(L - d) / 2, BUMPER_Y_M, 0, bumperMat);

  // Frame deck between the rails, at chassis size (belt line of a tub).
  const cdx = vis.chassis.offsetX - vis.outer.offsetX;
  const cdz = vis.chassis.offsetY - vis.outer.offsetY;
  add(body, vis.chassis.lengthM, 0.03, vis.chassis.widthM, cdx, 0.095, cdz, frameMat);

  // Swerve pods at module positions (robot frame, relative to the pose).
  const pods: THREE.Group[] = [];
  for (const m of modules) {
    const pod = new THREE.Group();
    pod.position.set(m.x, 0, m.y);

    const wheel = new THREE.Mesh(
      new THREE.CylinderGeometry(WHEEL_RADIUS_M, WHEEL_RADIUS_M, WHEEL_WIDTH_M, 18),
      wheelMat,
    );
    // Cylinder axis is Y; tilt it so the axle lies along local Z — the
    // wheel then rolls along the pod's forward (X) direction.
    wheel.rotation.x = Math.PI / 2;
    wheel.position.y = WHEEL_RADIUS_M;
    wheel.castShadow = true;
    pod.add(wheel);

    // MK5i-style gearbox block above the wheel.
    add(pod, 0.075, 0.09, 0.075, 0, WHEEL_RADIUS_M * 2 + 0.045, 0, podMat);

    group.add(pod);
    pods.push(pod);
  }

  return { group, pods };
}
