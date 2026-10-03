import { bumperColor } from '../robot-identity';
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import type { FieldPackage, ModuleLocation, RobotVisualGeometry, SessionTrajectory } from '@pathblender/core';
import {
  chassisModules,
  fieldImageWorldRect,
  moduleBaseYaw,
  moduleSteeringAngles,
  robotVisualGeometry,
  samplePoseAt,
  sampleStateAt,
} from '@pathblender/core';
import { trailPoints, TRAIL_WIDTH_M } from '../ground-trail';
import { saveBytes } from '../download';
import type { CollisionInterval, OutOfBoundsInterval } from '@pathblender/core';
import { useI18n } from '../i18n';
import { useTheme } from '../theme';
import {
  chaseAlpha,
  markGestureEnd,
  markGestureStart,
  pinchZoomFactor,
  splitInstant,
  wheelSuppressed,
  wheelZoomFactor,
} from '../zoom';

export interface FieldCanvasHandle {
  exportPng: (onDone?: (ok: boolean) => void) => void;
  fit: () => void;
}

interface Props {
  field: FieldPackage;
  /** URL of the calibrated field image; undefined renders an outline. */
  fieldImageUrl?: string;
  robots: SessionTrajectory[];
  currentT: number;
  conflicts: CollisionInterval[];
  bounds: OutOfBoundsInterval[];
  /** Robot currently in meditation-edit mode (report v1.4 §6.3); null = off. */
  editRobot?: SessionTrajectory | null;
  onBeginEdit?: () => void;
  onEndEdit?: () => void;
  onEditWaypoint?: (
    robotId: string,
    idx: number,
    part: { x: number; y: number },
    kind: 'anchor' | 'prevControl' | 'nextControl',
  ) => void;
  onAddWaypoint?: (robotId: string, afterIdx: number) => void;
  onRemoveWaypoint?: (robotId: string, idx: number) => void;
  /** Whether trails render (owned by the app-level toolbar). */
  showTrail?: boolean;
}

interface View {
  /** Screen pixels per meter. */
  scale: number;
  /** World point (meters) at the canvas center. */
  cx: number;
  cy: number;
}

/** Season artwork decoded once and reused across switches. */
const imageCache = new Map<string, HTMLImageElement>();

