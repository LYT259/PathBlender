/**
 * 3D field view (user request, round 4): the same field image laid as a
 * ground plane, trajectories as colored lines, robots as boxes that follow
 * the shared clock. Orbit with drag, zoom with wheel/pinch, pan with
 * right-drag — first-person "walk the field" perspective on the fusion.
 */

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { FieldPackage, SessionTrajectory } from '@pathblender/core';
import { fieldImageWorldRect, samplePoseAt } from '@pathblender/core';
import { useI18n } from '../i18n';
import { useTheme } from '../theme';
import { aprilTagTexture } from '../april-tag-texture';

export interface FieldCanvas3DHandle {
  resetCam: () => void;
}

interface Props {
  field: FieldPackage;
  fieldImageUrl?: string;
  robots: SessionTrajectory[];
  currentT: number;
  /** Field construction variant (AndyMark vs welded), when offered. */
  variant?: 'welded' | 'andymark';
}

interface Scene3D {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  cx: number;
  cy: number;
  dynamic: THREE.Group;
  boxes: { mesh: THREE.Mesh; robot: SessionTrajectory }[];
  /** Render-on-demand: a frame is drawn only when something changed. */
  dirty: () => void;
  /** Official 3D field model (when available); replaces the fallback. */
  modelRoot: THREE.Group;
  /** Hand-built slab/walls/beacons — visible only without a model. */
  fallback: THREE.Group;
  /** Theme-token colors with live refs, retinted when the theme flips. */
  themed: { color: THREE.Color; token: string }[];
  /** ViewCube face textures bake tokens; regenerate on theme change. */
  retintCube: () => void;
}

const CAM_HOME: [number, number, number] = [0, 8.5, 11.5];

/** Official 3D field models (AdvantageScopeAssets, BSD-3) per season and
 *  construction variant; 2018-2020 have none and keep the fallback. */
const FIELD3D_MODELS: Record<string, { welded: string; andymark?: string }> = {
  'rapidreact-2022': { welded: '2022-rapidreact' },
  'chargedup-2023': { welded: '2023-chargedup' },
  'crescendo-2024': { welded: '2024-crescendo' },
  'reefscape-2025': { welded: '2025-reefscape-welded', andymark: '2025-reefscape-andymark' },
  'rebuilt-2026': { welded: '2026-rebuilt' },
};
const WALL_H = 0.9;
/** FRC official tag size (36h11 family, 6.5 in black square). */
const TAG_SIZE_M = 0.1651;

/** Field-frame quaternion [x,y,z,w] (WPILib, z-up) → three-frame quaternion
 *  (three.y = field.z, three.z = -field.y): q_three = q_M ⊗ q_field ⊗ q_M⁻¹. */
function fieldQuatToThree(q: [number, number, number, number]): THREE.Quaternion {
  const qM = new THREE.Quaternion().setFromRotationMatrix(
    new THREE.Matrix4().makeBasis(
      new THREE.Vector3(1, 0, 0),
      new THREE.Vector3(0, 0, 1),
      new THREE.Vector3(0, -1, 0),
    ),
  );
  const qf = new THREE.Quaternion(q[0], q[1], q[2], q[3]).normalize();
  return qM.clone().multiply(qf).multiply(qM.clone().invert());
}

/** Read a theme token at build time. */
function cssToken(name: string, fallback: string): string {
  return (
    getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback
  );
}

/** THREE.Color silently drops the alpha of rgba() tokens (e.g. light-theme
 *  --fg-dim is rgba(0,0,0,.5)) — composite over --canvas-bg instead so dim
 *  lines keep their translucency. Returns a hex number. */
