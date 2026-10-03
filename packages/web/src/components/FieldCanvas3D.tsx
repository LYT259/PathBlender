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
import {
  chassisModules,
  moduleBaseYaw,
  moduleSteeringAngles,
  robotVisualGeometry,
  samplePoseAt,
  sampleStateAt,
} from '@pathblender/core';
import { createGroundTrail } from '../ground-trail3d';
import { buildChassis3D, validateModuleTemplate } from '../chassis3d';
import { useI18n } from '../i18n';
import { useTheme } from '../theme';
import { useMouseControls } from '../mouse-controls';
import {
  chaseStep,
  markGestureEnd,
  markGestureStart,
  orbitZoomSpeedFor,
  pinchZoomFactor,
  splitInstant,
  wheelSuppressed,
  wheelZoomFactor,
} from '../zoom';
import { aprilTagTexture } from '../april-tag-texture';
// One coordinate frame for the whole scene — tags, robots, trails, fallback
// structures, the flat field image and the official field models all map
// through these, so no layer can drift into a mirrored copy of another.
// Derivation and the numeric per-tag checks live in `../field3d-frame` +
// test/field3d-frame.test.ts + test/field3d-model.test.ts.
import {
  FIELD3D_MODELS,
  fieldModelScale,
  fieldRenderBounds,
  headingToRender,
  modelTagLayout,
  snapTagQuadsToDecalPlates,
  tagRenderPose,
  worldToRender,
  worldToRenderVec3,
} from '../field3d-frame';
import type { FieldModelMirror } from '../field3d-frame';

export interface FieldCanvas3DHandle {
  resetCam: () => void;
}

interface Props {
  field: FieldPackage;
  fieldImageUrl?: string;
  robots: SessionTrajectory[];
  currentT: number;
  showTrail?: boolean;
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
  trails: ReturnType<typeof createGroundTrail>[];
  /** Procedural MK5i-style chassis rigs, one per robot. */
  rigs: {
    root: THREE.Group;
    robot: SessionTrajectory;
    pods: THREE.Group[];
    /** Last applied steering angle per pod (radians, robot frame). */
    steer: number[];
    modules: { x: number; y: number }[];
  }[];
  /** Render-on-demand: a frame is drawn only when something changed. */
  dirty: () => void;
  /** Official 3D field model (when available); replaces the fallback. */
  modelRoot: THREE.Group;
  /** Field id of the model currently inside `modelRoot` (undefined = none).
   *  A variant switch within one season keeps the outgoing model mounted
   *  while the sibling streams in, so the view never drops to the flat
   *  fallback (the "black blink" between AndyMark ↔ welded, user report
   *  2026-10-01). */
  modelFieldId?: string;
  /** Hand-built slab/walls/beacons — visible only without a model. */
  fallback: THREE.Group;
  /** Per-field rebuilt subtree (slab/walls/tags/structures). */
  fieldRoot: THREE.Group;
  /** The bootstrap's background entry — always leads the themed list. */
  backgroundThemed: { color: THREE.Color; token: string };
  /** Theme-token colors with live refs, retinted when the theme flips. */
  themed: { color: THREE.Color; token: string }[];
}

// AS-style overview: higher and further back than the early low angle,
// which read as a tilted slab (strong perspective) rather than a field.
const CAM_HOME: [number, number, number] = [0, 13.5, 10.5];

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

/**
 * Parsed-and-processed official models, keyed by asset dir. The processed
 * group (mirror mount + material tuning applied) is cached; mounts receive
 * `.clone(true)` — geometry and materials stay shared with the cache, which
 * is what makes a revisit instant (GPU buffers are reused, no re-parse).
 * A modest cap keeps long roaming sessions from hoarding every season.
 */
const modelCache = new Map<string, THREE.Group>();
const MODEL_CACHE_CAP = 6;
const inflightModels = new Map<string, Promise<THREE.Group | null>>();
let lastModelDir: string | undefined;

/**
 * The official MK5i CAD module (scripts/cad/README.md) — loaded once per
 * page, cloned per swerve pod. Resolves null when the asset is missing
 * or fails its height sanity check, and every rig then keeps the
 * procedural module renderer. Same lifetime rule as the field models:
 * the parsed template is never disposed (the app has exactly one).
 */
