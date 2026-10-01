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
import { samplePoseAt } from '@pathblender/core';
import { useI18n } from '../i18n';
import { useTheme } from '../theme';
import { aprilTagTexture } from '../april-tag-texture';
// One coordinate frame for the whole scene — tags, robots, trails, fallback
// structures and the flat field image all map through these, so no layer can
// drift into a mirrored copy of another. Derivation and the numeric per-tag
// check live in `../field3d-frame` + `test/field3d-frame.test.ts`.
import {
  fieldRenderBounds,
  headingToRender,
  tagRenderPose,
  worldToRender,
  worldToRenderVec3,
} from '../field3d-frame';

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
}

// AS-style overview: higher and further back than the early low angle,
// which read as a tilted slab (strong perspective) rather than a field.
const CAM_HOME: [number, number, number] = [0, 13.5, 10.5];

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
    // AdvantageScope's lighting recipe: no tone mapping, no environment
    // map, no fog — a hemisphere fill plus one shadow-casting key light.
    // (The earlier ACES+studio-env stack overexposed the official models.)
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    // Colors below are baked from theme tokens at build time; keep live refs
    // so a theme flip can retint them without rebuilding the scene.
    const themed: { color: THREE.Color; token: string }[] = [];
    const track = <T extends { color: THREE.Color }>(owner: T, token: string): T => {
      themed.push({ color: owner.color, token });
      return owner;
    };
    scene.background = new THREE.Color(cssToken('--canvas-bg', '#1c1c1e'));
    themed.push({ color: scene.background as THREE.Color, token: '--canvas-bg' });
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 300);
    camera.position.set(...CAM_HOME);
    const controls = new OrbitControls(camera, renderer.domElement);
    // Damped drag (the flat-field-era feel the user asked back): releasing
    // the pointer lets the view glide to a stop.
    // user input, and the rAF loop runs unconditionally, so the old
    // damping/tween deadlock does not apply.
    controls.enableDamping = true; // default dampingFactor (0.05): the original glide
    // Turntable-style vertical clamp: both sides of the field stay
    // reachable. 0.15 keeps a top-down view (never gimbal-dead at the
    // exact pole); 2.60 leans well past the far wall from the home side —
    // the "other side's" low grazing angle users asked for (the old 1.62
    // clamp blocked it; that read as one-sided dragging). The camera can
    // dip below the slab plane at these angles without cutting into the
    // model because the slab is thin and the near wall occludes.
    controls.minPolarAngle = 0.15;
    controls.maxPolarAngle = 2.6;
    controls.minDistance = 2;
    controls.maxDistance = 60;
    // Drag-orbit (original 3D-mode logic, Onshape-style): cursor down lifts
    // the camera so the field's top tilts into view — the same direction the
    // flat-field build used. Owned here (not OrbitControls) so the glide and
    // clamp share the spherical math with the wheel-deltaX handler.
    controls.enableRotate = false;
    const drag = { active: false, x: 0, y: 0, vTheta: 0, vPhi: 0, lastT: 0 };
    const applyOrbit = (dTheta: number, dPhi: number) => {
      const sph = new THREE.Spherical().setFromVector3(
        camera.position.clone().sub(controls.target),
      );
      sph.theta -= dTheta;
      sph.phi = THREE.MathUtils.clamp(sph.phi - dPhi, 0.15, 2.6);
      camera.position.setFromSpherical(sph).add(controls.target);
      camera.lookAt(controls.target);
      markDirty();
    };
    const onDragDown = (e: PointerEvent) => {
      if (e.button !== 0 || e.shiftKey) return; // Shift+left = pan (controls)
      drag.active = true;
      drag.x = e.clientX;
      drag.y = e.clientY;
      drag.vTheta = 0;
      drag.vPhi = 0;
      drag.lastT = performance.now();
      renderer.domElement.setPointerCapture(e.pointerId);
    };
    const onDragMove = (e: PointerEvent) => {
      if (!drag.active) return;
      const ROT = 0.0052; // rad per px — the flat-field-era sensitivity
      const dTheta = (e.clientX - drag.x) * ROT;
      const dPhi = (e.clientY - drag.y) * ROT; // drag down → phi shrinks → camera rises
      drag.x = e.clientX;
      drag.y = e.clientY;
      const now = performance.now();
      const dt = Math.max(1, now - drag.lastT);
      drag.lastT = now;
      applyOrbit(dTheta, dPhi);
      // velocity for the release glide (rad/ms)
      drag.vTheta = drag.vTheta * 0.7 + (dTheta / dt) * 0.3;
      drag.vPhi = drag.vPhi * 0.7 + (dPhi / dt) * 0.3;
    };
    const onDragUp = (e: PointerEvent) => {
      if (!drag.active) return;
      drag.active = false;
      renderer.domElement.releasePointerCapture(e.pointerId);
    };
    renderer.domElement.addEventListener('pointerdown', onDragDown);
    renderer.domElement.addEventListener('pointermove', onDragMove);
    renderer.domElement.addEventListener('pointerup', onDragUp);
    renderer.domElement.addEventListener('pointercancel', onDragUp);

    // Trackpad two-finger horizontal swipes arrive as wheel deltaX, which
    // OrbitControls ignores — turn them into azimuth rotation so "dragging
    // left/right" works without holding the button.
    const onWheelX = (e: WheelEvent) => {
      if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
      const sph = new THREE.Spherical().setFromVector3(
        camera.position.clone().sub(controls.target),
      );
      sph.theta -= e.deltaX * 0.0025;
      camera.position.setFromSpherical(sph).add(controls.target);
      camera.lookAt(controls.target);
      markDirty();
    };
    renderer.domElement.addEventListener('wheel', onWheelX, { passive: true });

    // Render on demand (declared early — Scene3D.dirty exposes it).
    let needsDraw = true;
    const markDirty = () => {
      needsDraw = true;
    };

    scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 0.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1.1);
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

    const { cx, cy, width: w, depth: h } = fieldRenderBounds(field);

    const modelRoot = new THREE.Group();
    const fallback = new THREE.Group();
    scene.add(modelRoot);
    scene.add(fallback);

    if (fieldImageUrl) {
      const tex = new THREE.TextureLoader().load(fieldImageUrl);
      tex.colorSpace = THREE.SRGBColorSpace;
      // The field artwork runs left→right with world +x, but the render frame
      // maps world +x to −X (see field3d-frame), so the image is flipped
      // along U or the flat fallback shows the blue alliance on the red side.
      // Derived from worldToRender rather than hardcoded: if the frame ever
      // changes sense, the artwork follows it.
      const xSense = Math.sign(worldToRender(1, 0, 0, 0)[0]);
      tex.wrapS = THREE.RepeatWrapping;
      tex.repeat.x = xSense;
      tex.offset.x = xSense < 0 ? 1 : 0;
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

    // AprilTag faces: real 36h11 patterns at each tag's pose, mapped into
    // the render frame by tagRenderPose (validated against the official
    // asset config). Geometry edge = black-square size × 10/8 (the texture
    // adds the quiet ring); the quad floats 1 mm off its surface along its
    // own normal. Beacon posts (for fields without an official model) are
    // placed at the same foot point.
    for (const tag of field.aprilTags ?? []) {
      const z = Math.max(0.05, tag.z ?? 0.55);
      const { position: tagPos, quaternion: tagQuat } = tagRenderPose(tag, cx, cy);
      const quad = new THREE.Mesh(
        new THREE.PlaneGeometry(TAG_SIZE_M * (10 / 8), TAG_SIZE_M * (10 / 8)),
        new THREE.MeshBasicMaterial({ map: aprilTagTexture(tag.id), side: THREE.DoubleSide, toneMapped: false }),
      );
      quad.name = `apriltag-${tag.id}`;
      quad.position.copy(tagPos);
      quad.quaternion.copy(tagQuat);
      quad.position.add(
        new THREE.Vector3(0, 0, 1).applyQuaternion(tagQuat).multiplyScalar(0.001),
      );
      scene.add(quad);
      const post = new THREE.Mesh(
        new THREE.CylinderGeometry(0.025, 0.025, tagPos.z, 8),
        track(
          new THREE.MeshStandardMaterial({ color: cssToken('--3d-post', '#6a6a70'), roughness: 0.6 }),
          '--3d-post',
        ),
      );
      post.position.set(tagPos.x, tagPos.y, tagPos.z / 2);
      post.castShadow = true;
      scene.add(post);
    }

    // Season structures for fields without official 3D models (2018–2020
    // have none in AdvantageScopeAssets): recognizable silhouettes from the
    // public game manuals, not CAD replicas.
    const season = seasonStructures(field.id, cx, cy);
    if (season) fallback.add(season);
    // No flash of the flat fallback while an official model loads: seasons
    // that have one keep the fallback hidden until (and unless) loading
    // fails; model-less seasons show it right away.
    if (FIELD3D_MODELS[field.id]) fallback.visible = false;

    const dynamic = new THREE.Group();
    // Named so tests (and the walkthrough) can reach the rebuilt content
    // after a field switch — see the tube/box rebuild effect below.
    dynamic.name = 'pb-dynamic';
    scene.add(dynamic);

    sceneRef.current = { renderer, scene, camera, controls, cx, cy, dynamic, boxes: [], modelRoot, fallback, dirty: markDirty, themed };

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

    // Test/debug hook: orientation + camera state assertions.
    (window as unknown as { __pb3d?: unknown }).__pb3d = { camera, controls, renderer, scene };

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      ro0.disconnect();
      controls.removeEventListener('change', markDirty);
      renderer.domElement.removeEventListener('pointerdown', onDragDown);
      renderer.domElement.removeEventListener('pointermove', onDragMove);
      renderer.domElement.removeEventListener('pointerup', onDragUp);
      renderer.domElement.removeEventListener('pointercancel', onDragUp);
      renderer.domElement.removeEventListener('wheel', onWheelX);
      renderer.domElement.removeEventListener('gesturestart', onGestureStart);
      renderer.domElement.removeEventListener('gesturechange', onGestureChange);
      controls.dispose();
      renderer.dispose();
      if (renderer.domElement.parentElement === host) host.removeChild(renderer.domElement);
      sceneRef.current = null;
    };
  }, [field, fieldImageUrl]);

  // Theme flips retint the built-once scene: background/fog and every
  // token-backed structure material. React to the theme context —
  // the data-theme attribute is written by ThemeProvider's effect, so a DOM
  // read during render would always see the previous value.
  const themeResolved = useTheme().resolved;
  useEffect(() => {
    const st = sceneRef.current;
    if (!st) return;
    for (const { color, token } of st.themed) color.set(tokenColorHex(token, '#1c1c1e'));
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
        // AdvantageScope's loadField applies the config rotation Rx(90°),
        // and its scene then wraps everything in a group carrying
        // Rx(−90°)·Ry(180°) — the NET model rotation is a plain 180° yaw:
        // (x, y, z) → (−x, −y, z). We removed that yaw by accident in the
        // "no rotation" pass, mirroring the field end-for-end so the tags
        // (placed on the correct side of the coordinate frame) floated
        // behind structures. Apply the 180° yaw and recenter: native Z is
        // off-center (−4.12..6.44, fuel piles at +Z) → shift Z by +1.16
        // after the yaw flips its sign; native floor at −0.13 → +0.13.
        g.rotation.y = Math.PI;
        g.position.set(0, 0.13, 1.16);
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
      () => {
        if (disposed) return;
        // offline/missing model: the flat fallback takes over
        st.fallback.visible = true;
        st.dirty();
      },
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
      // Visibility stays false for official-model seasons across the swap
      // (restating it true here flashes the flat field for one frame).
    };
  }, [field.id, variant]);

  // Rebuild path tubes + robot boxes when the robot set changes — AND when
  // the field changes: the scaffold effect tears the whole scene down and
  // hands sceneRef a fresh, EMPTY dynamic group; without `field` in the deps
  // this effect never re-ran, so switching seasons in 3D left the field
  // without any paths or robots (user report 2026-09-30). Declaration order
  // guarantees the scaffold rebuilds first.
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
      const pts = r.trajectory.samples.map((s) =>
        worldToRenderVec3(s.x, s.y, 0.06, st.cx, st.cy),
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
  }, [robots, field]);

  // Drive boxes along the shared clock.
  useEffect(() => {
    const st = sceneRef.current;
    if (!st) return;
    for (const { mesh, robot } of st.boxes) {
      const pose = samplePoseAt(robot, currentT);
      mesh.position.copy(worldToRenderVec3(pose.x, pose.y, 0.225, st.cx, st.cy));
      // The render frame reflects X, so the heading reflects with it —
      // leaving it raw would have every robot drive sideways.
      mesh.rotation.y = headingToRender(pose.heading);
      st.dirty();
    }
  }, [currentT, robots, field]);

  useImperativeHandle(ref, () => ({
    // Fit the whole field into the vertical field of view from the current
    // viewing direction — the toolbar's Fit action. It deliberately keeps the
    // direction the user orbited to, so it does NOT restore the load-time
    // camera (CAM_HOME sits closer, at |CAM_HOME| ≈ 17.1 m).
    resetCam: () => {
      const st = sceneRef.current;
      if (!st) return;
      const diagonal = Math.hypot(st.cx * 2, st.cy * 2);
      const fov = (st.camera.fov * Math.PI) / 180;
      const dist = Math.max((diagonal / 2 / Math.tan(fov / 2)) * 1.05, 6);
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


/** Recognizable season silhouettes for the no-official-model years.
 *  Field-frame (fx, fy) positions go through the scene's one mapping.
 *  Colors: neutral gray structure with red/blue alliance accents. */
function seasonStructures(fieldId: string, cx: number, cy: number): THREE.Group | null {
  const g = new THREE.Group();
  const P = (fx: number, fy: number, h: number) => worldToRenderVec3(fx, fy, h, cx, cy);
  const RED = 0xb03030;
  const BLUE = 0x3050b0;
  const WOOD = 0x9a8a70;
  const GRAY = 0x8a8a90;
  const box = (w: number, h: number, d: number, pos: THREE.Vector3, color: number) => {
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, d),
      new THREE.MeshStandardMaterial({ color, roughness: 0.7 }),
    );
    m.position.copy(pos);
    m.castShadow = true;
    m.receiveShadow = true;
    g.add(m);
    return m;
  };
  const cyl = (r: number, h: number, pos: THREE.Vector3, color: number) => {
    const m = new THREE.Mesh(
      new THREE.CylinderGeometry(r, r, h, 16),
      new THREE.MeshStandardMaterial({ color, roughness: 0.7 }),
    );
    m.position.copy(pos);
    m.castShadow = true;
    g.add(m);
    return m;
  };

  if (fieldId === 'powerup-2018') {
    // Scales (tall balanced platforms, one per alliance) + switches (low).
    for (const [fx, color] of [[2.8, BLUE], [13.7, RED]] as const) {
      cyl(0.12, 1.75, P(fx, 4.11, 0.875), GRAY);
      box(0.3, 0.3, 3.2, P(fx, 4.11, 1.75), color);
      box(1.4, 0.1, 0.9, P(fx, 4.11, 1.9), color);
    }
    for (const [fx, color] of [[5.9, BLUE], [10.6, RED]] as const) {
      box(1.5, 0.35, 3.0, P(fx, 4.11, 0.175), color);
      box(0.25, 0.55, 3.0, P(fx, 4.11, 0.55), WOOD);
    }
    // Power cube piles flanking the scale zone.
    for (const fy of [1.6, 6.6]) {
      for (let i = 0; i < 3; i++) box(0.32, 0.32, 0.32, P(4.4 + i * 0.36, fy, 0.16), 0xd8c040);
    }
    return g;
  }
  if (fieldId === 'deepspace-2019') {
    // Cargo ships along both long sides.
    for (const fy of [1.15, 7.05]) {
      box(5.4, 1.3, 1.25, P(8.23, fy, 0.65), WOOD);
      box(5.4, 0.55, 1.35, P(8.23, fy, 1.55), GRAY);
    }
    // Rockets (angled towers) near each short end. The lean sign follows the
    // frame's X reflection, so the towers tip away from their own wall.
    for (const [fx, color] of [[2.3, BLUE], [14.1, RED]] as const) {
      for (const fy of [2.2, 6.0]) {
        box(1.4, 0.15, 1.4, P(fx, fy, 0.35), color);
        const tower = box(1.1, 2.6, 0.18, P(fx + 0.25, fy, 1.65), color);
        tower.rotation.z = 0.28;
      }
    }
    // HAB climb platforms against the short walls.
    for (const [fx, color] of [[0.75, BLUE], [15.7, RED]] as const) {
      box(1.2, 0.18, 5.0, P(fx, 4.11, 0.09), color);
      const ramp = box(1.4, 0.16, 2.6, P(fx + 1.1, 4.11, 0.22), color);
      ramp.rotation.z = -0.17;
    }
    return g;
  }
  if (fieldId === 'infinitercharge-2020') {
    // Control panel at center.
    cyl(0.14, 0.5, P(8.23, 4.11, 0.25), GRAY);
    cyl(0.5, 0.08, P(8.23, 4.11, 0.54), 0xd04040);
    // Trench barriers along both long sides.
    for (const fy of [1.55, 6.65]) box(6.5, 0.65, 0.16, P(8.23, fy, 0.325), GRAY);
    // Sector targets (hex-ish towers) against each short wall + climb bars.
    for (const [fx, color] of [[0.6, BLUE], [15.85, RED]] as const) {
      box(0.5, 2.2, 3.4, P(fx, 4.11, 1.1), color);
      cyl(0.06, 3.6, P(fx + 1.3, 4.11, 2.3), GRAY).rotation.z = Math.PI / 2;
    }
    return g;
  }
  return null;
}