function tokenColorHex(token: string, fallback: string): number {
  const v = cssToken(token, fallback);
  const m = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+))?\s*\)$/i.exec(v);
  if (!m) {
    const h = /^#([0-9a-f]{6})$/i.exec(v);
    if (h) return parseInt(h[1]!, 16);
    return 0x9a9aa0;
  }
  const b = /^#([0-9a-f]{6})$/i.exec(cssToken('--canvas-bg', '#1c1c1e'));
  const bh = b?.[1] ?? '1c1c1e';
  const bg = [parseInt(bh.slice(0, 2), 16), parseInt(bh.slice(2, 4), 16), parseInt(bh.slice(4, 6), 16)];
  const alpha = m[4];
  const a = alpha != null ? Math.min(1, Math.max(0, parseFloat(alpha))) : 1;
  const mix = (fg: number, i: number) => Math.round(fg * a + (bg[i] ?? 28) * (1 - a));
  return (
    (mix(parseFloat(m[1]!), 0) << 16) | (mix(parseFloat(m[2]!), 1) << 8) | mix(parseFloat(m[3]!), 2)
  );
}

export const FieldCanvas3D = forwardRef<FieldCanvas3DHandle, Props>(function FieldCanvas3D(
  { field, fieldImageUrl, robots, currentT, variant = 'welded' },
  ref,
) {
  const hostRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<Scene3D | null>(null);
  const { t } = useI18n();
  // Environments without WebGL (jsdom, locked-down webviews) fall back to a
  // quiet empty pane instead of crashing the app.
  const [glFailed, setGlFailed] = useState(false);

  // Scene scaffold: renderer/camera/controls/lights/ground — per field.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true });
    } catch {
      setGlFailed(true);
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    // Soft shadows are the strongest depth cue for the field structures.
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    // ACES + a neutral studio environment: single-light PBR was blowing out
    // speculars on the official models (plastic sheen) and crushing shadows
    // (dark game pieces) — this is the standard three.js GLTF setup.
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    {
      const pmrem = new THREE.PMREMGenerator(renderer);
      scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
      pmrem.dispose();
    }
    // Colors below are baked from theme tokens at build time; keep live refs
    // so a theme flip can retint them without rebuilding the scene.
    const themed: { color: THREE.Color; token: string }[] = [];
    const track = <T extends { color: THREE.Color }>(owner: T, token: string): T => {
      themed.push({ color: owner.color, token });
      return owner;
    };
    let retintCube: () => void = () => {};
    scene.background = new THREE.Color(cssToken('--canvas-bg', '#1c1c1e'));
    themed.push({ color: scene.background as THREE.Color, token: '--canvas-bg' });
    scene.fog = new THREE.Fog(0x000000, 34, 70);
    scene.fog.color.copy(scene.background);
    themed.push({ color: scene.fog.color, token: '--canvas-bg' });
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 300);
    camera.position.set(...CAM_HOME);
    const controls = new OrbitControls(camera, renderer.domElement);
    // Onshape-style: the view stops the moment the pointer is released — no
    // residual spin. (Damping also fought camera tweens; see flyTo below.)
    controls.enableDamping = false;
    // Onshape-style free orbit: no horizon clamp (it blocked one side of
    // the vertical swing); only pole epsilons avoid the gimbal dead spot.
    controls.minPolarAngle = 0.001;
    controls.maxPolarAngle = Math.PI - 0.001;
    controls.minDistance = 2;
    controls.maxDistance = 60;

    // Render on demand (declared early — Scene3D.dirty exposes it).
    let needsDraw = true;
    const markDirty = () => {
      needsDraw = true;
    };

    scene.add(new THREE.HemisphereLight(0xffffff, 0x8b8b96, 0.55));
    const sun = new THREE.DirectionalLight(0xffffff, 1.15);
    sun.position.set(9, 16, 8);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -12;
    sun.shadow.camera.right = 12;
    sun.shadow.camera.top = 12;
    sun.shadow.camera.bottom = -12;
    sun.shadow.camera.near = 2;
    sun.shadow.camera.far = 45;
    scene.add(sun);

    const rect = field.image
      ? fieldImageWorldRect(field.image, field.lengthM, field.widthM)
      : { left: -0.5, right: field.lengthM + 0.5, bottom: -0.5, top: field.widthM + 0.5 };
    const cx = (rect.left + rect.right) / 2;
    const cy = (rect.bottom + rect.top) / 2;
    const w = rect.right - rect.left;
    const h = rect.top - rect.bottom;

    const modelRoot = new THREE.Group();
    const fallback = new THREE.Group();
    scene.add(modelRoot);
    scene.add(fallback);

    if (fieldImageUrl) {
      const tex = new THREE.TextureLoader().load(fieldImageUrl);
      tex.colorSpace = THREE.SRGBColorSpace;
      // A 12 cm-thick slab (image on the top face via a rotated box with
      // per-face materials) reads as a physical floor, not a picture.
      const wood = track(
        new THREE.MeshStandardMaterial({ color: cssToken('--3d-slab', '#3a3a40'), roughness: 0.9 }),
        '--3d-slab',
      );
      const top = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95 });
      const slab = new THREE.Mesh(
        new THREE.BoxGeometry(w, 0.12, h),
        [wood, wood, top, wood, wood, wood],
      );
      slab.position.y = -0.06;
      slab.receiveShadow = true;
      fallback.add(slab);
    } else {
      fallback.add(
        new THREE.GridHelper(
          Math.max(w, h),
          24,
          new THREE.Color(tokenColorHex('--fg-dim', '#9a9aa0')),
          new THREE.Color(tokenColorHex('--border', '#3d3d41')),
        ),
      );
    }

    // Playfield outline (world 0..L × 0..W → centered coords).
    const hw = field.lengthM / 2;
    const hh = field.widthM / 2;
    const outline = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(-hw, 0.02, -hh),
        new THREE.Vector3(hw, 0.02, -hh),
        new THREE.Vector3(hw, 0.02, hh),
        new THREE.Vector3(-hw, 0.02, hh),
      ]),
      track(new THREE.LineBasicMaterial({ color: tokenColorHex('--fg-dim', '#9a9aa0') }), '--fg-dim'),
    );
    fallback.add(outline);

    // Perimeter walls — the cheapest cue that makes the plane read as a
    // place instead of a picture.
    const wallMat = track(
      new THREE.MeshStandardMaterial({
        color: cssToken('--3d-wall', '#4a4a4f'),
        roughness: 0.8,
        transparent: true,
        opacity: 0.95,
      }),
      '--3d-wall',
    );
    const thk = 0.08;
    for (const [wx, wz, sx, sz] of [
      [0, -hh - thk / 2, field.lengthM + thk * 2, thk],
      [0, hh + thk / 2, field.lengthM + thk * 2, thk],
      [-hw - thk / 2, 0, thk, field.widthM],
      [hw + thk / 2, 0, thk, field.widthM],
    ] as const) {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(sx, WALL_H, sz), wallMat);
      wall.position.set(wx, WALL_H / 2, wz);
      wall.castShadow = true;
      wall.receiveShadow = true;
      fallback.add(wall);
    }

    // AprilTag faces: real 36h11 patterns mounted at each tag's official
    // 6-DOF pose (WPILib layout quaternions) — a thin quad offset 12 mm
    // along its own normal so tags sit ON walls/reef surfaces. Beacon posts
    // stay in the fallback group for fields without an official model.
    for (const tag of field.aprilTags ?? []) {
      const z = Math.max(0.05, tag.z ?? 0.55);
      const quad = new THREE.Mesh(
        new THREE.PlaneGeometry(TAG_SIZE_M, TAG_SIZE_M),
        new THREE.MeshBasicMaterial({ map: aprilTagTexture(tag.id), side: THREE.DoubleSide, toneMapped: false }),
      );
      quad.name = `apriltag-${tag.id}`;
      quad.position.set(tag.x - cx, z, -(tag.y - cy));
      if (tag.quat) {
        quad.quaternion.copy(fieldQuatToThree(tag.quat));
      } else if (tag.rotRad != null) {
        quad.rotation.y = tag.rotRad;
      }
      quad.position.add(
        new THREE.Vector3(0, 0, 1).applyQuaternion(quad.quaternion).multiplyScalar(0.012),
      );
      scene.add(quad);
      const post = new THREE.Mesh(
        new THREE.CylinderGeometry(0.025, 0.025, z, 8),
        track(
          new THREE.MeshStandardMaterial({ color: cssToken('--3d-post', '#6a6a70'), roughness: 0.6 }),
          '--3d-post',
        ),
      );
      post.position.set(tag.x - cx, z / 2, -(tag.y - cy));
      post.castShadow = true;
      fallback.add(post);
    }

    const dynamic = new THREE.Group();
    scene.add(dynamic);

    sceneRef.current = { renderer, scene, camera, controls, cx, cy, dynamic, boxes: [], modelRoot, fallback, dirty: markDirty, themed, retintCube };

    const resize = () => {
      const wpx = host.clientWidth || 1;
      const hpx = host.clientHeight || 1;
      renderer.setSize(wpx, hpx);
      camera.aspect = wpx / hpx;
      camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(host);
    resize();

    // WebKit trackpad pinch fires gesture* events, not wheel+ctrlKey —
    // dolly the camera manually so pinch zoom works in the desktop shell.
    let lastScale = 1;
    const gestureScale = (e: Event) => (e as Event & { scale?: number }).scale ?? 1;
    const onGestureStart = (e: Event) => {
      lastScale = gestureScale(e);
    };
    const onGestureChange = (e: Event) => {
      e.preventDefault();
      const s = gestureScale(e);
      if (s > 0 && lastScale > 0) {
        const dir = camera.position.clone().sub(controls.target).multiplyScalar(1 / s);
        if (dir.length() > 1.5) camera.position.copy(controls.target).add(dir);
      }
      lastScale = s;
    };
    renderer.domElement.addEventListener('gesturestart', onGestureStart);
    renderer.domElement.addEventListener('gesturechange', onGestureChange);

    // Draw only when the camera moved or something was marked dirty —
    // the heavy field model made render-per-frame starve all macrotasks.
    controls.addEventListener('change', markDirty);
    const ro0 = new ResizeObserver(markDirty);
    ro0.observe(host);

    // --- Onshape-style ViewCube (top-right overlay) ---
    // A second renderer mirrors the main camera's orientation. Faces, edges
    // and corners are separate pick targets; each click tweens the camera to
    // the matching view (face → ortho, edge → two-axis, corner → trimetric).
    // Safe to tween now that damping is off — the old damping/tween fight
    // that deadlocked the rAF loop is gone, and user input cancels mid-flight.
    let tween: { from: THREE.Spherical; to: THREE.Spherical; start: number } | null = null;
    const onUserStart = () => {
      tween = null;
    };
    controls.addEventListener('start', onUserStart);
    const flyTo = (toPos: THREE.Vector3) => {
      const from = new THREE.Spherical().setFromVector3(
        camera.position.clone().sub(controls.target),
      );
      const to = new THREE.Spherical().setFromVector3(toPos.clone().sub(controls.target));
      let d = to.theta - from.theta;
      if (d > Math.PI) to.theta -= 2 * Math.PI;
      else if (d < -Math.PI) to.theta += 2 * Math.PI;
      to.phi = THREE.MathUtils.clamp(to.phi, 0.0015, Math.PI - 0.0015);
      from.phi = THREE.MathUtils.clamp(from.phi, 0.0015, Math.PI - 0.0015);
      tween = { from, to, start: performance.now() };
    };
    const viewcubeEl = document.createElement('div');
    viewcubeEl.className = 'viewcube';
    const cubeCanvas = document.createElement('canvas');
    viewcubeEl.appendChild(cubeCanvas);
    const homeBtn = document.createElement('button');
    homeBtn.className = 'vc-home';
    homeBtn.title = 'Home';
    homeBtn.innerHTML =
      '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 22V12h6v10"/></svg>';
    viewcubeEl.appendChild(homeBtn);
    host.appendChild(viewcubeEl);

    const cubeRenderer = new THREE.WebGLRenderer({ canvas: cubeCanvas, alpha: true, antialias: true });
    cubeRenderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 3));
    cubeRenderer.setSize(110, 110);
    const cubeScene = new THREE.Scene();
    const cubeCam = new THREE.PerspectiveCamera(38, 1, 0.1, 20);
    cubeCam.position.set(0, 0, 3.6);
    const cubeGroup = new THREE.Group();
    cubeScene.add(cubeGroup);
    const labels = [
      t('vc.right'), t('vc.left'), t('vc.top'), t('vc.bottom'), t('vc.front'), t('vc.back'),
    ];
    // Face textures bake per-world-face shading (top lit, bottom dark) at
    // 512px so the 110px cube stays crisp on retina displays.
    const mats = labels.map((lab, i) => new THREE.MeshBasicMaterial({ map: faceTexture(lab, i) }));
    // Face textures bake theme tokens at draw time; regenerate on theme flip.
    retintCube = () => {
      labels.forEach((lab, i) => {
        const m = mats[i];
        if (!m) return;
        m.map?.dispose();
        m.map = faceTexture(lab, i);
        m.needsUpdate = true;
      });
      for (const h of hotspots) {
        (h.mesh.material as THREE.MeshBasicMaterial).color.set(cssToken('--accent', '#0a84ff'));
      }
    };
    const cubeMesh = new THREE.Mesh(new THREE.BoxGeometry(1.55, 1.55, 1.55), mats);
    cubeGroup.add(cubeMesh);

    // Edge & corner hotspots (Onshape-style grips): invisible until hovered,
    // always raycast-first because they sit slightly outside the surface.
    const CUBE_H = 1.55 / 2;
    const hotspots: { mesh: THREE.Mesh; dir: THREE.Vector3 }[] = [];
    const addHot = (mesh: THREE.Mesh, dir: THREE.Vector3) => {
      hotspots.push({ mesh, dir });
      cubeGroup.add(mesh);
    };
    for (const sx of [-1, 1]) {
      for (const sy of [-1, 1]) {
        for (const sz of [-1, 1]) {
          const s = new THREE.Mesh(
            new THREE.SphereGeometry(0.105, 16, 12),
            new THREE.MeshBasicMaterial({ color: cssToken('--accent', '#0a84ff'), transparent: true, opacity: 0 }),
          );
          s.position.set(sx * CUBE_H, sy * CUBE_H, sz * CUBE_H).multiplyScalar(0.985);
          addHot(s, new THREE.Vector3(sx, sy, sz).normalize());
        }
      }
    }
    for (const axis of [0, 1, 2] as const) {
      const others = ([0, 1, 2] as const).filter((v) => v !== axis);
      const oa = others[0] ?? 0;
      const ob = others[1] ?? 1;
      for (const a of [-1, 1]) {
        for (const b of [-1, 1]) {
          const cyl = new THREE.Mesh(
            new THREE.CylinderGeometry(0.042, 0.042, 0.58, 10),
            new THREE.MeshBasicMaterial({ color: cssToken('--accent', '#0a84ff'), transparent: true, opacity: 0 }),
          );
          if (axis === 0) cyl.rotation.z = Math.PI / 2;
          else if (axis === 2) cyl.rotation.x = Math.PI / 2;
          const pos = new THREE.Vector3();
          const dir = new THREE.Vector3();
          pos.setComponent(oa, a * CUBE_H);
          pos.setComponent(ob, b * CUBE_H);
          dir.setComponent(oa, a);
          dir.setComponent(ob, b);
          cyl.position.copy(pos).multiplyScalar(0.985);
          addHot(cyl, dir.normalize());
        }
      }
    }

    const ray = new THREE.Raycaster();
    const cubePtr = new THREE.Vector2();
    interface CubePick {
      dir: THREE.Vector3 | null;
      faceIdx: number;
      hot: THREE.Mesh | null;
    }
    const pick = (ev: PointerEvent): CubePick => {
      const r = cubeCanvas.getBoundingClientRect();
      cubePtr.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(cubePtr, cubeCam);
      const hit = ray.intersectObject(cubeGroup, true)[0];
      if (!hit) return { dir: null, faceIdx: -1, hot: null };
      const hs = hotspots.find((h) => h.mesh === hit.object);
      if (hs) return { dir: hs.dir.clone(), faceIdx: -1, hot: hs.mesh };
      // Classify by how many local axes sit near their extreme: one → face,
      // two → edge, three → corner (the world direction IS the local one —
      // the cube only mirrors the camera).
      const p = cubeMesh.worldToLocal(hit.point.clone());
      const big = [Math.abs(p.x) > 0.5 * CUBE_H, Math.abs(p.y) > 0.5 * CUBE_H, Math.abs(p.z) > 0.5 * CUBE_H];
      const dir = new THREE.Vector3(
        big[0] ? Math.sign(p.x) : 0,
        big[1] ? Math.sign(p.y) : 0,
        big[2] ? Math.sign(p.z) : 0,
      );
      const faceIdx =
        dir.lengthSq() === 1
          ? [dir.x, -dir.x, dir.y, -dir.y, dir.z, -dir.z].findIndex((v) => v === 1)
          : -1;
      return { dir: dir.lengthSq() > 0 ? dir : null, faceIdx, hot: null };
    };
    const applyHover = (p: CubePick) => {
      mats.forEach((m, i) => m.color.set(i === p.faceIdx ? cssToken('--accent', '#0a84ff') : '#ffffff'));
      for (const h of hotspots) {
        (h.mesh.material as THREE.MeshBasicMaterial).opacity = h.mesh === p.hot ? 0.95 : 0;
      }
      markDirty();
    };
    const onCubeDown = (ev: PointerEvent) => {
      ev.stopPropagation();
      const p = pick(ev);
      if (!p.dir) return;
      // Test hook: the walkthrough asserts the camera reaches this target.
      (window as unknown as { __pb3d?: { lastPick?: THREE.Vector3 } }).__pb3d!.lastPick = p.dir.clone();
      const dist = camera.position.distanceTo(controls.target);
      flyTo(controls.target.clone().add(p.dir.clone().multiplyScalar(dist)));
    };
    const onCubeMove = (ev: PointerEvent) => {
      const p = pick(ev);
      applyHover(p);
      cubeCanvas.style.cursor = p.dir ? 'pointer' : 'default';
    };
    cubeCanvas.addEventListener('pointerdown', onCubeDown);
    cubeCanvas.addEventListener('pointermove', onCubeMove);
    const onHome = (ev: Event) => {
      ev.preventDefault();
      flyTo(new THREE.Vector3(...CAM_HOME));
    };
    homeBtn.addEventListener('click', onHome);

    let raf = 0;
    const loop = () => {
      // Ease azimuth sensitivity near the poles: OrbitControls turns a
      // constant radian-per-pixel, which visually spins up as the view
      // approaches straight up/down. sin(polar) → 0 at the poles.
      controls.rotateSpeed = Math.max(0.3, Math.sin(controls.getPolarAngle()) * 1.15);
      if (tween) {
        const t = Math.min(1, (performance.now() - tween.start) / 300);
        const e = 1 - Math.pow(1 - t, 3); // ease-out cubic
        const sph = new THREE.Spherical(
          THREE.MathUtils.lerp(tween.from.radius, tween.to.radius, e),
          THREE.MathUtils.lerp(tween.from.phi, tween.to.phi, e),
          THREE.MathUtils.lerp(tween.from.theta, tween.to.theta, e),
        );
        camera.position.setFromSpherical(sph).add(controls.target);
        camera.lookAt(controls.target);
        needsDraw = true;
        if (t >= 1) tween = null;
      }
      const moved = controls.update();
      if (needsDraw || moved) {
        needsDraw = false;
        renderer.render(scene, camera);
        // Mirror the main orientation into the cube and draw it too.
        cubeGroup.quaternion.copy(camera.quaternion).invert();
        cubeRenderer.render(cubeScene, cubeCam);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    // Test/debug hook: orientation + camera state assertions.
    (window as unknown as { __pb3d?: unknown }).__pb3d = { camera, controls, renderer, scene };

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      ro0.disconnect();
      controls.removeEventListener('change', markDirty);
      controls.removeEventListener('start', onUserStart);
      cubeCanvas.removeEventListener('pointerdown', onCubeDown);
      cubeCanvas.removeEventListener('pointermove', onCubeMove);
      homeBtn.removeEventListener('click', onHome);
      cubeRenderer.dispose();
      viewcubeEl.remove();
      renderer.domElement.removeEventListener('gesturestart', onGestureStart);
      renderer.domElement.removeEventListener('gesturechange', onGestureChange);
      controls.dispose();
      renderer.dispose();
      if (renderer.domElement.parentElement === host) host.removeChild(renderer.domElement);
      sceneRef.current = null;
    };
  }, [field, fieldImageUrl]);

  // Theme flips retint the built-once scene: background/fog, token-backed
  // structure materials, ViewCube face textures. React to the theme context —
  // the data-theme attribute is written by ThemeProvider's effect, so a DOM
  // read during render would always see the previous value.
  const themeResolved = useTheme().resolved;
  useEffect(() => {
    const st = sceneRef.current;
    if (!st) return;
    for (const { color, token } of st.themed) color.set(tokenColorHex(token, '#1c1c1e'));
    st.retintCube();
    st.dirty();
  }, [themeResolved]);

  // Official 3D field model (AdvantageScope assets, BSD-3): replaces the
  // hand-built fallback. Transform validated against the WPILib 2026 tag
  // layout: config rotation (x 90°) into the AS frame, then mirror X into
  // our blue-origin frame (reflection → materials flipped to DoubleSide).
  useEffect(() => {
    const st = sceneRef.current;
    if (!st) return;
    const entry = FIELD3D_MODELS[field.id];
    const dir =
      entry && (variant === 'andymark' ? entry.andymark ?? entry.welded : entry.welded);
    if (!dir) return; // no official model (2018-2020) — fallback stays
    let disposed = false;
    const url = `${import.meta.env.BASE_URL}fields3d/${dir}/model.glb`;
    new GLTFLoader().load(
      url,
      (gltf) => {
        if (disposed) return;
        const g = gltf.scene;
        g.rotation.x = Math.PI / 2;
        g.scale.x = -1;
        g.traverse((o) => {
          const mesh = o as THREE.Mesh;
          if (!mesh.isMesh) return;
          // Heavy model stays OUT of the shadow pass (a full second render
          // of ~1M triangles froze the main thread); a shadow-catcher
          // floor below still receives the robots' shadows cheaply.
          mesh.castShadow = false;
          mesh.receiveShadow = false;
          const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
          for (const m of mats) {
            const std = m as THREE.MeshStandardMaterial;
            std.side = THREE.DoubleSide;
            // The field has no chrome: clamp PBR sliders so the official
            // models read as carpet/wood/plastic under the studio env.
            std.roughness = Math.max(std.roughness ?? 0.5, 0.55);
            std.metalness = Math.min(std.metalness ?? 0, 0.05);
            std.envMapIntensity = 0.55;
          }
        });
        const catcher = new THREE.Mesh(
          new THREE.PlaneGeometry(field.lengthM + 2, field.widthM + 2),
          new THREE.ShadowMaterial({ opacity: 0.28 }),
        );
        catcher.rotation.x = -Math.PI / 2;
        catcher.position.y = 0.002;
        catcher.receiveShadow = true;
        st.modelRoot.add(catcher, g);
        st.fallback.visible = false;
        st.dirty();
      },
      undefined,
      () => undefined, // offline/missing model: fallback keeps rendering
    );
    return () => {
      disposed = true;
      st.modelRoot.traverse((o) => {
        const mesh = o as THREE.Mesh;
        mesh.geometry?.dispose?.();
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const m of mats) m?.dispose?.();
      });
      st.modelRoot.clear();
      st.fallback.visible = true;
    };
  }, [field.id, variant]);

  // Rebuild path tubes + robot boxes when the robot set changes.
  useEffect(() => {
    const st = sceneRef.current;
    if (!st) return;
    const disposeDeep = (obj: THREE.Object3D) => {
      obj.traverse((child) => {
        const mesh = child as THREE.Mesh;
        mesh.geometry?.dispose?.();
        const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
        else mat?.dispose?.();
      });
    };
    disposeDeep(st.dynamic);
    st.dynamic.clear();
    st.boxes = [];
    for (const r of robots) {
      const color = new THREE.Color(r.color);
      const pts = r.trajectory.samples.map(
        (s) => new THREE.Vector3(s.x - st.cx, 0.06, -(s.y - st.cy)),
      );
      if (pts.length > 1) {
        // Tube geometry gives the path real thickness (line width is not
        // honored by the WebGL backend) — a strong 3D cue.
        const curve = new THREE.CatmullRomCurve3(pts);
        const tube = new THREE.Mesh(
          new THREE.TubeGeometry(curve, Math.min(600, pts.length * 3), 0.05, 8),
          new THREE.MeshStandardMaterial({ color, roughness: 0.4 }),
        );
        st.dynamic.add(tube);
      }
      const L = r.trajectory.geometry.lengthM;
      const W = r.trajectory.geometry.widthM;
      const H = 0.45;
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(L, H, W),
        new THREE.MeshStandardMaterial({ color, roughness: 0.45 }),
      );
      mesh.castShadow = true;
      st.dynamic.add(mesh);
      st.boxes.push({ mesh, robot: r });
      st.dirty();
    }
  }, [robots]);

  // Drive boxes along the shared clock.
  useEffect(() => {
    const st = sceneRef.current;
    if (!st) return;
    for (const { mesh, robot } of st.boxes) {
      const pose = samplePoseAt(robot, currentT);
      mesh.position.set(pose.x - st.cx, 0.225, -(pose.y - st.cy));
      mesh.rotation.y = pose.heading;
      st.dirty();
    }
  }, [currentT, robots]);

  useImperativeHandle(ref, () => ({
    // Fit = frame the current content (Onshape habit): keep the viewing
    // direction, pull back to a distance that frames field + paths.
    resetCam: () => {
      const st = sceneRef.current;
      if (!st) return;
      const radius = Math.max(st.cx, st.cy) + 2;
      const fov = (st.camera.fov * Math.PI) / 180;
      const dist = (radius / Math.tan(fov / 2)) * 1.15;
      const dir = st.camera.position.clone().sub(st.controls.target).normalize();
      st.controls.target.set(0, 0, 0);
      st.camera.position.copy(dir.multiplyScalar(dist));
      st.controls.update();
      st.dirty();
    },
  }));

  if (glFailed) return <div className="field-canvas-3d" aria-label="WebGL unavailable" />;
  return <div ref={hostRef} className="field-canvas-3d" />;
});