let mk5iTemplatePromise: Promise<THREE.Group | null> | undefined;
let mk5iFramePromise: Promise<THREE.Group | null> | undefined;
function loadMk5iFrame(): Promise<THREE.Group | null> {
  if (mk5iFramePromise) return mk5iFramePromise;
  mk5iFramePromise = new Promise((resolve) => {
    new GLTFLoader().load(
      `${import.meta.env.BASE_URL}models/mk5i-frame.glb`,
      (gltf) => {
        const g = gltf.scene;
        g.traverse((o) => {
          const mesh = o as THREE.Mesh;
          if (!mesh.isMesh) return;
          mesh.castShadow = false;
        });
        // Sanity gate: the shipped frame is 27x27 in (0.6858 m) square.
        // Reject anything that is not plan-square within tolerance so a
        // bad asset falls back to "no frame" instead of mis-rendering.
        const box = new THREE.Box3().setFromObject(g);
        const sx = box.max.x - box.min.x;
        const sz = box.max.z - box.min.z;
        const ok =
          Math.abs(sx - 0.6858) < 0.01 &&
          Math.abs(sz - 0.6858) < 0.01 &&
          Math.abs(sx - sz) < 0.005;
        if (!ok) {
          console.warn(
            `mk5i frame template rejected: plan ${sx.toFixed(3)}x${sz.toFixed(3)} m (expected ~0.6858 square)`,
          );
          resolve(null);
          return;
        }
        resolve(g);
      },
      undefined,
      () => resolve(null),
    );
  });
  return mk5iFramePromise;
}

function loadMk5iTemplate(): Promise<THREE.Group | null> {
  if (mk5iTemplatePromise) return mk5iTemplatePromise;
  mk5iTemplatePromise = new Promise((resolve) => {
    new GLTFLoader().load(
      `${import.meta.env.BASE_URL}models/mk5i-module.glb`,
      (gltf) => {
        const g = gltf.scene;
        // NO mount mirror here. The earlier scale(1,1,-1) "handedness
        // correction" (PR #74) actually flipped the module upside down —
        // its origin is ON the floor, so the body went below the carpet
        // (user demonstrated the flip on the comparison sheet 2026-10-02:
        // the mirrored renders showed motors-and-wheel from below). The
        // field models' mirror comes from their AdvantageScope authoring
        // convention, not from this scene.
        g.traverse((o) => {
          const mesh = o as THREE.Mesh;
          if (!mesh.isMesh) return;
          // Same shadow policy as the heavy field models: robots keep the
          // cheap procedural shadows, the detailed instanced meshes stay
          // out of the second render pass.
          mesh.castShadow = false;
        });
        resolve(validateModuleTemplate(g));
      },
      undefined,
      () => resolve(null),
    );
  });
  return mk5iTemplatePromise;
}

/** Asset dir → mount mirror (both variants of a season share one). */
const DIR_MIRROR = new Map<string, FieldModelMirror>(
  Object.values(FIELD3D_MODELS).flatMap((e) => [
    [e.welded, e.mirror] as const,
    ...(e.andymark ? ([[e.andymark, e.mirror]] as const) : []),
  ]),
);

