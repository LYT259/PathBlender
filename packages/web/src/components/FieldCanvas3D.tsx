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
import { createViewcubeAppearance, viewcubeDirectionAt, viewcubeFlyAzimuth, VIEWCUBE_LABEL_KEYS } from '../viewcube-appearance';
import type { CubeDirection } from '../viewcube-appearance';
import type { FieldPackage, SessionTrajectory } from '@pathblender/core';
import {
  groupedActionsAt,
  chassisModules,
  robotVisualGeometry,
  samplePoseAt,
  sampleStateAt,
} from '@pathblender/core';
import { createGroundTrail, createGroundHeatmap } from '../ground-trail3d';
import { bumperColor, heatmapColor, robotAnnotation } from '../robot-identity';
import { buildChassis3D, validateModuleTemplate } from '../chassis3d';
import { useI18n } from '../i18n';
import { RobotLabels3D, type RobotLabels3DHandle } from './RobotLabels3D';
import { projectLabelAnchor, projectedRadiusPx } from '../robot-label-projection';
import { useTheme } from '../theme';
import {
  resolveMouseAction,
  useCustomMouseControls,
  useDefaultConstrained,
  useMouseControls,
  usePenAsMouse,
} from '../mouse-controls';
import {
  chaseStep,
  markGestureEnd,
  markGestureStart,
  classifyWheelInput,
  orbitZoomSpeedFor,
  pinchZoomFactor,
  reverseScrollZoomEnabled,
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
import { CAM_HOME as FIELD3D_CAM_HOME } from '../field3d-models';
import type { FieldModelMirror } from '../field3d-frame';

export interface FieldCanvas3DHandle {
  resetCam: () => void;
}

interface Props {
  field: FieldPackage;
  fieldImageUrl?: string;
  robots: SessionTrajectory[];
  /** Robot (trajectory) ids whose path renders gray — illegal start zone
   * verdicts (user 2026-10-09). */
  dimPathIds?: ReadonlySet<string>;
  currentT: number;
  showTrail?: boolean;
  /** Occupancy heatmap over every robot's full timeline (§7.3-3). */
  showHeatmap?: boolean;
  /** Field construction variant (AndyMark vs welded), when offered. */
  variant?: 'welded' | 'andymark';
  /**
   * False while the parent keeps this canvas mounted but hidden (2D active).
   * The rAF loop keeps ticking but skips all GPU work, so 2D playback never
   * renders into the hidden buffer — yet the scene, models and camera
   * survive, making the next 2D→3D switch instant (user request 2026-10-06).
   */
  active?: boolean;
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
  heatmaps: ReturnType<typeof createGroundHeatmap>[];
  /** Procedural MK5i-style chassis rigs, one per robot. */
  rigs: {
    root: THREE.Group;
    robot: SessionTrajectory;
    pods: THREE.Group[];
    /** Steering pivots, one per module: the turret sub-group for the
     *  split GLB (the box stays frozen at the installed yaw), the pod
     *  itself for the old GLB / procedural fallback. */
    turrets: THREE.Group[];
    modules: { x: number; y: number }[];
    /** Footprint center in the chassis frame, projected into the DOM overlay. */
    labelAnchor: THREE.Vector3;
    /** Half the bumper diagonal: the body's keep-clear sphere for the label layer. */
    labelRadiusM: number;
  }[];
  /** Render-on-demand: a frame is drawn only when something changed. */
  dirty: () => void;
  /** Drop an in-flight ViewCube fly-to. A wholesale camera move (Fit / `0`)
   *  must win over the tween, which otherwise keeps writing the camera for
   *  its remaining frames and leaves the reset eaten. */
  cancelFly: () => void;
  /** The scene CONTENT moved (playback steered the rigs, robots changed):
   *  re-bake the shadow map on the next frame. Camera-only motion never
   *  calls this — the shadow map stays cached through orbit/zoom/pan. */
  invalidateShadows: () => void;
  /** One full hidden frame while the canvas is parked (prewarm): compiles
   *  GL programs, uploads buffers and bakes the shadow map so the user's
   *  FIRST 3D click of a session renders instantly. No-op while visible —
   *  the rAF loop draws anyway. Called from the content effects (model
   *  mount, rig rebuild), never from the loop. */
  warmup: () => void;
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
  /** ViewCube face textures bake tokens; regenerate on theme change. */
  retintCube: () => void;
  /** ViewCube face labels are canvas-baked; re-render them on locale change. */
  setCubeLabels: (labels: readonly string[]) => void;
}

// AS-style overview home: direction comes from field3d-models (the
// ViewCube's top–front edge — see that module for the derivation); the
// radius doubles as the zoom clamp (maxDistance below), unchanged since R13.
const CAM_HOME = FIELD3D_CAM_HOME;

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
const FRAME_ASSETS = {
  // The user-built 27 in frame (2026 CAD, ships unscaled) and the 30 in
  // frame (2019-2025 chassis, same construction at the 120-in perimeter
  // size). Season selects the plan size; 2018 was removed (PR #143).
  '27': `${import.meta.env.BASE_URL}models/mk5i-frame.glb`,
  '30': `${import.meta.env.BASE_URL}models/mk5i-frame-30.glb`,
} as const;
export type FrameSize = keyof typeof FRAME_ASSETS;

const framePromises = new Map<FrameSize, Promise<THREE.Group | null>>();

/**
 * Cheap one-shot WebGL probe. With the prewarmed canvas mounting in every
 * session, this component's mount effects run even where 3D can never
 * render (jsdom tests, locked-down webviews) — the GLB prefetches there
 * would be dead network traffic, and jsdom's fetch stub rejects three's
 * AbortSignal with an unhandled rejection. No WebGL → no 3D asset loads.
 */
let webglProbe: boolean | undefined;
function hasWebGL(): boolean {
  if (webglProbe === undefined) {
    try {
      const canvas = document.createElement('canvas');
      const gl = (canvas.getContext('webgl2') ??
        canvas.getContext('webgl')) as WebGLRenderingContext | null;
      webglProbe = !!gl;
      gl?.getExtension('WEBGL_lose_context')?.loseContext();
    } catch {
      webglProbe = false;
    }
  }
  return webglProbe;
}

function loadMk5iFrame(size: FrameSize): Promise<THREE.Group | null> {
  const hit = framePromises.get(size);
  if (hit) return hit;
  const plan = size === '27' ? 0.6858 : 0.762; // 27 / 30 in, meters
  const p = new Promise<THREE.Group | null>((resolve) => {
    new GLTFLoader().load(
      FRAME_ASSETS[size],
      (gltf) => {
        const g = gltf.scene;
        g.traverse((o) => {
          const mesh = o as THREE.Mesh;
          if (!mesh.isMesh) return;
          mesh.castShadow = false;
        });
        // Sanity gate: plan-square within tolerance, at this size.
        const box = new THREE.Box3().setFromObject(g);
        const sx = box.max.x - box.min.x;
        const sz = box.max.z - box.min.z;
        const ok =
          Math.abs(sx - plan) < 0.01 &&
          Math.abs(sz - plan) < 0.01 &&
          Math.abs(sx - sz) < 0.005;
        if (!ok) {
          console.warn(
            `mk5i frame template rejected: plan ${sx.toFixed(3)}x${sz.toFixed(3)} m (expected ~${plan} square)`,
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
  framePromises.set(size, p);
  return p;
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
  { field, fieldImageUrl, robots, currentT, showTrail = true, showHeatmap = false, variant = 'welded', active = true, dimPathIds },
  ref,
) {
  const hostRef = useRef<HTMLDivElement>(null);
  const labelsRef = useRef<RobotLabels3DHandle>(null);
  const sceneRef = useRef<Scene3D | null>(null);
  // Hidden-but-mounted: the scaffold effect's loop reads this ref each frame
  // and skips GPU work while the parent hides the canvas (2D active). On
  // re-activation one dirty frame redraws the full scene immediately.
  const activeRef = useRef(active);
  useEffect(() => {
    activeRef.current = active;
    if (active) sceneRef.current?.dirty();
  }, [active]);
  // Mouse scheme (Onshape/SolidWorks button map) and the three view
  // checkboxes — read at pointer-event time through refs so the scaffold
  // effect's closures stay current. Reverse scroll lives in zoom.ts (the
  // 2D canvas reads the same module flag), set from here on every change.
  const [mouseScheme] = useMouseControls();
  const mouseSchemeRef = useRef(mouseScheme);
  useEffect(() => { mouseSchemeRef.current = mouseScheme; }, [mouseScheme]);
  const [customMouseMap] = useCustomMouseControls();
  const customMouseMapRef = useRef(customMouseMap);
  useEffect(() => { customMouseMapRef.current = customMouseMap; }, [customMouseMap]);
  const [defaultConstrained] = useDefaultConstrained();
  const defaultConstrainedRef = useRef(defaultConstrained);
  useEffect(() => { defaultConstrainedRef.current = defaultConstrained; }, [defaultConstrained]);
  const [penAsMouse] = usePenAsMouse();
  const penAsMouseRef = useRef(penAsMouse);
  useEffect(() => { penAsMouseRef.current = penAsMouse; }, [penAsMouse]);
  // Scaffold-effect chase cancel hook: Fit/resetCam repositions the camera
  // wholesale, so a mid-flight pinch chase must not keep zooming after it.
  const pinchChaseRef = useRef<{ cancel: () => void } | null>(null);
  const { t } = useI18n();
  // Environments without WebGL (jsdom, locked-down webviews) fall back to a
  // localized failure message instead of crashing the app.
  const [glFailed, setGlFailed] = useState(false);
  // Official MK5i CAD module (null = not yet loaded / fell back) — the
  // rig-build effect re-runs when it arrives so existing views upgrade.
  const [moduleTemplate, setModuleTemplate] = useState<THREE.Group | null>(null);
  const [frameTemplates, setFrameTemplates] = useState<Partial<Record<FrameSize, THREE.Group | null>>>({});
  useEffect(() => {
    if (!hasWebGL()) return; // no 3D rendering possible — keep the GLBs on disk
    void loadMk5iTemplate().then(setModuleTemplate);
    for (const size of Object.keys(FRAME_ASSETS) as FrameSize[]) {
      void loadMk5iFrame(size).then((g) =>
        setFrameTemplates((prev) => ({ ...prev, [size]: g })),
      );
    }
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
    renderer.setPixelRatio((window.devicePixelRatio || 1));
    // Soft shadows are the strongest depth cue for the field structures.
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
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
    let retintCube: () => void = () => {};
    let setCubeLabels: (labels: readonly string[]) => void = () => {};
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
    // reachable — leaning well past the far wall (the old 1.62 clamp read
    // as one-sided dragging). Pole epsilons keep lookAt non-degenerate
    // while letting ViewCube Top/Bottom clicks land as true plan views
    // (the previous 0.15/2.6 left them 8.6°/31° askew); flyTo clamps to
    // the same pair. At near-polar angles the camera looks at the field
    // from above/below the slab plane — fine for the thin slab + occluding
    // walls.
    controls.minPolarAngle = 0.02;
    controls.maxPolarAngle = Math.PI - 0.02;
    // Dolly range (user round 11, 2026-10-03): 0.15 m is deep CAD-grade
    // zoom — Onshape lets you zoom until geometry degenerates, and the old
    // 1 m floor still stopped short ("放大的极限还要大得多"). The ceiling
    // is exactly the home distance: pulling back may never show the field
    // smaller than it looks on open ("缩小到刚打开时的样子，不能再小
    // 了"); the old 32 m allowed shrinking it into a corner.
    controls.minDistance = 0.15;
    controls.maxDistance = Math.hypot(CAM_HOME[0], CAM_HOME[1], CAM_HOME[2]);
    // Onshape-style wheel zoom (user request 2026-10-02): dollies down the
    // pointer ray, so zooming in magnifies the detail under the cursor and
    // zooming out lets the scene flow away from it.
    controls.zoomToCursor = true;
    // Drag-orbit (original 3D-mode logic, Onshape-style): cursor down lifts
    // the camera so the field's top tilts into view — the same direction the
    // flat-field build used. Owned here (not OrbitControls) so the glide and
    // clamp share the spherical math with the wheel-deltaX handler.
    controls.enableRotate = false;
    const drag = { active: false, x: 0, y: 0, vTheta: 0, vPhi: 0, lastT: 0, constrained: false };
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
    // Scheme routing (verified against Onshape's settings table 2026-10-03
    // and SOLIDWORKS' view docs 2026-10-04; the pure table lives in
    // mouse-controls.resolveMouseAction):
    //   onshape — right drag = orbit, Alt+right = constrained orbit,
    //             Ctrl+right OR middle = pan, wheel = zoom.
    //   solidworks — middle = orbit, Alt+middle = ROLL (spin in the screen
    //             plane), Ctrl+middle = pan, Shift+middle = drag-zoom,
    //             wheel = zoom.
    //   custom — every drag slot comes from the user's own map (custom
    //             MouseMap); the wheel always stays zoom.
    // Left does nothing by default in every scheme (a viewer has no
    // selection), but custom may assign it.
    const pan = { active: false, x: 0, y: 0 };
    const dragZoom = { active: false, lastY: 0 };
    const roll = { active: false, x: 0 };
    // Roll view (SOLIDWORKS Alt+middle): spin the camera about its own view
    // axis — only the up vector moves, position/target (and therefore
    // OrbitControls' spherical state) stay put. Drag right rolls the field
    // clockwise on screen: the camera up-vector tips the opposite way.
    // OrbitControls caches its up-frame quaternion at construction, so the
    // moving up vector does not disturb damping or the polar clamps.
    const applyRoll = (dx: number) => {
      const axis = controls.target.clone().sub(camera.position).normalize();
      camera.up.applyAxisAngle(axis, -dx * 0.0052);
      camera.lookAt(controls.target);
    };
    const onDragDown = (e: PointerEvent) => {
      // Pen gate: a stylus only drives the view when "use pen as mouse".
      if (e.pointerType === 'pen' && !penAsMouseRef.current) return;
      const action = resolveMouseAction(
        mouseSchemeRef.current, e.button, e, defaultConstrainedRef.current, customMouseMapRef.current,
      );
      if (action.kind === 'none') return;
      e.preventDefault(); // middle: no autoscroll; right: no native menu
      if (action.kind === 'orbit') {
        drag.active = true;
        drag.constrained = action.constrained;
        drag.x = e.clientX;
        drag.y = e.clientY;
        drag.vTheta = 0;
        drag.vPhi = 0;
        drag.lastT = performance.now();
      } else if (action.kind === 'pan') {
        pan.active = true;
        pan.x = e.clientX;
        pan.y = e.clientY;
      } else if (action.kind === 'roll') {
        roll.active = true;
        roll.x = e.clientX;
      } else {
        // dragZoom: aim the dolly at the press point (same NDC anchor the
        // pinch chase uses), then feed vertical drag through applyPinchStep.
        dragZoom.active = true;
        dragZoom.lastY = e.clientY;
        const rect = renderer.domElement.getBoundingClientRect();
        pinchChase.nx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        pinchChase.ny = -(((e.clientY - rect.top) / rect.height) * 2 - 1);
      }
      renderer.domElement.setPointerCapture(e.pointerId);
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
    const onDragZoomMove = (e: PointerEvent) => {
      if (!dragZoom.active) return;
      const dy = e.clientY - dragZoom.lastY;
      dragZoom.lastY = e.clientY;
      if (dy === 0) return;
      // Drag up = zoom in (Onshape/SolidWorks drag-zoom convention).
      // applyPinchStep dollies toward the anchored point through the wheel
      // path's internals, so clamps and damping behave like a wheel notch.
      applyPinchStep(Math.exp(-dy * 0.006));
      markDirty();
    };
    const onDragZoomUp = (e: PointerEvent) => {
      if (!dragZoom.active) return;
      dragZoom.active = false;
      renderer.domElement.releasePointerCapture(e.pointerId);
    };
    const onRollMove = (e: PointerEvent) => {
      if (!roll.active) return;
      const dx = e.clientX - roll.x;
      roll.x = e.clientX;
      if (dx === 0) return;
      applyRoll(dx);
      markDirty();
    };
    const onRollUp = (e: PointerEvent) => {
      if (!roll.active) return;
      roll.active = false;
      renderer.domElement.releasePointerCapture(e.pointerId);
    };
    const onDragMove = (e: PointerEvent) => {
      if (!drag.active) return;
      const ROT = 0.0052; // rad per px — the flat-field-era sensitivity
      const dTheta = (e.clientX - drag.x) * ROT;
      // Constrained rotate (Onshape turntable): azimuth only, no elevation.
      const dPhi = drag.constrained ? 0 : (e.clientY - drag.y) * ROT;
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
    renderer.domElement.addEventListener('pointermove', onPanMove);
    renderer.domElement.addEventListener('pointermove', onDragZoomMove);
    renderer.domElement.addEventListener('pointerup', onDragUp);
    renderer.domElement.addEventListener('pointercancel', onDragUp);
    renderer.domElement.addEventListener('pointerup', onPanUp);
    renderer.domElement.addEventListener('pointercancel', onPanUp);
    renderer.domElement.addEventListener('pointerup', onDragZoomUp);
    renderer.domElement.addEventListener('pointercancel', onDragZoomUp);
    renderer.domElement.addEventListener('pointermove', onRollMove);
    renderer.domElement.addEventListener('pointerup', onRollUp);
    renderer.domElement.addEventListener('pointercancel', onRollUp);

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
    // OrbitControls applies exp(K_OC·zoomSpeed·δY) per event, so we set
    // zoomSpeed per event to reproduce our factor exactly and keep its
    // damping, distance clamps and zoom-to-cursor. Capture phase on the
    // host: OrbitControls' own wheel listener sits on the canvas and must
    // see the adjusted speed; the same position lets us swallow the
    // lift-drift scroll burst after a pinch (round 4).
    // Reverse scroll cannot ride that formula — δY's sign alone picks
    // dolly in/out — so reversed wheel notches take the cursor-aimed
    // applyPinchStep path instead (same internals pinch/drag-zoom use).
    const onWheelZoomSpeed = (e: WheelEvent) => {
      if (wheelSuppressed()) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      const factor = wheelZoomFactor(e.deltaY, e.deltaMode);
      if (factor === 1) return;
      if (classifyWheelInput(e.deltaY, e.deltaMode) === 'wheel' && reverseScrollZoomEnabled()) {
        e.preventDefault();
        e.stopPropagation();
        const rect = renderer.domElement.getBoundingClientRect();
        pinchChase.nx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        pinchChase.ny = -(((e.clientY - rect.top) / rect.height) * 2 - 1);
        applyPinchStep(factor);
        markDirty();
        return;
      }
      controls.zoomSpeed = orbitZoomSpeedFor(factor, e.deltaY);
    };
    host.addEventListener('wheel', onWheelZoomSpeed, { capture: true });

    // Render on demand (declared early — Scene3D.dirty exposes it).
    let needsDraw = true;
    const markDirty = () => {
      needsDraw = true;
    };

    // Content-driven shadow pass (2026-10-04): the shadow map re-renders
    // only when the scene CONTENT changed — camera-only motion (orbit,
    // pinch, wheel, pan) never re-bakes it, which is what the old
    // interaction freeze bought. But that freeze was keyed to TIME, not
    // content: a pinch overlapping playback parked the shadows at the
    // freeze pose while the robots drove on ("the shadow doesn't follow
    // the robot", user 2026-10-04), and its engage/disengage flutter made
    // playback read as janky. Only the robots cast shadows (the heavy
    // field models stay out of the pass), so the rig-driving and
    // robot-rebuild effects call invalidateShadows(); gesture handlers
    // need nothing. The pixel ratio stays at full DPR the whole time
    // (2026-10-04: "keep it razor sharp while I'm still pinching").
    renderer.shadowMap.autoUpdate = false;
    let shadowDirty = true; // the first frame bakes the shadow map
    const invalidateShadows = () => {
      shadowDirty = true;
      markDirty();
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
    sun.shadow.mapSize.set(4096, 4096);
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
    // sceneRef is filled in below, after the draw path exists (warmup is
    // part of Scene3D and needs the ViewCube renderer).
    const dynamic = new THREE.Group();
    dynamic.name = 'pb-dynamic'; // reachable by the regression walkthrough
    const modelRoot = new THREE.Group();
    const fallback = new THREE.Group();
    const fieldRoot = new THREE.Group();
    scene.add(dynamic, modelRoot, fallback, fieldRoot);



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
    // Round 5 pinch chase: events only touch a chase target (remaining
    // view-zoom factor + anchor NDC) that the rAF loop applies in
    // exponential steps via the OrbitControls cursor-zoom internals, so
    // batched gesture events read as fluid motion instead of steps.
    let lastScale = 1;
    let gestureDone = false;
    const pinchChase = { factor: 1, nx: 0, ny: 0 };
    pinchChaseRef.current = { cancel: () => { pinchChase.factor = 1; } };
    const gestureScale = (e: Event) => (e as Event & { scale?: number }).scale ?? 1;
    const onGestureStart = (e: Event) => {
      lastScale = gestureScale(e);
      gestureDone = false;
      markGestureStart();
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
          // Half of every event applies on arrival (round 7; restored
          // 2026-10-03 — full-instant read as steps), the chase loop
          // glides the deferred remainder over ~5τ.
          const { instant, deferred } = splitInstant(factor);
          applyPinchStep(instant);
          pinchChase.factor *= deferred; // remaining view zoom to apply
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

    let lastFrameT = performance.now();

    // Draw only when the camera moved or something was marked dirty —
    // the heavy field model made render-per-frame starve all macrotasks.
    controls.addEventListener('change', markDirty);
    const ro0 = new ResizeObserver(markDirty);
    ro0.observe(host);

    // --- Onshape-style ViewCube (top-right overlay) ---
    // A second renderer mirrors the main camera's orientation. Faces, edges
    // and corners are separate pick targets; each click tweens the camera to
    // the matching view (face → ortho, edge → two-axis, corner → trimetric).
    // The rAF loop below runs unconditionally, so damping and the tween can
    // coexist (the old on-demand loop let the two deadlock); user input
    // cancels a tween mid-flight.
    let tween: { from: THREE.Spherical; to: THREE.Spherical; start: number } | null = null;
    const onUserStart = () => {
      tween = null;
    };
    controls.addEventListener('start', onUserStart);
    const flyTo = (toPos: THREE.Vector3) => {
      const from = new THREE.Spherical().setFromVector3(
        camera.position.clone().sub(controls.target),
      );
      const offset = toPos.clone().sub(controls.target);
      const to = new THREE.Spherical().setFromVector3(offset);
      // Pole targets (Top/Bottom) have no horizontal component, so the
      // spherical theta above collapses to 0 — an arbitrary side of the
      // field. Route every landing through the shared azimuth rule: poles
      // take the home azimuth (blue-left plan view, upright Top glyph),
      // everything else keeps its own atan2.
      to.theta = viewcubeFlyAzimuth([offset.x, offset.y, offset.z]);
      let d = to.theta - from.theta;
      if (d > Math.PI) to.theta -= 2 * Math.PI;
      else if (d < -Math.PI) to.theta += 2 * Math.PI;
      // Keep a hair off the poles (an exactly vertical lookAt with up=+Y is
      // degenerate), but close enough that Top/Bottom land as true plan
      // views — the old 0.15 rad clamp left them 8.6° askew.
      const POLE = 0.02;
      to.phi = THREE.MathUtils.clamp(to.phi, POLE, Math.PI - POLE);
      from.phi = THREE.MathUtils.clamp(from.phi, POLE, Math.PI - POLE);
      tween = { from, to, start: performance.now() };
    };
    const viewcubeEl = document.createElement('div');
    viewcubeEl.className = 'viewcube';
    const cubeCanvas = document.createElement('canvas');
    viewcubeEl.appendChild(cubeCanvas);
    host.appendChild(viewcubeEl);

    const cubeRenderer = new THREE.WebGLRenderer({ canvas: cubeCanvas, alpha: true, antialias: true });
    cubeRenderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 3));
    cubeRenderer.setSize(110, 110);
    const cubeScene = new THREE.Scene();
    const cubeCam = new THREE.PerspectiveCamera(38, 1, 0.1, 20);
    cubeCam.position.set(0, 0, 3.6);
    const cubeGroup = new THREE.Group();
    cubeScene.add(cubeGroup);
    // BoxGeometry material order is +X, −X, +Y, −Y, +Z, −Z. The home camera
    // now sits at −Z (blue-left CAM_HOME, 2026-10-16), so the face a resting
    // user sees straight on is −Z and the one on their screen-right is −X.
    // CAD-cube convention says the resting view faces "Front" with "Right"
    // on the right — so the strings pair swapped axes (left↔right,
    // front↔back) rather than the geometric slot order; a click still flies
    // to the clicked face's own normal, which is what keeps "Front" = the
    // recenter view and "Right" = the view from the home view's right side.
    // Both this bake and the locale repaint below read the SAME exported
    // key list — a second hand-written copy here drifted from the flip and
    // repainted the pre-flip labels over these on mount (2026-10-16).
    const labels = VIEWCUBE_LABEL_KEYS.map((key) => t(key));
    const cubeAppearance = createViewcubeAppearance(labels, cssToken);
    retintCube = cubeAppearance.retint;
    setCubeLabels = cubeAppearance.setLabels;
    cubeGroup.add(cubeAppearance.mesh);

    const ray = new THREE.Raycaster();
    const cubePtr = new THREE.Vector2();
    // Picking raycasts the appearance mesh itself and classifies the hit's
    // UV in the same texture space the regions are painted in — so a
    // region's click boundary is exactly its visible outline (panel inset,
    // edge strips, corner pads). The old flat-box + 0.5·half-size threshold
    // predated the painted layout and misclassified the whole rim band.
    const pick = (ev: PointerEvent): CubeDirection | null => {
      const r = cubeCanvas.getBoundingClientRect();
      cubePtr.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(cubePtr, cubeCam);
      const hit = ray.intersectObject(cubeAppearance.mesh, false)[0];
      if (!hit || !hit.uv || hit.face?.materialIndex === undefined) return null;
      return viewcubeDirectionAt(hit.face.materialIndex, hit.uv.x, hit.uv.y);
    };
    const applyHover = (dir: CubeDirection | null) => {
      cubeAppearance.setHover(dir);
      markDirty();
      cubeCanvas.style.cursor = dir ? 'pointer' : 'default';
    };
    const onCubeDown = (ev: PointerEvent) => {
      ev.stopPropagation();
      const dir = pick(ev);
      if (!dir) return;
      // Test hook: the walkthrough asserts the camera reaches this target.
      (window as unknown as { __pb3d?: { lastPick?: THREE.Vector3 } }).__pb3d!.lastPick =
        new THREE.Vector3(dir[0], dir[1], dir[2]);
      const dist = camera.position.distanceTo(controls.target);
      flyTo(controls.target.clone().add(new THREE.Vector3(dir[0], dir[1], dir[2]).multiplyScalar(dist)));
    };
    const onCubeMove = (ev: PointerEvent) => {
      applyHover(pick(ev));
    };
    // The pointer can leave the canvas between moves (or get interrupted
    // mid-gesture); without this the last region stays lit forever.
    const onCubeLeave = () => {
      applyHover(null);
    };
    cubeCanvas.addEventListener('pointerdown', onCubeDown);
    cubeCanvas.addEventListener('pointermove', onCubeMove);
    cubeCanvas.addEventListener('pointerleave', onCubeLeave);
    cubeCanvas.addEventListener('pointercancel', onCubeLeave);

    // No keyboard scope and no focus ring on the WebGL canvas (user
    // 2026-10-07): clicking the field does nothing, so a box around the
    // whole field read as a broken promise. View keys were canvas-scoped —
    // deleted with the focus entry; scrub (←/→), refit (0) and the 2D/3D
    // toggle (V) remain global, and the ViewCube stays pointer-driven.

    // One full draw of both renderers, shared by the loop and the parked
    // warmup below.
    const drawFrame = () => {
      needsDraw = false;
      renderer.render(scene, camera);
      if (activeRef.current) {
        const viewport = { w: host.clientWidth, h: host.clientHeight };
        const anchors = (sceneRef.current?.rigs ?? []).map((rig) => {
          const world = rig.root.localToWorld(rig.labelAnchor.clone());
          const p = projectLabelAnchor(world, camera, viewport);
          return {
            id: rig.robot.trajectory.id,
            x: p.x, y: p.y, visible: p.visible,
            radius: projectedRadiusPx(world, rig.labelRadiusM, camera, viewport),
          };
        });
        labelsRef.current?.place(anchors, viewport, [{
          x: viewcubeEl.offsetLeft, y: viewcubeEl.offsetTop,
          w: viewcubeEl.offsetWidth, h: viewcubeEl.offsetHeight,
        }]);
      }
      // Mirror the main orientation into the cube and draw it too.
      cubeGroup.quaternion.copy(camera.quaternion).invert();
      cubeRenderer.render(cubeScene, cubeCam);
    };
    // Parked warmup (prewarm): one hidden frame that compiles every GL
    // program, uploads the buffers/textures and bakes the shadow map while
    // the canvas is still display:none — so the FIRST 3D click of a session
    // only has to resize the buffer and draw. Content effects call this as
    // things arrive (model mount, rig rebuild); the loop never does, so
    // parked playback can't turn into continuous hidden rendering.
    const warmup = () => {
      if (activeRef.current) return; // visible — the loop draws anyway
      if (shadowDirty) {
        shadowDirty = false;
        renderer.shadowMap.needsUpdate = true;
      }
      drawFrame();
    };

    let raf = 0;
    const loop = () => {
      const now = performance.now();
      const dt = now - lastFrameT;
      lastFrameT = now;
      // Hidden-but-mounted: skip every frame's GPU work (render, shadow
      // bake, DPR sync) while the 2D view owns the screen. lastFrameT
      // still advances so a pending tween/chase resumes with a sane dt.
      if (!activeRef.current) {
        raf = requestAnimationFrame(loop);
        return;
      }
      // ViewCube tween: ease the camera along the shortest spherical arc.
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
      // Pinch chase: step the remaining zoom toward its target this frame.
      if (pinchChase.factor !== 1) {
        const stepped = chaseStep(pinchChase.factor, dt);
        applyPinchStep(stepped.step);
        pinchChase.factor = stepped.remaining;
        markDirty();
      }
      if (shadowDirty) {
        // Consumed by the render below: the shadow map re-bakes only on
        // frames where the content moved — camera motion alone never does.
        shadowDirty = false;
        renderer.shadowMap.needsUpdate = true;
      }
      const moved = controls.update();
      // DPR can change without a resize (window dragged between Retina and
      // 1x displays) — ResizeObserver misses it, leaving the buffer at the
      // stale density. Re-sync the pixel ratio — ALWAYS the full DPR,
      // gestures included; setPixelRatio re-allocates the buffer.
      const dprWant = window.devicePixelRatio || 1;
      if (renderer.getPixelRatio() !== dprWant) {
        renderer.setPixelRatio(dprWant);
        needsDraw = true;
      }
      const cubeDprWant = Math.min(window.devicePixelRatio || 1, 3);
      if (cubeRenderer.getPixelRatio() !== cubeDprWant) {
        cubeRenderer.setPixelRatio(cubeDprWant);
        needsDraw = true;
      }
      if (needsDraw || moved) drawFrame();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    // Filled in here, after the draw path exists (warmup is part of
    // Scene3D and needs the ViewCube renderer created above).
    sceneRef.current = {
      renderer, scene, camera, controls,
      cx: 0, cy: 0,
      dynamic, rigs: [], trails: [], heatmaps: [],
      modelRoot, fallback, fieldRoot,
      backgroundThemed,
      dirty: markDirty, invalidateShadows, warmup, themed, retintCube, setCubeLabels,
      cancelFly: () => { tween = null; },
    };

    // Test/debug hook: orientation + camera state assertions.
    (window as unknown as { __pb3d?: unknown }).__pb3d = {
      camera, controls, renderer, scene, modelCacheSize: () => modelCache.size,
      cubeHover: cubeAppearance.getHover,
      cubeQuat: () => cubeGroup.quaternion.toArray(),
    };

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      ro0.disconnect();
      controls.removeEventListener('change', markDirty);
      controls.removeEventListener('start', onUserStart);
      cubeCanvas.removeEventListener('pointerdown', onCubeDown);
      cubeCanvas.removeEventListener('pointermove', onCubeMove);
      cubeCanvas.removeEventListener('pointerleave', onCubeLeave);
      cubeCanvas.removeEventListener('pointercancel', onCubeLeave);
      cubeAppearance.dispose();
      cubeRenderer.dispose();
      viewcubeEl.remove();
      renderer.domElement.removeEventListener('pointerdown', onDragDown);
      renderer.domElement.removeEventListener('pointermove', onDragMove);
      renderer.domElement.removeEventListener('pointermove', onPanMove);
      renderer.domElement.removeEventListener('pointerup', onDragUp);
      renderer.domElement.removeEventListener('pointercancel', onDragUp);
      renderer.domElement.removeEventListener('pointerup', onPanUp);
      renderer.domElement.removeEventListener('pointercancel', onPanUp);
      renderer.domElement.removeEventListener('pointermove', onDragZoomMove);
      renderer.domElement.removeEventListener('pointerup', onDragZoomUp);
      renderer.domElement.removeEventListener('pointercancel', onDragZoomUp);
      renderer.domElement.removeEventListener('pointermove', onRollMove);
      renderer.domElement.removeEventListener('pointerup', onRollUp);
      renderer.domElement.removeEventListener('pointercancel', onRollUp);
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

  // All mouse navigation is owned by the scheme-routed handlers above;
  // OrbitControls keeps the wheel dolly and touch gestures only. (The
  // mapping must exist — controls skips buttons it doesn't own.)
  useEffect(() => {
    const st = sceneRef.current;
    if (!st) return;
    const NONE = -1 as unknown as THREE.MOUSE;
    st.controls.mouseButtons = { LEFT: NONE, MIDDLE: NONE, RIGHT: NONE };
  }, []);

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
      tex.anisotropy = st.renderer.capabilities.getMaxAnisotropy();
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
        new THREE.MeshBasicMaterial({ map: aprilTagTexture(tag.id, st.renderer.capabilities.getMaxAnisotropy()), side: THREE.DoubleSide, toneMapped: false }),
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
    for (const { robot, mesh } of st.heatmaps) (mesh.material as THREE.MeshBasicMaterial).color.set(heatmapColor(robot.trajectory.alliance, cssToken('--accent', '#0a84ff'), cssToken('--danger', '#ff453a')));
    st.retintCube();
    st.dirty();
  }, [themeResolved]);

  // ViewCube labels are canvas-baked at scaffold time; re-render them when
  // the display language changes (the scaffold effect runs once, so without
  // this the cube kept the boot locale's words forever). Same exported key
  // list as the bake — the two must never diverge (2026-10-16 drift bug).
  useEffect(() => {
    const st = sceneRef.current;
    if (!st) return;
    st.setCubeLabels(VIEWCUBE_LABEL_KEYS.map((key) => t(key)));
    st.dirty();
  }, [t]);

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
      // Parked canvas: bake the freshly mounted model while hidden, so the
      // first 3D click never pays for its shaders/buffers.
      st.warmup();
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
    st.heatmaps = [];
    for (const r of robots) {
      const trail = createGroundTrail(r, st.cx, st.cy,
        dimPathIds?.has(r.trajectory.id) ? cssToken('--fg-dim', '#9a9aa0') : undefined);
      st.dynamic.add(trail.mesh);
      st.trails.push(trail);
      // Occupancy heatmap — one merged footprint-stain mesh per robot.
      const heatmap = createGroundHeatmap(r, st.cx, st.cy, cssToken('--accent', '#0a84ff'), cssToken('--danger', '#ff453a'));
      st.dynamic.add(heatmap.mesh);
      st.heatmaps.push(heatmap);
      // MK5i-style chassis (bumper skirt + frame deck + swerve pods),
      // sized by this robot's season-resolved two-layer geometry; pods use
      // the official CAD module when its template has loaded.
      const vis = robotVisualGeometry(r.trajectory, field.year);
      const modules = chassisModules(r.trajectory, vis.chassis);
      // 2026 rides the 27 in CAD frame; every other season the 30 in one
      // (2018 is gone). buildChassis3D scales the frame to the robot's
      // chassis rectangle, so file-sized robots still fit exactly.
      const frameSize: FrameSize = field.year === 2026 ? '27' : '30';
      const chassis = buildChassis3D(vis, modules, bumperColor(r.trajectory.alliance), moduleTemplate, robotAnnotation(r.trajectory) || undefined, frameTemplates[frameSize] ?? null, st.renderer.capabilities.getMaxAnisotropy());
      st.dynamic.add(chassis.group);
      st.rigs.push({
        root: chassis.group,
        robot: r,
        pods: chassis.pods,
        turrets: chassis.turrets,
        modules,
        labelAnchor: new THREE.Vector3(vis.outer.offsetX, 0, vis.outer.offsetY),
        labelRadiusM: Math.hypot(vis.outer.lengthM, vis.outer.widthM) / 2,
      });
      st.invalidateShadows();
    }
    // Parked canvas: bake the fresh rigs/trails while hidden — covers the
    // initial prewarm and later CAD-template upgrades alike.
    st.warmup();
  }, [robots, field, moduleTemplate, frameTemplates, dimPathIds]);

  useEffect(() => {
    const st = sceneRef.current;
    if (!st) return;
    // Full-route tape: only the toggle gates visibility, never the clock.
    for (const { mesh } of st.trails) {
      mesh.visible = showTrail;
    }
    // Same for the heatmap stain — the toggle, not the clock, gates it.
    for (const { mesh } of st.heatmaps) {
      mesh.visible = showHeatmap;
    }
    st.dirty();
  }, [showTrail, showHeatmap, robots, field, moduleTemplate, frameTemplates]);

  // Drive the chassis rigs along the shared clock: pose from the shared
  // sampler. Modules stay bolted at the installed angle the whole time --
  // the turret steering animation was removed (user 2026-10-04: with the
  // turret turning, the whole pod looked like it rotated off the frame;
  // re-add later as its own feature).
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
      st.invalidateShadows();
    }
    // `moduleTemplate` matters here too: when the CAD template resolves it
    // rebuilds every rig at the origin — without re-driving the poses the
    // fresh rigs stay buried under the field slab (robots vanish, user
    // report 2026-10-02).
  }, [currentT, robots, field, moduleTemplate, frameTemplates]);

  useImperativeHandle(ref, () => ({
    // The toolbar's Fit action (user 2026-10-03): return the camera to the
    // EXACT open-app state — home position CAM_HOME (|CAM_HOME| ≈ 17.1 m),
    // target back on the field origin — so position, zoom and viewing
    // angle all reset in one click. (It previously kept the direction the
    // user had orbited to and only reframed the distance.)
    resetCam: () => {
      const st = sceneRef.current;
      if (!st) return;
      pinchChaseRef.current?.cancel();
      st.cancelFly();
      st.controls.target.set(0, 0, 0);
      st.camera.position.set(...CAM_HOME);
      st.controls.update();
      st.dirty();
    },
  }));

  if (glFailed) return <div className="field-canvas-3d" role="status">{t('canvas.webglUnavailable')}</div>;
  return <div ref={hostRef} className="field-canvas-3d">
    <RobotLabels3D ref={labelsRef} currentT={currentT} secondsLabel={t('sequence.seconds')}
      moreLabel={(n) => t('sequence.moreActions', { n })}
      labels={robots.map((robot) => ({
        id: robot.trajectory.id,
        identity: robotAnnotation(robot.trajectory) || robot.trajectory.name,
        alliance: robot.trajectory.alliance,
        pathColor: robot.color,
        actions: groupedActionsAt(robot, currentT),
      }))} />
  </div>;
});
