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
  moduleSteeringAngles,
  robotVisualGeometry,
  samplePoseAt,
  sampleStateAt,
} from '@pathblender/core';
import { saveBytes } from '../download';
import type { CollisionInterval, OutOfBoundsInterval } from '@pathblender/core';
import { useI18n } from '../i18n';
import { useTheme } from '../theme';
import { pinchZoomFactor, wheelZoomFactor } from '../zoom';

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
    // before/after diff stays exact even when the scale clamps at 8/400.
    const zoomAt = (sx: number, sy: number, factor: number) => {
      const v = viewRef.current;
      const before = world(sx, sy);
      v.scale = Math.min(400, Math.max(8, v.scale * factor));
      const after = world(sx, sy);
      v.cx += before.x - after.x;
      v.cy += before.y - after.y;
    };

    // WebKit trackpad pinch fires gesture* events (not wheel+ctrlKey); the
    // gesture centroid anchors the zoom just like the wheel cursor does.
    // The raw finger-separation ratio is softened via pinchZoomFactor —
    // 1:1 mapping made small pinches feel violent (user round 2).
    let lastScale = 1;
    const gestureScale = (e: Event) => (e as Event & { scale?: number }).scale ?? 1;
    const onGestureStart = (e: Event) => {
      lastScale = gestureScale(e);
    };
    const onGestureChange = (e: Event) => {
      e.preventDefault();
      const scale = gestureScale(e);
      if (scale > 0 && lastScale > 0) {
        autoFitRef.current = false;
        const g = e as Event & { clientX?: number; clientY?: number };
        const rect = canvas.getBoundingClientRect();
        zoomAt(
          (g.clientX ?? rect.left + rect.width / 2) - rect.left,
          (g.clientY ?? rect.top + rect.height / 2) - rect.top,
          pinchZoomFactor(scale / lastScale),
        );
        requestDraw();
      }
      lastScale = scale;
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      autoFitRef.current = false;
      zoomAt(e.offsetX, e.offsetY, wheelZoomFactor(e.deltaY, e.deltaMode));
      requestDraw();
    };

    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('gesturestart', onGestureStart);
    canvas.addEventListener('gesturechange', onGestureChange);
    return () => {
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('gesturestart', onGestureStart);
      canvas.removeEventListener('gesturechange', onGestureChange);
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

    // Full trajectories — saturated, near-opaque, each with a background-
    // colored halo stroke underneath so every palette color stays readable
    // over any field artwork (dark zones, blue zones) in both themes.
    if (showTrail) {
      const halo = cssVar('--bg', '#1e1e20');
      for (const r of robots) {
        ctx.beginPath();
        r.trajectory.samples.forEach((s, i) => {
          const px = sx(s.x);
          const py = sy(s.y);
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        });
        ctx.strokeStyle = halo;
        ctx.globalAlpha = 0.85;
        ctx.lineWidth = 5;
        ctx.stroke();
        ctx.strokeStyle = hexAlpha(r.color, 0.95);
        ctx.globalAlpha = 1;
        ctx.lineWidth = 2.5;
        ctx.stroke();
      }
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
        last = modules.map(() => 0);
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
  ctx.fillStyle = hexAlpha(r.color, 0.22);
  ctx.strokeStyle = collided ? '#ff3b30' : outOfBounds ? '#ffa726' : r.color;
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
  ctx.fillStyle = hexAlpha(r.color, 0.45);
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

  // Team number annotation, drawn upright so it stays readable at any
  // robot heading (report v1.4 §6.1: color = path = legend = number).
  if (r.trajectory.teamNumber) {
    ctx.save();
    ctx.translate(sx(pose.x), sy(pose.y));
    ctx.font = `bold ${Math.max(11, Math.round(0.26 * outer.lengthM * scale))}px ui-sans-serif, system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 3;
    // Halo in the page background color keeps the number readable on any
    // field artwork, in both themes (fg text + bg halo).
    ctx.strokeStyle = cssVar('--canvas-bg', '#1c1c1e');
    ctx.strokeText(r.trajectory.teamNumber, 0, 0);
    ctx.fillStyle = cssVar('--fg', '#e6e6e8');
    ctx.fillText(r.trajectory.teamNumber, 0, 0);
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