function loadProcessedModel(dir: string): Promise<THREE.Group | null> {
  const hit = inflightModels.get(dir);
  if (hit) return hit;
  const p = new Promise<THREE.Group | null>((resolve) => {
    new GLTFLoader().load(
      `${import.meta.env.BASE_URL}fields3d/${dir}/model.glb`,
      (gltf) => {
        // Mount: one axis reflection, derived from the config.json shipped
        // with the asset (see field3d-frame's model-placement block for the
        // derivation and the per-tag registration numbers — every decal in
        // the 2024–2026 models lands within ~1 cm of the WPILib layout).
        // The old Ry(180°)+offset here was fitted to the retired Onshape
        // model and missed by up to 16.8 m on these assets.
        const g = gltf.scene;
        g.scale.copy(fieldModelScale(DIR_MIRROR.get(dir) ?? 'z'));
        g.traverse((o) => {
          const mesh = o as THREE.Mesh;
          if (!mesh.isMesh) return;
          // Heavy model stays OUT of the shadow pass (a full second render
          // of ~1M triangles froze the main thread); the catcher floor
          // below still receives the robots' shadows cheaply.
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
        modelCache.set(dir, g);
        while (modelCache.size > MODEL_CACHE_CAP) {
          const oldest = modelCache.keys().next().value as string;
          modelCache.delete(oldest);
        }
        resolve(g.clone(true));
      },
      undefined,
      () => resolve(null),
    );
  }).finally(() => inflightModels.delete(dir));
  inflightModels.set(dir, p);
  return p;
}

export const FieldCanvas3D = forwardRef<FieldCanvas3DHandle, Props>(function FieldCanvas3D(
  { field, fieldImageUrl, robots, currentT, showTrail = true, variant = 'welded' },
  ref,
) {
  const hostRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<Scene3D | null>(null);
  // Mouse scheme (Onshape/SolidWorks button map) — read at pointer-event
  // time through a ref so the scaffold effect's closures stay current.
  const [mouseScheme, setMouseScheme] = useMouseControls();
  const mouseSchemeRef = useRef(mouseScheme);
  useEffect(() => { mouseSchemeRef.current = mouseScheme; }, [mouseScheme]);
  // Scaffold-effect chase cancel hook: Fit/resetCam repositions the camera
  // wholesale, so a mid-flight pinch chase must not keep zooming after it.
  const pinchChaseRef = useRef<{ cancel: () => void } | null>(null);
  const { t } = useI18n();
  // Environments without WebGL (jsdom, locked-down webviews) fall back to a
  // quiet empty pane instead of crashing the app.
  const [glFailed, setGlFailed] = useState(false);
  // Official MK5i CAD module (null = not yet loaded / fell back) — the
  // rig-build effect re-runs when it arrives so existing views upgrade.
  const [moduleTemplate, setModuleTemplate] = useState<THREE.Group | null>(null);
  const [frameTemplate, setFrameTemplate] = useState<THREE.Group | null>(null);
  useEffect(() => {
    void loadMk5iTemplate().then(setModuleTemplate);
    void loadMk5iFrame().then(setFrameTemplate);
  }, []);

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
    const backgroundThemed = { color: scene.background as THREE.Color, token: '--canvas-bg' };
    themed.push(backgroundThemed);
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
    // Dolly range (user round 9): 1 m lets a bumper fill the view (was 2 m —
    // "can't zoom in particularly large"); 32 m keeps the field spanning
    // most of the view from the home distance (~17 m) — the old 60 m let it
    // shrink to a corner, which the user explicitly did not want.
    controls.minDistance = 1;
    controls.maxDistance = 32;
    // Onshape-style wheel zoom (user request 2026-10-02): dollies down the
    // pointer ray, so zooming in magnifies the detail under the cursor and
    // zooming out lets the scene flow away from it.
    controls.zoomToCursor = true;
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
    // Scheme routing (user request 2026-10-02, Onshape-style setting):
    // onshape — left = orbit; solidworks — middle = orbit, Ctrl+middle =
    // pan. Shift/Ctrl+left stays OrbitControls pan in both schemes.
    const pan = { active: false, x: 0, y: 0 };
    const onDragDown = (e: PointerEvent) => {
      const scheme = mouseSchemeRef.current;
      const orbitButton = scheme === 'solidworks' ? 1 : 0;
      if (e.shiftKey) return; // Shift+left = pan (controls)
      if (e.button === orbitButton && !e.ctrlKey) {
        e.preventDefault(); // middle: no autoscroll cursor
        drag.active = true;
        noteInteraction();
        drag.x = e.clientX;
        drag.y = e.clientY;
        drag.vTheta = 0;
        drag.vPhi = 0;
        drag.lastT = performance.now();
        renderer.domElement.setPointerCapture(e.pointerId);
      } else if (scheme === 'solidworks' && e.button === 1 && e.ctrlKey) {
        e.preventDefault();
        pan.active = true;
        noteInteraction();
        pan.x = e.clientX;
        pan.y = e.clientY;
        renderer.domElement.setPointerCapture(e.pointerId);
      }
    };
    const onPanMove = (e: PointerEvent) => {
      if (!pan.active) return;
      controls.pan(e.clientX - pan.x, e.clientY - pan.y);
      pan.x = e.clientX;
      pan.y = e.clientY;
      markDirty();
    };
    const onPanUp = (e: PointerEvent) => {
      if (!pan.active) return;
      pan.active = false;
      renderer.domElement.releasePointerCapture(e.pointerId);
    };
    const onDragMove = (e: PointerEvent) => {
      if (!drag.active) return;
      const ROT = 0.0052; // rad per px — the flat-field-era sensitivity
      const dTheta = (e.clientX - drag.x) * ROT;
      const dPhi = (e.clientY - drag.y) * ROT; // drag down → phi shrinks → camera rises
      drag.x = e.clientX;
      drag.y = e.clientY;
      noteInteraction();
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
    renderer.domElement.addEventListener('pointermove', onPanMove);
    renderer.domElement.addEventListener('pointerup', onDragUp);
    renderer.domElement.addEventListener('pointercancel', onDragUp);
    renderer.domElement.addEventListener('pointerup', onPanUp);
    renderer.domElement.addEventListener('pointercancel', onPanUp);

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

    // Route vertical wheel zoom through the shared device-aware curve
    // (mouse notches keep a stepped feel; trackpad scrolls/deltas are
    // continuous with a per-event cap — user request 2026-10-02).
    // OrbitControls applies exp(-K·zoomSpeed·|δ|) per event, so we set
    // zoomSpeed per event to reproduce our factor exactly and keep its
    // damping, distance clamps and zoom-to-cursor. Capture phase on the
    // host: OrbitControls' own wheel listener sits on the canvas (target
    // phase, registration order) and must see the adjusted speed. The same
    // capture position lets us swallow the lift-drift scroll burst after a
    // pinch (round 4): stopping propagation keeps OrbitControls (and the
    // horizontal-rotate handler) from acting on it, freezing the view at
    // the release-moment zoom.
    const onWheelZoomSpeed = (e: WheelEvent) => {
      if (wheelSuppressed()) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      controls.zoomSpeed = orbitZoomSpeedFor(wheelZoomFactor(e.deltaY, e.deltaMode), e.deltaY);
    };
    host.addEventListener('wheel', onWheelZoomSpeed, { capture: true });

    // Render on demand (declared early — Scene3D.dirty exposes it).
    let needsDraw = true;
    const markDirty = () => {
      needsDraw = true;
    };

    // AdvantageScope's lighting recipe: no tone mapping, no environment
    // map, no fog — a hemisphere fill plus one shadow-casting key light.
    // (The earlier ACES+studio-env stack overexposed the official models.)
    // Intensities are π-scaled: three ≥r155 runs physical light units
    // (useLegacyLights removed in r165), and the recipe's raw values
    // (0.6 / 1.1) predate that switch — unscaled they left every lit mesh
    // (robots, path tubes) rendering black on the unlit field model
    // (user report 2026-10-02; verified via readPixels: ×π restores them).
    scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 0.6 * Math.PI));
    const sun = new THREE.DirectionalLight(0xffffff, 1.1 * Math.PI);
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

    // Persistent containers, created once: the field effect below clears
    // and refills them on every season switch, and the tube/box effect owns
    // `dynamic`. The scaffold (camera included) outlives all of them.
    const dynamic = new THREE.Group();
    dynamic.name = 'pb-dynamic'; // reachable by the regression walkthrough
    const modelRoot = new THREE.Group();
    const fallback = new THREE.Group();
    const fieldRoot = new THREE.Group();
    scene.add(dynamic, modelRoot, fallback, fieldRoot);
    sceneRef.current = {
      renderer, scene, camera, controls,
      cx: 0, cy: 0,
      dynamic, rigs: [], trails: [],
      modelRoot, fallback, fieldRoot,
      backgroundThemed,
      dirty: markDirty, themed,
    };



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
    // zoom toward the gesture centroid so the detail under the fingers is
    // what magnifies (user feedback round 2: pinch only ever magnified the
    // orbit center), with the ratio softened via pinchZoomFactor. Events
    // after gestureend are ignored (user round 3: lagging events flushed
    // at finger lift kept zooming after release).
    // Round 5: events only move a chase target (remaining view-zoom factor
    // + anchor NDC); the rAF loop applies it in exponential steps via the
    // OrbitControls cursor-zoom internals, so batched gesture events read
    // as fluid motion instead of steps.
    let lastScale = 1;
    let gestureDone = false;
    const pinchChase = { factor: 1, nx: 0, ny: 0 };
    pinchChaseRef.current = { cancel: () => { pinchChase.factor = 1; } };
    const gestureScale = (e: Event) => (e as Event & { scale?: number }).scale ?? 1;
    const onGestureStart = (e: Event) => {
      lastScale = gestureScale(e);
      gestureDone = false;
      markGestureStart();
      noteInteraction();
    };
    const onGestureChange = (e: Event) => {
      e.preventDefault();
      if (gestureDone) return; // stray post-end flush
      const s = gestureScale(e);
      if (s > 0 && lastScale > 0 && s !== lastScale) {
        const factor = pinchZoomFactor(s / lastScale);
        if (factor !== 1) {
          const g = e as Event & { clientX?: number; clientY?: number };
          const rect = renderer.domElement.getBoundingClientRect();
          pinchChase.nx = (((g.clientX ?? rect.left + rect.width / 2) - rect.left) / rect.width) * 2 - 1;
          pinchChase.ny = -((((g.clientY ?? rect.top + rect.height / 2) - rect.top) / rect.height) * 2 - 1);
          // Round 7 ("takes too long to show"): apply half of every event
          // immediately, chase only the rest — instant response with a
          // short glide tail instead of a slow ramp.
          const { instant, deferred } = splitInstant(factor);
          applyPinchStep(instant);
          pinchChase.factor *= deferred; // remaining view zoom to apply
          noteInteraction();
          markDirty();
        }
      }
      lastScale = s;
    };
    const onGestureEnd = (e: Event) => {
      gestureDone = true;
      markGestureEnd();
      lastScale = 1;
    };
    renderer.domElement.addEventListener('gesturestart', onGestureStart);
    renderer.domElement.addEventListener('gesturechange', onGestureChange);
    renderer.domElement.addEventListener('gestureend', onGestureEnd);

    // Apply one exponential step of the pinch chase (zoom.ts chaseStep) by
    // mirroring OrbitControls' own wheel-zoom path: aim the dolly at the
    // gesture centroid, then let the loop's update() apply damping,
    // distance clamps and target placement exactly like a wheel notch at
    // that point. three is pinned (0.185.x); if the internals ever rename,
    // the fallback dollies toward the orbit target instead.
    const oc = controls as unknown as {
      _mouse?: THREE.Vector2;
      _dollyDirection?: THREE.Vector3;
      _performCursorZoom?: boolean;
      _scale?: number;
    };
    const applyPinchStep = (step: number) => {
      if (step === 1) return;
      const { nx, ny } = pinchChase;
      if (oc._mouse && oc._dollyDirection && oc._scale !== undefined && oc._performCursorZoom !== undefined) {
        oc._mouse.set(nx, ny);
        oc._dollyDirection.set(nx, ny, 1).unproject(camera).sub(camera.position).normalize();
        oc._performCursorZoom = true;
        oc._scale *= 1 / step; // camera radius moves opposite to view zoom
      } else {
        const dir = camera.position.clone().sub(controls.target).multiplyScalar(1 / step);
        dir.setLength(THREE.MathUtils.clamp(dir.length(), controls.minDistance, controls.maxDistance));
        camera.position.copy(controls.target).add(dir);
        camera.lookAt(controls.target);
      }
    };

    // Adaptive interaction quality (round 5): the official field models
    // (14–20 MB GLB) make full-quality renders hog the main thread, which
    // is what batched the gesture events in the first place. While a pinch
    // or drag runs (plus this linger window), render at pixel ratio 1 with
    // the shadow map frozen; restore full quality once interaction settles.
    const BASE_PIXEL_RATIO = Math.min(window.devicePixelRatio || 1, 1.5);
    const INTERACTIVE_LINGER_MS = 250;
    let interactiveUntil = 0;
    let lowQuality = false;
    const setLowQuality = (on: boolean) => {
      lowQuality = on;
      renderer.setPixelRatio(on ? 1 : BASE_PIXEL_RATIO);
      renderer.shadowMap.autoUpdate = !on;
      if (!on) renderer.shadowMap.needsUpdate = true; // refresh frozen shadows once
    };
    const noteInteraction = () => {
      interactiveUntil = performance.now() + INTERACTIVE_LINGER_MS;
    };
    let lastFrameT = performance.now();

    // Draw only when the camera moved or something was marked dirty —
    // the heavy field model made render-per-frame starve all macrotasks.
    controls.addEventListener('change', markDirty);
    const ro0 = new ResizeObserver(markDirty);
    ro0.observe(host);

    let raf = 0;
    const loop = () => {
      const now = performance.now();
      const dt = now - lastFrameT;
      lastFrameT = now;
      // Pinch chase: step the remaining zoom toward its target this frame.
      if (pinchChase.factor !== 1) {
        const stepped = chaseStep(pinchChase.factor, dt);
        applyPinchStep(stepped.step);
        pinchChase.factor = stepped.remaining;
        markDirty();
      }
      const interacting = now < interactiveUntil || pinchChase.factor !== 1 || drag.active;
      if (interacting !== lowQuality) setLowQuality(interacting);
      const moved = controls.update();
      if (needsDraw || moved) {
        needsDraw = false;
        renderer.render(scene, camera);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    // Test/debug hook: orientation + camera state assertions.
    (window as unknown as { __pb3d?: unknown }).__pb3d = { camera, controls, renderer, scene, modelCacheSize: () => modelCache.size };

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      ro0.disconnect();
      controls.removeEventListener('change', markDirty);
      renderer.domElement.removeEventListener('pointerdown', onDragDown);
      renderer.domElement.removeEventListener('pointermove', onDragMove);
      renderer.domElement.removeEventListener('pointermove', onPanMove);
      renderer.domElement.removeEventListener('pointerup', onDragUp);
      renderer.domElement.removeEventListener('pointercancel', onDragUp);
      renderer.domElement.removeEventListener('pointerup', onPanUp);
      renderer.domElement.removeEventListener('pointercancel', onPanUp);
      renderer.domElement.removeEventListener('wheel', onWheelX);
      host.removeEventListener('wheel', onWheelZoomSpeed, { capture: true });
      renderer.domElement.removeEventListener('gesturestart', onGestureStart);
      renderer.domElement.removeEventListener('gesturechange', onGestureChange);
      renderer.domElement.removeEventListener('gestureend', onGestureEnd);
      controls.dispose();
      renderer.dispose();
      if (renderer.domElement.parentElement === host) host.removeChild(renderer.domElement);
      sceneRef.current = null;
    };
  }, []);

  // Non-orbit button map per scheme (Onshape-style setting, user request
  // 2026-10-02): onshape — middle = pan, right = drag-zoom; solidworks —
  // middle is the custom orbit/Ctrl+pan above, so OrbitControls stays off
  // for middle/right. LEFT: ROTATE is inert with enableRotate off, except
  // its Shift/Ctrl pan branch, which both schemes keep.
  useEffect(() => {
    const st = sceneRef.current;
    if (!st) return;
    const NONE = -1 as unknown as THREE.MOUSE;
    st.controls.mouseButtons = mouseScheme === 'solidworks'
      ? { LEFT: THREE.MOUSE.ROTATE, MIDDLE: NONE, RIGHT: NONE }
      : { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.DOLLY };
  }, [mouseScheme]);

  // ---- Field-dependent subtree: slab/walls/tags/structures ----------------
  // Rebuilt when the field (or its artwork) changes. The scaffold — and
  // with it the camera — survives, so switching seasons keeps the user's
  // exact viewpoint (user request 2026-09-30).
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
    disposeDeep(st.fieldRoot); // previous field's materials/geometries
    st.fieldRoot.clear();
    // The fallback is rebuilt from scratch below on every switch, but it was
    // never cleared here — each rebuild leaked its slab/walls (geometries,
    // materials and the slab texture) into the group forever (+6 meshes per
    // switch, measured; the leak is invisible only because a mounted model
    // hides it). Slab/walls are created fresh each rebuild, so their maps are
    // safe to dispose (the shared AprilTag textures live in fieldRoot).
    st.fallback.traverse((child) => {
      const mesh = child as THREE.Mesh;
      mesh.geometry?.dispose?.();
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of mats) {
        (m as THREE.MeshStandardMaterial)?.map?.dispose?.();
        m?.dispose?.();
      }
    });
    st.fallback.clear();
    // The mounted model is NOT cleared: within one season (variant switch)
    // it stays on screen while the sibling model streams in — the flat
    // fallback only covers the window when nothing is mounted. The model
    // effect swaps/replaces it on arrival.
    const { scene, fallback, fieldRoot } = st;
    const themed: { color: THREE.Color; token: string }[] = [];
    const track = <T extends { color: THREE.Color }>(owner: T, token: string): T => {
      themed.push({ color: owner.color, token });
      return owner;
    };

    const { cx, cy, width: w, depth: h } = fieldRenderBounds(field);


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
    // own normal until the model lands and seats it on its decal plate
    // (`snapTagQuadsToDecalPlates`). The list comes from `modelTagLayout`:
    // the selected variant's tags when a model of that build ships, else
    // the loaded model's own build (2026 AndyMark coordinates are
    // physically inside the welded-only model's hub panels — see
    // field3d-frame).
    for (const tag of modelTagLayout(field, variant)) {
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
      fieldRoot.add(quad);
    }

    // Model-less seasons (2018–2020, custom fields) never enter this view —
    // the 3D option is disabled without an official model (user directive
    // 2026-10-01) — so no hand-built season silhouettes here anymore. The
    // slab/walls/outline below still serve as the loading and offline
    // placeholder for model seasons.
    // The flat fallback covers only the "nothing is mounted" window (first
    // entry / season switch). On a variant switch the previous model of the
    // SAME season stays on screen until the sibling arrives — showing the
    // dark flat slab there was the "black blink" between variants (user
    // report 2026-10-01; the 2025 sibling GLB is ~14 MB and its artwork
    // differs, so the window also had to decode an unloaded texture = a
    // near-black frame in dark theme).
    fallback.visible = st.modelRoot.children.length === 0;


    st.cx = cx;
    st.cy = cy;
    st.themed.length = 0;
    st.themed.push(st.backgroundThemed, ...themed);
    st.dirty();

    return () => {
      disposeDeep(st.fieldRoot);
      st.fieldRoot.clear();
      // modelRoot is deliberately left alone here (this cleanup also runs on
      // every variant flip): the mounted model is the visual bridge until
      // the model effect swaps it. Clearing it here was the black blink.
    };
    // `variant` is explicit: the tag list comes from modelTagLayout(field,
    // variant), which can change even when the field object does not.
  }, [field, fieldImageUrl, variant]);

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
  // hand-built fallback. Parsed models are cached module-level (processed
  // once, cloned per mount) so revisiting a season is instant, and clones
  // share geometry/materials with the cache — never dispose them here.
  useEffect(() => {
    const st = sceneRef.current;
    if (!st) return;
    const entry = FIELD3D_MODELS[field.id];
    const dir =
      entry && (variant === 'andymark' ? entry.andymark ?? entry.welded : entry.welded);
    if (!dir) return; // no official model (2018–2020) — fallback stays visible
    const prevDir = lastModelDir;
    lastModelDir = dir;
    let disposed = false;

    // Cross-SEASON switches replace what is mounted (the previous field's
    // model would mislead while the next one streams in — the flat fallback
    // covers that window, as before). Within one season (variant switch)
    // the outgoing model stays on screen until the sibling arrives, so the
    // view never drops to the dark flat slab (the "black blink").
    if (st.modelFieldId !== undefined && st.modelFieldId !== field.id) {
      st.modelRoot.clear(); // clones share cache geometry — never disposed
      st.modelFieldId = undefined;
      // The field effect already computed `fallback.visible` with the old
      // model still mounted — re-cover the streaming window explicitly.
      st.fallback.visible = true;
      st.dirty();
    }

    const mount = (g: THREE.Object3D) => {
      // Swap atomically in one tick: the outgoing mount (previous variant of
      // this season, or a stale season's leftover) leaves in the same frame
      // the new one enters. Only the catcher is disposed — it is created
      // per-mount; the outgoing CLONE shares geometry with the module-level
      // cache and must not be disposed (that would corrupt every later
      // clone of that season).
      for (const child of [...st.modelRoot.children]) {
        const mesh = child as THREE.Mesh;
        const mat = mesh.material;
        if (mesh.isMesh && !Array.isArray(mat) && mat?.type === 'ShadowMaterial') {
          mesh.geometry?.dispose?.();
          mat.dispose();
        }
      }
      st.modelRoot.clear();
      // A shadow-catcher under the robots, sized to this field (per-mount:
      // cheap, and field.lengthM differs between seasons).
      const catcher = new THREE.Mesh(
        new THREE.PlaneGeometry(field.lengthM + 2, field.widthM + 2),
        new THREE.ShadowMaterial({ opacity: 0.28 }),
      );
      catcher.rotation.x = -Math.PI / 2;
      catcher.position.y = 0.002;
      catcher.receiveShadow = true;
      st.modelRoot.add(catcher, g);
      st.modelFieldId = field.id;
      // The overlay quads were posed from the layout plane the moment the
      // field subtree built (usable field before the model streams in);
      // now that the real surfaces exist, seat each quad on its tag's own
      // decal plate — the two 2025 models mount plates at different depths
      // off the layout plane, and a layout-plane quad ends up behind the
      // welded plates (dark, shaded) while the AndyMark one shows crisp
      // (user report 2026-10-01). See snapTagQuadsToDecalPlates.
      snapTagQuadsToDecalPlates(st.fieldRoot, g);
      st.fallback.visible = false;
      st.dirty();
    };

    const cached = modelCache.get(dir);
    if (cached) {
      // Instant path: a clone of the already-parsed scene (geometry and
      // materials are shared, so the GPU buffers are reused as-is).
      modelCache.delete(dir);
      modelCache.set(dir, cached); // LRU freshen
      mount(cached.clone(true));
    } else {
      loadProcessedModel(dir).then((g) => {
        if (disposed) return;
        if (!g) {
          // offline/missing model: the flat fallback takes over
          st.modelRoot.clear();
          st.modelFieldId = undefined;
          st.fallback.visible = true;
          st.dirty();
          return;
        }
        mount(g);
      });
    }

    // Idle prefetch of what a season-roaming user is most likely to open
    // next: the sibling construction variant, and the field used before
    // this one (A/B comparisons are the core loop of this app).
    const idle =
      typeof requestIdleCallback === 'function'
        ? requestIdleCallback
        : (cb: () => void) => setTimeout(cb, 600) as unknown as number;
    const cancel =
      typeof cancelIdleCallback === 'function' ? cancelIdleCallback : clearTimeout as (id: number) => void;
    const sibling = entry
      ? variant === 'andymark'
        ? entry.welded
        : entry.andymark ?? entry.welded
      : undefined;
    const idleId = idle(() => {
      for (const d of [sibling, prevDir]) {
        if (d && d !== dir && !modelCache.has(d)) void loadProcessedModel(d).catch(() => undefined);
      }
    });

    return () => {
      disposed = true;
      cancel(idleId);
      // modelRoot is NOT cleared here: on a variant switch the outgoing
      // model stays mounted as the visual bridge until the sibling arrives
      // (mount() swaps atomically); a cross-season switch clears it in the
      // next run's body. Unmounting the view takes the whole scene with it.
    };
  }, [field.id, variant, field.lengthM, field.widthM]);

  // Rebuild ground tape + robot boxes when the robot set changes — AND when
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
    st.rigs = [];
    st.trails = [];
    for (const r of robots) {
      const trail = createGroundTrail(r, st.cx, st.cy);
      st.dynamic.add(trail.mesh);
      st.trails.push(trail);
      // MK5i-style chassis (bumper skirt + frame deck + swerve pods),
      // sized by this robot's season-resolved two-layer geometry; pods use
      // the official CAD module when its template has loaded.
      const vis = robotVisualGeometry(r.trajectory, field.year);
      const modules = chassisModules(r.trajectory, vis.chassis);
      const chassis = buildChassis3D(vis, modules, r.color, moduleTemplate, r.trajectory.teamNumber || undefined, frameTemplate);
      st.dynamic.add(chassis.group);
      st.rigs.push({
        root: chassis.group,
        robot: r,
        pods: chassis.pods,
        // Parked at the installed angle from the chassis CAD; steering
        // replaces it with the absolute motion angle once moving.
        steer: modules.map((m) => moduleBaseYaw(m)),
        modules,
      });
      st.dirty();
    }
  }, [robots, field, moduleTemplate, frameTemplate]);

  useEffect(() => {
    const st = sceneRef.current;
    if (!st) return;
    for (const { mesh, robot } of st.trails) {
      const time = currentT - robot.startDelayS;
      mesh.visible = showTrail && time > (robot.trajectory.samples[0]?.t ?? 0);
      mesh.material.uniforms.cutoff!.value = time;
    }
    st.dirty();
  }, [currentT, showTrail, robots, field, moduleTemplate, frameTemplate]);

  // Drive the chassis rigs along the shared clock: pose from the shared
  // sampler, plus per-pod steering from each wheel's ground velocity
  // (pods hold their last pointing while the robot stands still).
  useEffect(() => {
    const st = sceneRef.current;
    if (!st) return;
    for (const rig of st.rigs) {
      const state = sampleStateAt(rig.robot, currentT);
      const pose = state
        ? { x: state.x, y: state.y, heading: state.heading }
        : samplePoseAt(rig.robot, currentT);
      rig.root.position.copy(worldToRenderVec3(pose.x, pose.y, 0, st.cx, st.cy));
      // The render frame reflects X, so the heading reflects with it —
      // leaving it raw would have every robot drive sideways.
      rig.root.rotation.y = headingToRender(pose.heading);
      if (state) {
        const angles = moduleSteeringAngles(state, rig.modules);
        if (rig.steer.length !== angles.length) rig.steer = rig.modules.map(() => 0);
        for (let i = 0; i < rig.pods.length; i++) {
          const a = angles[i]!;
          if (a !== null) rig.steer[i] = a;
          // steer[] IS the absolute wheel angle in robot frame (the
          // installed base yaw only seeds it while parked); robot-frame
          // yaw maps to render yaw with the opposite sign.
          rig.pods[i]!.rotation.y = -rig.steer[i]!;
        }
      }
      st.dirty();
    }
    // `moduleTemplate` matters here too: when the CAD template resolves it
    // rebuilds every rig at the origin — without re-driving the poses the
    // fresh rigs stay buried under the field slab (robots vanish, user
    // report 2026-10-02).
  }, [currentT, robots, field, moduleTemplate]);

  useImperativeHandle(ref, () => ({
    // Fit the whole field into the vertical field of view from the current
    // viewing direction — the toolbar's Fit action. It deliberately keeps the
    // direction the user orbited to, so it does NOT restore the load-time
    // camera (CAM_HOME sits closer, at |CAM_HOME| ≈ 17.1 m).
    resetCam: () => {
      const st = sceneRef.current;
      if (!st) return;
      pinchChaseRef.current?.cancel();
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
