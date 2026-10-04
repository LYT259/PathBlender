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
 * per-season rule rectangles tinted with the robot's identity color, not
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
import { moduleBaseYaw } from '@pathblender/core';
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
/**
 * Module mount height above the frame CAD's y origin (the belly-pan
 * bottom, NOT the ground): rail top at the corner mounts (frame-y
 * 0.061516 m, measured on mk5i-frame.glb) minus the module
 * mounting-plate bottom face that rides the rail top (module-y
 * 0.092126 m — the module GLB's largest full-footprint downward face,
 * 2026-10-04 re-measurement; the earlier 0.042118 reading was the
 * fork/gearbox underside and would put the plate BELOW the fork top
 * 0.0775, mechanically impossible) = −0.030610 m. NEGATIVE on purpose:
 * the plate bottom sits ABOVE the rail top's frame-y, so the frame
 * assembly RISES 30.6 mm and the belly pan clears the field floor by
 * 30.6 mm — the 0.042118 reading sank it 19.4 mm UNDER the floor (the
 * "frame touches the ground" bug, user 2026-10-04). Consistency checks
 * on the shipped assets: fork top 0.0775 < plate 0.0921 ✓, wheel top
 * 0.1016 pokes 9.5 mm past the plate ✓, bolt heads (frame-y 0.0695 +
 * 0.0306 ≈ 0.1001) stand ~4 mm over the plate top ≈ 0.0961 ✓.
 */
const MODULE_MOUNT_Y_M = -0.03061;
/** Split-GLB contract (2026-10-03): `mk5i-turret-*` nodes (turret +
 *  wheel) rotate about the steering axis at the origin; `mk5i-box-*`
 *  nodes are bolted to the mounting plate and never steer. */
const MK5I_TURRET_PREFIX = 'mk5i-turret-';

export interface Chassis3D {
  group: THREE.Group;
  /** Module roots, one per module — position only, never rotated. */
  pods: THREE.Group[];
  /** Steering pivots, one per module — drive code sets rotation.y. For
   *  the split GLB this is the turret sub-group (the box stays frozen at
   *  the installed yaw); for an old GLB or the procedural fallback it is
   *  the pod itself (the whole module steers, the previous behavior). */
  turrets: THREE.Group[];
}