export const FieldCanvas = forwardRef<FieldCanvasHandle, Props>(function FieldCanvas(
  {
    field,
    fieldImageUrl,
    robots,
    currentT,
    conflicts,
    bounds,
    showTrail = true,
  },
  ref,
) {
  const { t } = useI18n();
  const { resolved: theme } = useTheme();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  // Last drawn wheel-steering angles per robot (radians, robot frame) —
  // MK5i-style pods hold their pointing when the robot stands still.
  const steerRef = useRef(new Map<string, number[]>());
  const [imgReady, setImgReady] = useState(false);
  const viewRef = useRef<View>({ scale: 40, cx: field.lengthM / 2, cy: field.widthM / 2 });
  // Last fitted px/m — anchors the zoom-out floor (field stays ≥ half the
  // canvas) and updates on every fit/resize.
  const fitScaleRef = useRef(40);
  const sizeRef = useRef({ w: 0, h: 0 });
  const autoFitRef = useRef(true);
  const drawRef = useRef<() => void>(() => {});
  const frameRef = useRef<number | null>(null);
  const requestDraw = useCallback(() => {
    if (frameRef.current != null) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      drawRef.current();
    });
  }, []);
  useEffect(() => () => {
    if (frameRef.current != null) cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
  }, []);
  // (Re)load the field image when the season changes. Decoded images are
  // cached module-level, so switching back to a recently viewed season
  // paints instantly instead of re-fetching/decoding the multi-MB PNG.
  useEffect(() => {
    imgRef.current = null;
    setImgReady(false);
    if (!fieldImageUrl) return;
    const hit = imageCache.get(fieldImageUrl);
    if (hit) {
      imgRef.current = hit;
      setImgReady(true);
      return;
    }
    const img = new Image();
    img.onload = () => {
      if (imageCache.size >= 12) imageCache.delete(imageCache.keys().next().value as string);
      imageCache.set(fieldImageUrl, img);
      imgRef.current = img;
      setImgReady(true);
    };
    img.src = fieldImageUrl;
    return () => { img.onload = null; };
  }, [fieldImageUrl, field.id]);

  const fit = useCallback(() => {
    autoFitRef.current = true;
    const { w, h } = sizeRef.current;
    if (w === 0 || h === 0) return;
    const rect = field.image
      ? fieldImageWorldRect(field.image, field.lengthM, field.widthM)
      : { left: -0.5, right: field.lengthM + 0.5, bottom: -0.5, top: field.widthM + 0.5 };
    const spanX = rect.right - rect.left;
    const spanY = rect.top - rect.bottom;
    viewRef.current = {
      scale: Math.min(w / spanX, h / spanY),
      cx: field.lengthM / 2,
      cy: field.widthM / 2,
    };
    fitScaleRef.current = viewRef.current.scale;
    requestDraw();
  }, [field, requestDraw]);

  // Track container size (DPR aware canvas backing store).
  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const ro = new ResizeObserver(() => {
      const w = wrap.clientWidth;
      const h = wrap.clientHeight;
      sizeRef.current = { w, h };
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      if (autoFitRef.current) fit();
      else requestDraw();
    });
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [fit, requestDraw]);

  useLayoutEffect(() => { fit(); }, [fit]);

  // Wheel + trackpad-pinch zoom (anchored at the cursor). The field itself
  // is never panned (a panned-away field is easy to lose) and there is no
  // edit mode anymore — the canvas is a pure view.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const world = (sx: number, sy: number) => {
      const { w, h } = sizeRef.current;
      const v = viewRef.current;
      return {
        x: v.cx + (sx - w / 2) / v.scale,
        y: v.cy - (sy - h / 2) / v.scale,
      };
    };

    // Zoom by `factor` keeping the world point under (sx, sy) fixed —
    // Onshape-style zoom-to-cursor (user request 2026-10-02). The
    // before/after diff stays exact even when the scale clamps.
    // Range (user round 11, 2026-10-03): the top is deep CAD-grade zoom
    // (~0.23 m of field visible — Onshape lets you zoom until geometry
    // degenerates; the old 1000 px/m cap stopped short of that); the
    // bottom is exactly the fit view: zooming out may never shrink the
    // field below what it looks like on open ("缩到刚打开时的样子，不能
    // 再小了"). The static 8 px/m term is only an unreachable safety net.
    const MAX_SCALE = 6000;
    const clampScale = (s: number) =>
      Math.min(MAX_SCALE, Math.max(Math.max(8, fitScaleRef.current), s));
    const zoomAt = (sx: number, sy: number, factor: number) => {
      const v = viewRef.current;
      const before = world(sx, sy);
      v.scale = clampScale(v.scale * factor);
      const after = world(sx, sy);
      v.cx += before.x - after.x;
      v.cy += before.y - after.y;
    };

    // Chase easing scaffolding (user round 5, 2026-10-02) — retained but
    // inert since R11: Onshape applies zoom with zero animation (measured
    // 2026-10-03), so CHASE_INSTANT_SHARE is 1 and events apply fully in
    // their own frame. Wheel zoom was always instant and cancels any
    // running chase.
    let chaseTarget: View | null = null;
    let chaseRaf = 0;
    let lastChaseT = 0;
    const stopChase = () => {
      chaseTarget = null;
      if (chaseRaf) cancelAnimationFrame(chaseRaf);
      chaseRaf = 0;
    };
    const zoomAtView = (v: View, sx: number, sy: number, factor: number): View => {
      const { w, h } = sizeRef.current;
      const wx = v.cx + (sx - w / 2) / v.scale;
      const wy = v.cy - (sy - h / 2) / v.scale;
      const scale = clampScale(v.scale * factor);
      return { scale, cx: wx - (sx - w / 2) / scale, cy: wy + (sy - h / 2) / scale };
    };
    const chaseStepFrame = () => {
      chaseRaf = 0;
      const t = chaseTarget;
      // Fit/resize reclaims the view (autoFit on) — snap to it, stop chasing.
      if (!t || autoFitRef.current) { stopChase(); return; }
      const v = viewRef.current;
      const now = performance.now();
      const a = chaseAlpha(Math.min(64, now - lastChaseT));
      lastChaseT = now;
      v.scale += (t.scale - v.scale) * a;
      v.cx += (t.cx - v.cx) * a;
      v.cy += (t.cy - v.cy) * a;
      const settled = Math.abs(Math.log(t.scale / v.scale)) < 0.001 &&
        Math.abs(t.cx - v.cx) < 0.05 && Math.abs(t.cy - v.cy) < 0.05;
      if (settled) {
        v.scale = t.scale; v.cx = t.cx; v.cy = t.cy;
        chaseTarget = null;
      } else {
        chaseRaf = requestAnimationFrame(chaseStepFrame);
      }
      requestDraw();
    };
    const requestChase = () => {
      lastChaseT = performance.now();
      if (!chaseRaf) chaseRaf = requestAnimationFrame(chaseStepFrame);
    };

    // WebKit trackpad pinch fires gesture* events (not wheel+ctrlKey); the
    // gesture centroid anchors the zoom just like the wheel cursor does.
    // The raw finger-separation ratio is softened via pinchZoomFactor —
    // 1:1 mapping made small pinches feel violent (user round 2). Events
    // after gestureend are ignored: WKWebView can flush lagging events
    // around finger lift, which showed up as the view zooming *further*
    // the moment the user let go (user round 3).
    let lastScale = 1;
    let gestureDone = false;
    const gestureScale = (e: Event) => (e as Event & { scale?: number }).scale ?? 1;
    const onGestureStart = (e: Event) => {
      lastScale = gestureScale(e);
      gestureDone = false;
      markGestureStart();
    };
    const onGestureChange = (e: Event) => {
      e.preventDefault();
      if (gestureDone) return; // stray post-end flush
      const scale = gestureScale(e);
      if (scale > 0 && lastScale > 0) {
        autoFitRef.current = false;
        const g = e as Event & { clientX?: number; clientY?: number };
        const rect = canvas.getBoundingClientRect();
        const sx = (g.clientX ?? rect.left + rect.width / 2) - rect.left;
        const sy = (g.clientY ?? rect.top + rect.height / 2) - rect.top;
        const v = viewRef.current;
        const factor = pinchZoomFactor(scale / lastScale);
        // Onshape-identical responsiveness (measured 2026-10-03): every
        // event applies fully in its own frame — CHASE_INSTANT_SHARE is 1,
        // so `deferred` is a no-op and the chase below never moves the
        // view. The chase scaffolding stays only so the share can be
        // re-tuned without restructuring.
        const { instant, deferred } = splitInstant(factor);
        const live = zoomAtView(v, sx, sy, instant);
        v.scale = live.scale; v.cx = live.cx; v.cy = live.cy;
        // Target advances by the event's full factor. With no chase
        // running, seed from the post-instant live view — either way the
        // target equals the pre-event view composed with the full factor
        // (applying `instant` again here would double it).
        chaseTarget = chaseTarget
          ? zoomAtView(zoomAtView(chaseTarget, sx, sy, instant), sx, sy, deferred)
          : zoomAtView({ scale: v.scale, cx: v.cx, cy: v.cy }, sx, sy, deferred);
        requestChase();
        requestDraw();
      }
      lastScale = scale;
    };
    const onGestureEnd = (e: Event) => {
      gestureDone = true;
      markGestureEnd();
      lastScale = 1;
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      // Lifting fingers off a pinch drift across the glass and arrive as a
      // scroll burst — suppressing it is what freezes the zoom at release
      // (round 4; the gesture stream itself proved clean on video).
      if (wheelSuppressed()) return;
      stopChase(); // wheel is instant; don't fight a running chase
      autoFitRef.current = false;
      zoomAt(e.offsetX, e.offsetY, wheelZoomFactor(e.deltaY, e.deltaMode));
      requestDraw();
    };

    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('gesturestart', onGestureStart);
    canvas.addEventListener('gesturechange', onGestureChange);
    canvas.addEventListener('gestureend', onGestureEnd);
    return () => {
      stopChase();
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('gesturestart', onGestureStart);
      canvas.removeEventListener('gesturechange', onGestureChange);
      canvas.removeEventListener('gestureend', onGestureEnd);
    };
  }, [requestDraw]);

  // Coalesce data, view, image and theme changes into one frame. Paused
  // scenes do no recurring work; playback schedules draws as time changes.
  useLayoutEffect(() => {
    drawRef.current = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { w, h } = sizeRef.current;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = cssVar('--canvas-bg', '#1c1c1e');
    ctx.fillRect(0, 0, w, h);

    const v = viewRef.current;
    const sx = (x: number) => w / 2 + (x - v.cx) * v.scale;
    const sy = (y: number) => h / 2 - (y - v.cy) * v.scale;

    // Field image: world rect from corner or uniform-margin calibration.
    const rect = fieldImageWorldRect(
      field.image ?? { pixelWidth: 0, pixelHeight: 0, ppm: 1, marginM: 0.5 },
      field.lengthM,
      field.widthM,
    );
    if (imgRef.current) {
      ctx.drawImage(
        imgRef.current,
        sx(rect.left),
        sy(rect.top),
        (rect.right - rect.left) * v.scale,
        (rect.top - rect.bottom) * v.scale,
      );
      // Field panel border — keeps the field readable as a distinct panel
      // when light artwork zones meet the light background (AS style).
      ctx.strokeStyle = cssVar('--border', '#3d3d41');
      ctx.lineWidth = 1;
      ctx.strokeRect(
        sx(rect.left),
        sy(rect.top),
        (rect.right - rect.left) * v.scale,
        (rect.top - rect.bottom) * v.scale,
      );
    } else {
      // Fallback outline while the image loads.
      ctx.strokeStyle = cssVar('--border', '#3d3d41');
      ctx.lineWidth = 2;
      ctx.strokeRect(sx(0), sy(field.widthM), field.lengthM * v.scale, field.widthM * v.scale);
    }

    // AprilTag overlay (WPILib/PhotonVision layout), if the field has one.
    for (const tag of field.aprilTags ?? []) {
      const px = sx(tag.x);
      const py = sy(tag.y);
      ctx.fillStyle = '#9c6bff';
      ctx.fillRect(px - 4, py - 4, 8, 8);
      ctx.strokeStyle = '#c9a7f0';
      ctx.lineWidth = 1;
      ctx.strokeRect(px - 4, py - 4, 8, 8);
      ctx.fillStyle = '#c9a7f0';
      ctx.font = '10px ui-monospace, monospace';
      ctx.fillText(String(tag.id), px + 7, py + 4);
    }

    // Ground tape grows only along the already-travelled part of each route.
    if (showTrail) {
      ctx.save();
      ctx.lineJoin = 'round';
      ctx.lineCap = 'butt';
      ctx.lineWidth = TRAIL_WIDTH_M * v.scale;
      for (const r of robots) {
        const points = trailPoints(r, currentT);
        if (points.length < 2) continue;
        ctx.beginPath();
        points.forEach((p, i) => {
          if (i === 0) ctx.moveTo(sx(p.x), sy(p.y));
          else ctx.lineTo(sx(p.x), sy(p.y));
        });
        ctx.strokeStyle = r.color;
        ctx.stroke();
      }
      ctx.restore();
    }

    // Conflict markers at closest approaches.
    for (const c of conflicts) {
      const px = sx((c.closestA.x + c.closestB.x) / 2);
      const py = sy((c.closestA.y + c.closestB.y) / 2);
      ctx.strokeStyle = cssVar('--danger', '#ff453a');
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(px, py, 14, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = hexAlpha(cssVar('--danger', '#ff453a'), 0.15);
      ctx.fill();
    }

    // Which robots are in collision at the current time.
    const inCollisionNow = new Set<string>();
    for (const c of conflicts) {
      if (currentT >= c.startT - 1e-9 && currentT <= c.endT + 1e-9) {
        inCollisionNow.add(c.aId);
        inCollisionNow.add(c.bId);
      }
    }
    const outOfBoundsNow = new Set<string>();
    for (const b of bounds) {
      if (currentT >= b.startT - 1e-9 && currentT <= b.endT + 1e-9) {
        outOfBoundsNow.add(b.robotId);
      }
    }

    // Robots at currentT.
    for (const r of robots) {
      const state = sampleStateAt(r, currentT);
      const pose = state
        ? { x: state.x, y: state.y, heading: state.heading }
        : samplePoseAt(r, currentT);
      const vis = robotVisualGeometry(r.trajectory, field.year);
      const modules = chassisModules(r.trajectory, vis.chassis);
      const id = r.trajectory.id;
      let last = steerRef.current.get(id);
      if (!last || last.length !== modules.length) {
        // Parked at the installed angle; steering replaces it once moving.
        last = modules.map((m) => moduleBaseYaw(m));
        steerRef.current.set(id, last);
      }
      const angles = moduleSteeringAngles(
        state ?? { heading: pose.heading, vx: 0, vy: 0, omega: 0 },
        modules,
      );
      const wheels = angles.map((a, i) => {
        const angle = a ?? last![i]!;
        last![i] = angle;
        return angle;
      });
      drawRobot(
        ctx,
        sx,
        sy,
        pose,
        r,
        vis,
        modules,
        wheels,
        v.scale,
        inCollisionNow.has(id),
        outOfBoundsNow.has(id),
      );
    }

    // Clock overlay.
    ctx.fillStyle = cssVar('--fg', '#e6e6e8');
    ctx.font = '13px ui-monospace, monospace';
    ctx.fillText(t('canvas.clock', { t: currentT.toFixed(2) }), 12, 20);
    };
    requestDraw();
  }, [field, robots, currentT, conflicts, bounds, showTrail, imgReady, theme, t, requestDraw]);

  useImperativeHandle(ref, () => ({
    exportPng: (onDone?: (ok: boolean) => void) => {
      const canvas = canvasRef.current;
      if (!canvas) {
        onDone?.(false);
        return;
      }
      canvas.toBlob((blob) => {
        if (!blob) {
          onDone?.(false);
          return;
        }
        void saveBytes(
          `pathblender-${new Date().toISOString().replace(/[:.]/g, '-')}.png`,
          'png',
          blob,
        )
          .then((ok) => onDone?.(ok))
          .catch(() => onDone?.(false));
      }, 'image/png');
    },
    fit,
    // Deps: without this array the handle is recreated on every render and
    // re-invokes the parent's ref callback — a re-render loop with a
    // state-held ref (bit us in the round-9 editor page).
  }), [fit]);

  return (
    <div className="field-canvas-wrap" ref={wrapRef}>
      <canvas ref={canvasRef} className="field-canvas" />
    </div>
  );
});


