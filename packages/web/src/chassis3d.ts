/**
 * MK5i-style chassis for the 3D view. The swerve modules use real CAD:
 * `public/models/mk5i-module.glb`, the FRC Designs Onshape re-creation
 * of the MK5i (user decision 2026-10-02 — preferred over the official
 * SDS Parasolid export because it includes the two Kraken X60 motors;
 * core dimensions match the official layout drawing: height 6.16–6.17 in
 * both). Built by scripts/cad/README.md. Loaded once and cloned per
 * module — geometry and GPU buffers are shared. The procedural roller
 * wheel + gearbox block remains as the fallback when the asset is
 * absent or fails its sanity check, so the 3D view always has robots.
 *
 * The bumper skirt and frame deck stay procedural by design: they are
 * per-season rule rectangles tinted with the session's alliance color, not
 * MK5i geometry.
 *
 * Frame conventions (derived from field3d-frame.ts): the group sits at
 * the robot's pose on the floor; robot-frame x is local +X (forward),
 * robot-frame y is local +Z (left); a robot-frame yaw angle maps to
 * local rotation.y with the opposite sign (the render frame reflects).
 *
 * CAD template contract (enforced by the conversion script, validated at
 * load): meters, +Y up, origin at the steering axis on the floor, +X the
 * wheel's rolling direction (steering angle 0 = straight ahead), overall
 * height ≈ 0.156 m (6.16 in, the official layout drawing).
 */

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { bumperMaterial, applyBumperWeaveUV } from './bumper-material';
import type { ModuleLocation, RobotVisualGeometry } from '@pathblender/core';

/** 4 in wheel (typical MK5i fit). */
const WHEEL_RADIUS_M = 0.0508;
const WHEEL_WIDTH_M = 0.04;
/** Bumper skirt cross-section: 5 in tall, at real bumper height. */
const BUMPER_H_M = 0.127;
const BUMPER_Y_M = 0.115;
/** Official MK5i overall height (layout drawing: 6.17 in; the shipped
 *  decimated mesh measures 6.16 in). */
const MK5I_HEIGHT_M = 6.17 * 0.0254;

export interface Chassis3D {
  group: THREE.Group;
  /** Steering pivots, one per module — drive code sets rotation.y. */
  pods: THREE.Group[];
}

export function buildChassis3D(
  vis: RobotVisualGeometry,
  modules: readonly ModuleLocation[],
  color: string,
  moduleTemplate?: THREE.Object3D | null,
  teamNumber?: string,
  frameTemplate?: THREE.Object3D | null,
): Chassis3D {
  const group = new THREE.Group();

  // Everything with a fixed offset from the pose lives in `body`, so a
  // non-zero geometry offset shifts the whole chassis, not just one layer.
  const body = new THREE.Group();
  body.position.set(vis.outer.offsetX, 0, vis.outer.offsetY);
  group.add(body);

  const tint = new THREE.Color(color);
  const bumperMat = bumperMaterial(tint);
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
    const geometry = mat === bumperMat
      ? new RoundedBoxGeometry(w, h, d, 2, Math.min(0.009, d / 4, h / 4))
      : new THREE.BoxGeometry(w, h, d);
    const mesh = new THREE.Mesh(geometry, mat);
    if (mat === bumperMat) applyBumperWeaveUV(geometry);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    parent.add(mesh);
    return mesh;
  };

  // Bumper skirt: four boxes forming the ring at the outer footprint.
  // No floor deck by design (user directive 2026-10-02: bumper + 4 CAD
  // modules only) — the real metal frame arrives later as its own CAD
  // asset and slots in beside this ring.
  const L = vis.outer.lengthM;
  const W = vis.outer.widthM;
  const d = vis.bumperDepthM;
  add(body, L, BUMPER_H_M, d, 0, BUMPER_Y_M, (W - d) / 2, bumperMat);
  add(body, L, BUMPER_H_M, d, 0, BUMPER_Y_M, -(W - d) / 2, bumperMat);
  add(body, d, BUMPER_H_M, W - 2 * d, (L - d) / 2, BUMPER_Y_M, 0, bumperMat);
  add(body, d, BUMPER_H_M, W - 2 * d, -(L - d) / 2, BUMPER_Y_M, 0, bumperMat);

  // The user-built MK5i frame CAD (tubes + corner blocks + hardware,
  // 27x27 in unscaled; modules stripped — the app mounts its own). Scaled
  // per-robot only to fit that robot's chassis rectangle: exactly 1.0 for
  // the 2026 default, proportional for other seasons/file geometries.
  if (frameTemplate) {
    const frame = frameTemplate.clone(true);
    frame.scale.set(vis.chassis.lengthM / 0.6858, 1, vis.chassis.widthM / 0.6858);
    body.add(frame);
  }

  // Centered, upright stitched digits on all four outward-facing rails.
  // A fixed aspect ratio avoids stretching short numbers across the bumper.
  if (teamNumber) {
    const tex = teamNumberTexture(teamNumber);
    const mat = new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.98, depthWrite: false });
    for (const rail of [
      { width: L - 2 * d, x: 0, z: W / 2 + 0.001, yaw: 0 },
      { width: L - 2 * d, x: 0, z: -W / 2 - 0.001, yaw: Math.PI },
      { width: W - 2 * d, x: L / 2 + 0.001, z: 0, yaw: Math.PI / 2 },
      { width: W - 2 * d, x: -L / 2 - 0.001, z: 0, yaw: -Math.PI / 2 },
    ]) {
      const width = Math.min(rail.width * 0.92, BUMPER_H_M * 0.82 * 4);
      const decal = new THREE.Mesh(new THREE.PlaneGeometry(width, width / 4), mat);
      decal.name = 'bumper-team-number';
      decal.position.set(rail.x, BUMPER_Y_M, rail.z);
      decal.rotation.y = rail.yaw;
      body.add(decal);
    }
  }

  // Swerve pods at module positions (robot frame, relative to the pose).
  const pods: THREE.Group[] = [];
  for (const m of modules) {
    const pod = new THREE.Group();
    pod.position.set(m.x, 0, m.y);

    if (moduleTemplate) {
      // Official CAD module: clone shares geometry/materials with every
      // other instance, so N robots × 4 pods reuse one GPU copy.
      const inst = moduleTemplate.clone(true);
      pod.add(inst);
    } else {
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
    }

    group.add(pod);
    pods.push(pod);
  }

  return { group, pods };
}

