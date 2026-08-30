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
import type { FieldPackage, SessionTrajectory } from '@pathblender/core';
import { fieldImageWorldRect, samplePoseAt } from '@pathblender/core';

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
const TAG_PURPLE = '#9c6bff';

/** Read a theme token at build time. */
function cssToken(name: string, fallback: string): string {
  return (
    getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback
  );
}

export const FieldCanvas3D = forwardRef<FieldCanvas3DHandle, Props>(function FieldCanvas3D(
  { field, fieldImageUrl, robots, currentT, variant = 'welded' },
  ref,
) {
  const hostRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<Scene3D | null>(null);
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
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(cssToken('--bg', '#1e1e20'));
    scene.fog = new THREE.Fog(scene.background, 34, 70);
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 300);
    camera.position.set(...CAM_HOME);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.maxPolarAngle = Math.PI / 2.05;

    // Render on demand (declared early — Scene3D.dirty exposes it).
    let needsDraw = true;
    const markDirty = () => {
      needsDraw = true;
    };

    scene.add(new THREE.AmbientLight(0xffffff, 0.75));
    const sun = new THREE.DirectionalLight(0xffffff, 1.8);
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
      const wood = new THREE.MeshStandardMaterial({ color: new THREE.Color(cssToken('--3d-slab', '#3a3a40')), roughness: 0.9 });
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
          new THREE.Color(cssToken('--fg-dim', '#9a9aa0')),
          new THREE.Color(cssToken('--border', '#3d3d41')),
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
      new THREE.LineBasicMaterial({ color: new THREE.Color(cssToken('--fg-dim', '#9a9aa0')) }),
    );
    fallback.add(outline);

    // Perimeter walls — the cheapest cue that makes the plane read as a
    // place instead of a picture.
    const wallMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(cssToken('--3d-wall', '#4a4a4f')),
      roughness: 0.8,
      transparent: true,
      opacity: 0.95,
    });
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

    // AprilTag beacons: posts rising to each tag's official mount height,
    // plate at the tag position (built-in 2026 layout or custom fields).
    for (const tag of field.aprilTags ?? []) {
      const z = Math.max(0.3, tag.z ?? 0.55);
      const post = new THREE.Mesh(
        new THREE.CylinderGeometry(0.025, 0.025, z, 8),
        new THREE.MeshStandardMaterial({ color: new THREE.Color(cssToken('--3d-post', '#6a6a70')), roughness: 0.6 }),
      );
      post.position.set(tag.x - cx, z / 2, -(tag.y - cy));
      post.castShadow = true;
      scene.add(post);
      const plate = new THREE.Mesh(
        new THREE.BoxGeometry(0.17, 0.17, 0.02),
        new THREE.MeshStandardMaterial({ color: new THREE.Color(TAG_PURPLE) }),
      );
      plate.position.set(tag.x - cx, z, -(tag.y - cy));
      if (tag.rotRad != null) plate.rotation.y = tag.rotRad;
      scene.add(plate);
    }

    const dynamic = new THREE.Group();
    scene.add(dynamic);

    sceneRef.current = { renderer, scene, camera, controls, cx, cy, dynamic, boxes: [], modelRoot, fallback, dirty: markDirty };

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

    let raf = 0;
    const loop = () => {
      const moved = controls.update();
      if (needsDraw || moved) {
        needsDraw = false;
        renderer.render(scene, camera);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      ro0.disconnect();
      controls.removeEventListener('change', markDirty);
      renderer.domElement.removeEventListener('gesturestart', onGestureStart);
      renderer.domElement.removeEventListener('gesturechange', onGestureChange);
      controls.dispose();
      renderer.dispose();
      if (renderer.domElement.parentElement === host) host.removeChild(renderer.domElement);
      sceneRef.current = null;
    };
  }, [field, fieldImageUrl]);

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
            (m as THREE.MeshStandardMaterial).side = THREE.DoubleSide;
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
    resetCam: () => {
      const st = sceneRef.current;
      if (!st) return;
      st.camera.position.set(...CAM_HOME);
      st.controls.target.set(0, 0, 0);
      st.controls.update();
    },
  }));

  if (glFailed) return <div className="field-canvas-3d" aria-label="WebGL unavailable" />;
  return <div ref={hostRef} className="field-canvas-3d" />;
});