/** Resolve a palette token at draw time (theme-aware canvases). */
function cssVar(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

function drawRobot(
  ctx: CanvasRenderingContext2D,
  sx: (x: number) => number,
  sy: (y: number) => number,
  pose: { x: number; y: number; heading: number },
  r: SessionTrajectory,
  vis: RobotVisualGeometry,
  modules: ModuleLocation[],
  wheels: number[],
  scale: number,
  collided: boolean,
  outOfBounds: boolean,
) {
  const { outer, chassis } = vis;
  ctx.save();
  ctx.translate(sx(pose.x), sy(pose.y));
  // Screen y is flipped relative to world y, so rotate by -heading.
  ctx.rotate(-pose.heading);

  // Bumper ring (the collision footprint — highlight rides on it).
  const L = outer.lengthM * scale;
  const W = outer.widthM * scale;
  const ox = outer.offsetX * scale;
  const oy = outer.offsetY * scale;
  ctx.fillStyle = bumperColor(r.trajectory.alliance);
  ctx.strokeStyle = collided ? '#ff3b30' : outOfBounds ? '#ffa726' : bumperColor(r.trajectory.alliance);
  ctx.lineWidth = collided || outOfBounds ? 3 : 2;
  ctx.beginPath();
  ctx.rect(ox - L / 2, -oy - W / 2, L, W);
  ctx.fill();
  ctx.stroke();

  // Chassis frame inside the bumper ring.
  const cL = chassis.lengthM * scale;
  const cW = chassis.widthM * scale;
  const cox = chassis.offsetX * scale;
  const coy = chassis.offsetY * scale;
  ctx.fillStyle = cssVar('--bg-panel', '#29292c');
  ctx.strokeStyle = hexAlpha(r.color, 0.9);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.rect(cox - cL / 2, -coy - cW / 2, cL, cW);
  ctx.fill();
  ctx.stroke();

  // MK5i-style wheel pods: each roller points along its own steering
  // angle (swerve kinematics; degenerates to heading-aligned wheels for
  // differential drives). Drawn at chassis scale with a pixel floor so
  // they stay visible when the whole field is on screen.
  for (let i = 0; i < modules.length; i++) {
    const m = modules[i]!;
    const angle = wheels[i] ?? 0;
    const wl = Math.max(0.17 * scale, 5);
    const ww = Math.max(0.05 * scale, 2.5);
    ctx.save();
    ctx.translate(m.x * scale, -m.y * scale);
    ctx.rotate(-angle);
    ctx.fillStyle = cssVar('--fg', '#e6e6e8');
    roundedRect(ctx, -wl / 2, -ww / 2, wl, ww, ww / 2);
    ctx.fill();
    ctx.fillStyle = r.color;
    ctx.beginPath();
    ctx.arc(0, 0, ww * 0.62, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // Heading wedge on the +x end.
  ctx.fillStyle = r.color;
  ctx.beginPath();
  ctx.moveTo(ox + L / 2, 0);
  ctx.lineTo(ox + L / 2 - 6, -5);
  ctx.lineTo(ox + L / 2 - 6, 5);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  // Team number ON the bumper, like a real robot (user request
  // 2026-10-02, replacing the old center annotation): one number per
  // side rail, baseline along the rail so it rotates with the robot.
  // Font sized to the rail band with a legibility floor; halo keeps it
  // readable on any artwork, in both themes.
  if (r.trajectory.teamNumber) {
    const num = r.trajectory.teamNumber;
    const d = vis.bumperDepthM * scale;
    const railPrintable = Math.max((L - 2.4 * d) * 0.95, 8);
    let fs = Math.max(d * 1.15, 9);
    ctx.save();
    ctx.translate(sx(pose.x), sy(pose.y));
    ctx.rotate(-pose.heading);
    ctx.font = `bold ${fs}px ui-sans-serif, system-ui, sans-serif`;
    const wide = ctx.measureText(num).width;
    if (wide > railPrintable) {
      fs = Math.max((fs * railPrintable) / wide, 6);
      ctx.font = `bold ${fs}px ui-sans-serif, system-ui, sans-serif`;
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 3;
    ctx.strokeStyle = cssVar('--canvas-bg', '#1c1c1e');
    ctx.fillStyle = '#ffffff';
    for (const side of [1, -1]) {
      // Robot-frame rail center y = ±(W/2 − d/2); screen y is flipped.
      ctx.save();
      ctx.translate(ox, -oy - side * (W / 2 - d / 2));
      ctx.strokeText(num, 0, 0);
      ctx.fillText(num, 0, 0);
      ctx.restore();
    }
    ctx.restore();
  }
}

/** Rounded-rect path without relying on CanvasRenderingContext2D.roundRect. */
function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number,
) {
  const rr = Math.min(radius, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function hexAlpha(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}