/** Acceptance window for the CAD template's height sanity check. */
const TEMPLATE_HEIGHT_MIN_M = 0.1;
const TEMPLATE_HEIGHT_MAX_M = 0.35;

/**
 * Validate a freshly loaded template against the contract — catches a
 * unit error (inches/cm exports), an axle/rolling axis swap, or a
 * wrong model before it mis-renders every robot on the field. Returns
 * the template, or null to fall back to the procedural module.
 */
export function validateModuleTemplate(t: THREE.Object3D): THREE.Group | null {
  const box = new THREE.Box3().setFromObject(t);
  if (box.isEmpty()) return null;
  const h = box.max.y - box.min.y;
  if (h < TEMPLATE_HEIGHT_MIN_M || h > TEMPLATE_HEIGHT_MAX_M) {
    console.warn(
      `mk5i module template rejected: height ${h.toFixed(3)} m outside ` +
        `[${TEMPLATE_HEIGHT_MIN_M}, ${TEMPLATE_HEIGHT_MAX_M}] (expected ≈ ${MK5I_HEIGHT_M.toFixed(3)} m)`,
    );
    return null;
  }
  // +X is the rolling direction — and the module's long plan axis
  // (measured 2026-10-03: 0.2165 m along X vs 0.1843 m along Z). A
  // template rebuilt with the axle on +X (the ROLL_SWAP regression)
  // swaps the two yet passes the height check, so reject it here.
  const planX = box.max.x - box.min.x;
  const planZ = box.max.z - box.min.z;
  if (planX <= planZ) {
    console.warn(
      `mk5i module template rejected: plan ${planX.toFixed(3)}×${planZ.toFixed(3)} m ` +
        `has X ≤ Z — +X must be the rolling (long) axis`,
    );
    return null;
  }
  return t as THREE.Group;
}

/** Canvas texture with the team number in white — cached per number,
 *  shared by every robot carrying it (never disposed, like the module
 *  template). */
const teamNumberTexCache = new Map<string, THREE.CanvasTexture>();
function teamNumberTexture(num: string): THREE.CanvasTexture {
  const hit = teamNumberTexCache.get(num);
  if (hit) return hit;
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, 512, 128);
  ctx.font = 'bold 96px ui-sans-serif, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#f4f4f5';
  const metrics = ctx.measureText(num);
  const baseline = 64 + (metrics.actualBoundingBoxAscent - metrics.actualBoundingBoxDescent) / 2;
  ctx.fillText(num, 256, baseline, 480);
  // Fine diagonal stitch highlights are clipped to the glyphs.
  ctx.globalCompositeOperation = 'source-atop';
  ctx.strokeStyle = '#c8cbd0';
  ctx.lineWidth = 0.7;
  ctx.beginPath();
  for (let x = -128; x < 512; x += 4) { ctx.moveTo(x, 128); ctx.lineTo(x + 128, 0); }
  ctx.stroke();
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  teamNumberTexCache.set(num, tex);
  return tex;
}