export function buildChassis3D(
  vis: RobotVisualGeometry,
  modules: readonly ModuleLocation[],
  color: string,
  moduleTemplate?: THREE.Object3D | null,
  teamNumber?: string,
  frameTemplate?: THREE.Object3D | null,
  /** Renderer max anisotropy for the cached decal/weave textures. */
  anisotropy = 1,
): Chassis3D {
  const group = new THREE.Group();

  // Everything with a fixed offset from the pose lives in `body`, so a
  // non-zero geometry offset shifts the whole chassis, not just one layer.
  const body = new THREE.Group();
  body.position.set(vis.outer.offsetX, 0, vis.outer.offsetY);
  group.add(body);

  const tint = new THREE.Color(color);
  const bumperMat = bumperMaterial(tint, anisotropy);
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

  // Everything bolted to the frame — the frame CAD itself, the bumper
  // ring, the team decals — assembles relative to the frame GLB's own y
  // origin, so the whole assembly shifts by −MODULE_MOUNT_Y_M together.
  // With the corrected (negative) mount height that is a 30.6 mm RISE:
  // the modules' mounting plates rest on the rail tops, the belly pan
  // clears the floor, and the wheels stay on the field floor.
  const frameAsm = new THREE.Group();
  frameAsm.name = 'frame-assembly';
  frameAsm.position.y = -MODULE_MOUNT_Y_M;
  body.add(frameAsm);

  // Bumper skirt: ONE continuous closed square ring around the footprint
  // (user 2026-10-04, second pass: no seams between rails anywhere — a
  // single band, outer square minus inner square). No floor deck by
  // design (user directive 2026-10-02: bumper + 4 CAD modules only) —
  // the metal frame is its own CAD asset and slots in beside this ring.
  const L = vis.outer.lengthM;
  const W = vis.outer.widthM;
  const d = vis.bumperDepthM;
  const ringGeometry = (): THREE.BufferGeometry => {
    const shape = new THREE.Shape();
    shape.moveTo(-L / 2, -W / 2);
    shape.lineTo(L / 2, -W / 2);
    shape.lineTo(L / 2, W / 2);
    shape.lineTo(-L / 2, W / 2);
    shape.closePath();
    const hole = new THREE.Path();
    hole.moveTo(-(L / 2 - d), -(W / 2 - d));
    hole.lineTo(L / 2 - d, -(W / 2 - d));
    hole.lineTo(L / 2 - d, W / 2 - d);
    hole.lineTo(-(L / 2 - d), W / 2 - d);
    hole.closePath();
    shape.holes.push(hole);
    const geo = new THREE.ExtrudeGeometry(shape, { depth: BUMPER_H_M, bevelEnabled: false });
    geo.rotateX(Math.PI / 2); // (x,y,z)→(x,−z,y): shape-y→+z, extrusion lands y∈[−H,0]
    geo.translate(0, BUMPER_H_M, 0); // lift to y∈[0,H]
    return geo;
  };
  {
    const geometry = ringGeometry();
    applyBumperWeaveUV(geometry);
    const mesh = new THREE.Mesh(geometry, bumperMat);
    mesh.name = 'bumper-rail';
    mesh.position.set(0, BUMPER_Y_M - BUMPER_H_M / 2, 0);
    mesh.castShadow = true;
    frameAsm.add(mesh);
  }

  // The user-built MK5i frame CAD (tubes + corner blocks + hardware,
  // 27x27 in unscaled; modules stripped — the app mounts its own). Scaled
  // per-robot only to fit that robot's chassis rectangle: exactly 1.0 for
  // the 2026 default, proportional for other seasons/file geometries.
  if (frameTemplate) {
    const frame = frameTemplate.clone(true);
    frame.scale.set(vis.chassis.lengthM / 0.6858, 1, vis.chassis.widthM / 0.6858);
    frameAsm.add(frame);
  }

  // Centered, upright stitched digits on all four outward-facing rails.
  // A fixed aspect ratio avoids stretching short numbers across the bumper.
  if (teamNumber) {
    const tex = teamNumberTexture(teamNumber, anisotropy);
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
      frameAsm.add(decal);
    }
  }

  // Swerve pods at module positions (robot frame, relative to the
  // pose). The modules bolt to the frame, so pod heights are
  // frame-relative: they sit in a group shifted by −MODULE_MOUNT_Y_M
  // like the frame assembly, and each pod sits at +MODULE_MOUNT_Y_M —
  // mounting-plate bottoms exactly on the rail tops, wheel bottoms
  // still on the field floor (net world y = 0, unchanged).
  const podMount = new THREE.Group();
  podMount.name = 'pod-mount';
  podMount.position.y = -MODULE_MOUNT_Y_M;
  group.add(podMount);

  const pods: THREE.Group[] = [];
  const turrets: THREE.Group[] = [];
  for (const m of modules) {
    const pod = new THREE.Group();
    pod.position.set(m.x, MODULE_MOUNT_Y_M, m.y);

    if (moduleTemplate) {
      // Official CAD module: clone shares geometry/materials with every
      // other instance, so N robots × 4 pods reuse one GPU copy.
      const inst = moduleTemplate.clone(true);
      // Split-GLB contract: pull the `mk5i-turret-*` nodes (top-most
      // matches) into a turret group driven by steering; whatever
      // remains in the clone is the box (the `mk5i-box-*` nodes plus
      // anything unprefixed), frozen at the installed yaw — identical
      // to the previous parked pose. An old GLB has no mk5i-turret-*
      // nodes (a stale service-worker cache can serve it): fall back
      // to the previous behavior — the whole pod steers.
      const turretNodes: THREE.Object3D[] = [];
      const collectTurrets = (root: THREE.Object3D): void => {
        for (const child of root.children) {
          if (child.name.startsWith(MK5I_TURRET_PREFIX)) turretNodes.push(child);
          else collectTurrets(child);
        }
      };
      collectTurrets(inst);
      if (turretNodes.length > 0) {
        const turret = new THREE.Group();
        turret.name = 'mk5i-turret';
        // Park at the installed yaw — the drive loop's seeded steer
        // applies this same angle on its first pass.
        turret.rotation.y = -moduleBaseYaw(m);
        // attach() re-parents while preserving each node's world
        // transform, so the GLB's own node rotations (the Assembly
        // ±90°X pair) survive the move; the clone keeps only the box
        // nodes and becomes the box group.
        inst.updateMatrixWorld(true);
        for (const n of turretNodes) turret.attach(n);
        // Robot-frame yaw maps to render yaw with the opposite sign —
        // the same mapping the drive loop applies to the turret.
        inst.rotation.y = -moduleBaseYaw(m);
        pod.add(inst);
        pod.add(turret);
        turrets.push(turret);
      } else {
        pod.add(inst);
        turrets.push(pod);
      }
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
      // Procedural fallback: the whole pod steers, as before.
      turrets.push(pod);
    }

    podMount.add(pod);
    pods.push(pod);
  }

  return { group, pods, turrets };
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
function teamNumberTexture(num: string, anisotropy = 1): THREE.CanvasTexture {
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
  tex.anisotropy = anisotropy;
  teamNumberTexCache.set(num, tex);
  return tex;
}