/** Localized label texture for one ViewCube face (512px for retina-crisp
 *  rendering). faceIdx: 0 +x, 1 -x, 2 top, 3 bottom, 4 +z, 5 -z — the
 *  per-world-face brightness is baked, Onshape-style lit cube. */
function faceTexture(label: string, faceIdx: number): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 512;
  const g = c.getContext('2d')!;
  const card = cssToken('--bg-card', '#2c2c2f');
  const m = /^#([0-9a-f]{6})$/i.exec(card.trim());
  const hex = m?.[1] ?? '8c8c91';
  const base = [
    parseInt(hex.slice(0, 2), 16),
    parseInt(hex.slice(2, 4), 16),
    parseInt(hex.slice(4, 6), 16),
  ];
  const shade = (mul: number) =>
    `rgb(${base.map((v) => Math.round(Math.max(0, Math.min(255, v * mul)))).join(',')})`;
  const faceMul = faceIdx === 2 ? 1.1 : faceIdx === 3 ? 0.78 : 1;
  const grad = g.createLinearGradient(0, 0, 0, 512);
  grad.addColorStop(0, shade(faceMul * 1.05));
  grad.addColorStop(1, shade(faceMul * 0.92));
  g.fillStyle = grad;
  g.fillRect(0, 0, 512, 512);
  g.strokeStyle = cssToken('--border', '#3d3d41');
  g.lineWidth = 14;
  g.strokeRect(10, 10, 492, 492);
  g.fillStyle = cssToken('--fg', '#e6e6e8');
  g.font = '700 168px -apple-system, "Segoe UI", sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(label, 256, 272);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}
