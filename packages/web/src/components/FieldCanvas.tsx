import { bumperColor, robotAnnotation } from '../robot-identity';
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
  robotVisualGeometry,
  samplePoseAt,
  sampleStateAt,
} from '@pathblender/core';
import { TRAIL_WIDTH_M } from '../ground-trail';
import { MK5I_MODULE_TOP_URL, MK5I_MODULE_TOP_WORLD_M } from '../robot-sprites';
import { saveBytes } from '../download';
import type { CollisionInterval, OutOfBoundsInterval } from '@pathblender/core';
import { useI18n } from '../i18n';
import { useTheme } from '../theme';
import {
  chaseAlpha,
  classifyWheelInput,
  markGestureEnd,
  markGestureStart,
  pinchZoomFactor,
  splitInstant,
  wheelSuppressed,
  wheelZoomFactor,
} from '../zoom';

export interface FieldCanvasHandle {
  exportPng: (onDone?: (ok: boolean) => void) => void;
  exportGif: (onDone?: (ok: boolean) => void) => void;
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
  /** Occupancy heatmap over every robot's full timeline (§7.3-3). */
  showHeatmap?: boolean;
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
    showHeatmap = false,
  },
  ref,
) {
  const { t } = useI18n();
  const { resolved: theme } = useTheme();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  // MK5i module top-view sprite (shared imageCache entry, see below).
  const spriteRef = useRef<HTMLImageElement | null>(null);
  const [spriteReady, setSpriteReady] = useState(false);
  const [imgReady, setImgReady] = useState(false);
  const viewRef = useRef<View>({ scale: 40, cx: field.lengthM / 2, cy: field.widthM / 2 });
  // Last fitted px/m — anchors the zoom-out floor (field stays ≥ half the
  // canvas) and updates on every fit/resize.
  const fitScaleRef = useRef(40);
  const sizeRef = useRef({ w: 0, h: 0 });
  const autoFitRef = useRef(true);
  const drawRef = useRef<() => void>(() => {});
  // GIF capture draws at arbitrary t values; the override short-circuits
  // the prop while frames are being collected, then restores.
  const overrideTRef = useRef<number | null>(null);
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

  // Load the module sprite once (build-time constant URL). Mirrors the
  // field image's cache-then-ready pattern so a warm switch paints instantly.
  useEffect(() => {
    const hit = imageCache.get(MK5I_MODULE_TOP_URL);
    if (hit) {
      spriteRef.current = hit;
      setSpriteReady(true);
      return;
    }
    const img = new Image();
    img.onload = () => {
      if (imageCache.size >= 12) imageCache.delete(imageCache.keys().next().value as string);
      imageCache.set(MK5I_MODULE_TOP_URL, img);
      spriteRef.current = img;
      setSpriteReady(true);
    };
    img.src = MK5I_MODULE_TOP_URL;
    return () => { img.onload = null; };
  }, []);

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

    // Chase easing (user round 5, 2026-10-02): continuous streams — pinch
    // AND two-finger scroll — move a TARGET view; a rAF loop eases the real
    // view toward it (zoom.ts). Each event still applies its instant share
    // on arrival, so response is immediate; the glide merges batched
    // deliveries into fluid motion. Discrete mouse notches are instant and
    // cancel any running chase.
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
        // Half of every event applies on arrival (round 7; restored
        // 2026-10-03 — full-instant read as steps), the chase glides the
        // deferred remainder over ~5τ.
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
      autoFitRef.current = false;
      const factor = wheelZoomFactor(e.deltaY, e.deltaMode);
      const sx = e.offsetX;
      const sy = e.offsetY;
      if (classifyWheelInput(e.deltaY, e.deltaMode) === 'trackpad') {
        // Two-finger scroll is a continuous stream delivered in batches —
        // same treatment as the pinch: half of every event applies on
        // arrival, the chase glides the rest, so the batches read as one
        // fluid motion instead of steps ("没有之前那么丝滑", 2026-10-03).
        const { instant, deferred } = splitInstant(factor);
        const live = zoomAtView(viewRef.current, sx, sy, instant);
        viewRef.current.scale = live.scale;
        viewRef.current.cx = live.cx;
        viewRef.current.cy = live.cy;
        // Target advances by the event's full factor; seeded from the
        // post-instant live view when no chase is running (composing
        // `instant` again here would double it).
        chaseTarget = chaseTarget
          ? zoomAtView(zoomAtView(chaseTarget, sx, sy, instant), sx, sy, deferred)
          : zoomAtView({ scale: viewRef.current.scale, cx: viewRef.current.cx, cy: viewRef.current.cy }, sx, sy, deferred);
        requestChase();
      } else {
        // Discrete mouse notch: instant and crisp; cancels any glide.
        stopChase();
        zoomAt(sx, sy, factor);
      }
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
    // DPR can change without a resize (window dragged between Retina and
    // 1x displays) — ResizeObserver only watches CSS size and misses it,
    // leaving a stale backing store whose uncleared region ghosts the
    // previous frame. Re-allocate (which wipes the bitmap) on any drift.
    const bw = Math.round(w * dpr);
    const bh = Math.round(h * dpr);
    if (canvas.width !== bw || canvas.height !== bh) {
      canvas.width = bw;
      canvas.height = bh;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // Best-available resampling for the field artwork and module sprite —
    // canvas defaults to low, which visibly softens both when zoomed.
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
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

    // Occupancy heatmap: every robot's footprint at every sample, low
    // alpha — dense regions read as "spent time here" (§7.3-3).
    if (showHeatmap) {
      ctx.save();
      ctx.fillStyle = cssVar('--accent', '#0a84ff');
      ctx.globalAlpha = 0.06;
      for (const r of robots) {
        const samples = r.trajectory.samples;
        const stride = Math.max(1, Math.ceil(samples.length / 120));
        const L = r.trajectory.geometry.lengthM;
        const W = r.trajectory.geometry.widthM;
        for (let i = 0; i < samples.length; i += stride) {
          const p = samples[i] as { x: number; y: number; heading: number };
          ctx.save();
          ctx.translate(sx(p.x), sy(p.y));
          ctx.rotate(-p.heading);
          ctx.fillRect(-(L * v.scale) / 2, -(W * v.scale) / 2, L * v.scale, W * v.scale);
          ctx.restore();
        }
      }
      ctx.restore();
    }

    // Ground tape: always the full route, so the tape runs continuously
    // under the robot and into the heading wedge on the front bumper.
    if (showTrail) {
      ctx.save();
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.lineWidth = TRAIL_WIDTH_M * v.scale;
      for (const r of robots) {
        const samples = r.trajectory.samples;
        if (samples.length < 2) continue;
        ctx.beginPath();
        samples.forEach((p, i) => {
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
      drawRobot(
        ctx,
        sx,
        sy,
        pose,
        r,
        vis,
        modules,
        spriteRef.current,
        v.scale,
        inCollisionNow.has(id),
        outOfBoundsNow.has(id),
        w,
        h,
      );
    }

    // Clock overlay.
    ctx.fillStyle = cssVar('--fg', '#e6e6e8');
    ctx.font = '13px ui-monospace, monospace';
    const effT = overrideTRef.current ?? currentT;
    ctx.fillText(t('canvas.clock', { t: effT.toFixed(2) }), 12, 20);
    };
    requestDraw();
  }, [field, robots, currentT, conflicts, bounds, showTrail, imgReady, spriteReady, theme, t, requestDraw]);

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
    exportGif: (onDone?: (ok: boolean) => void) => {
      const canvas = canvasRef.current;
      if (!canvas) {
        onDone?.(false);
        return;
      }
      void import('gifenc').then(async ({ GIFEncoder, quantize, applyPalette }) => {
        try {
          const duration = robots.reduce((m, r) => Math.max(m, r.startDelayS + r.trajectory.durationS), 0);
          const dt = 0.1;
          const total = Math.max(1, Math.min(200, Math.round(duration / dt)));
          const ctx2 = canvas.getContext('2d');
          if (!ctx2) throw new Error('no 2d context');
          const gif = GIFEncoder();
          const maxW = 640;
          const scale = Math.min(1, maxW / canvas.width);
          const w = Math.max(1, Math.round(canvas.width * scale));
          const h = Math.max(1, Math.round(canvas.height * scale));
          for (let i = 0; i < total; i++) {
            overrideTRef.current = i * dt;
            drawRef.current();
            const raw = ctx2.getImageData(0, 0, canvas.width, canvas.height).data;
            // Downscale into a small RGBA buffer (simple box sampling at
            // integer ratios keeps this dependency-free).
            const rgba = new Uint8ClampedArray(w * h * 4);
            for (let y = 0; y < h; y++) {
              for (let x = 0; x < w; x++) {
                const sx0 = Math.floor((x * canvas.width) / w);
                const sy0 = Math.floor((y * canvas.height) / h);
                const o0 = (sy0 * canvas.width + sx0) * 4;
                rgba[(y * w + x) * 4] = raw[o0] as number;
                rgba[(y * w + x) * 4 + 1] = raw[o0 + 1] as number;
                rgba[(y * w + x) * 4 + 2] = raw[o0 + 2] as number;
                rgba[(y * w + x) * 4 + 3] = 255;
              }
            }
            const palette = quantize(rgba, 256);
            const index = applyPalette(rgba, palette);
            gif.writeFrame(index, w, h, { palette, delay: Math.round(dt * 1000) });
          }
          overrideTRef.current = null;
          gif.finish();
          const bytes = gif.bytes();
          const ok = await saveBytes(
            `pathblender-${new Date().toISOString().replace(/[:.]/g, '-')}.gif`,
            'gif',
            new Uint8Array(bytes),
          );
          onDone?.(ok);
        } catch {
          overrideTRef.current = null;
          onDone?.(false);
        }
      }).catch(() => {
        overrideTRef.current = null;
        onDone?.(false);
      });
    },
    fit,
    // Deps: without this array the handle is recreated on every render and
    // re-invokes the parent's ref callback — a re-render loop with a
    // state-held ref (bit us in the round-9 editor page).
  }), [fit, robots]);

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
  sprite: HTMLImageElement | null,
  scale: number,
  collided: boolean,
  outOfBounds: boolean,
  canvasW: number,
  canvasH: number,
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
  ctx.strokeStyle = collided ? '#ff3b30' : outOfBounds ? '#ffa726' : bumperColor(r.trajectory.alliance);
  ctx.lineWidth = collided || outOfBounds ? 3 : 2;
  // Only the perimeter band carries the alliance color — the base plate
  // inside stays transparent so the field artwork shows through (user
  // request 2026-10-04). The band is ONE continuous closed square ring —
  // no seams anywhere (same user request, second pass): the outer square
  // minus the inner square, punched with the even-odd rule.
  const bd = Math.min(vis.bumperDepthM * scale, L / 2, W / 2);
  ctx.fillStyle = bumperColor(r.trajectory.alliance);
  ctx.beginPath();
  ctx.rect(ox - L / 2, -oy - W / 2, L, W);
  ctx.rect(ox - L / 2 + bd, -oy - W / 2 + bd, L - 2 * bd, W - 2 * bd);
  ctx.fill('evenodd');
  ctx.beginPath();
  ctx.rect(ox - L / 2, -oy - W / 2, L, W);
  ctx.stroke();

  // Chassis frame: four 1 in box-rail beams around the chassis
  // rectangle plus a corner block at each joint — the same "4 rails +
  // 4 corners" read as the 3D frame model, in theme-aware metal gray.
  // Rail width follows the 3D frame scaling (chassis.lengthM/0.6858),
  // so file-sized robots get proportionally thinner rails.
  const cL = chassis.lengthM * scale;
  const cW = chassis.widthM * scale;
  const cox = chassis.offsetX * scale;
  const coy = chassis.offsetY * scale;
  const bw = Math.max(0.0254 * (chassis.lengthM / 0.6858) * scale, 1.5);
  const left = cox - cL / 2;
  const top = -coy - cW / 2;
  ctx.fillStyle = cssVar('--fg-dim', '#8e8e93');
  ctx.strokeStyle = hexAlpha(cssVar('--fg', '#e6e6e8'), 0.45);
  ctx.lineWidth = 1;
  for (const [bx, by, rw, rh] of [
    [left, top, cL, bw],                       // +y rail (screen top)
    [left, top + cW - bw, cL, bw],             // −y rail (screen bottom)
    [left, top + bw, bw, cW - 2 * bw],         // −x rail
    [left + cL - bw, top + bw, bw, cW - 2 * bw], // +x rail
  ] as const) {
    ctx.fillRect(bx, by, rw, rh);
    ctx.strokeRect(bx, by, rw, rh);
  }
  // Corner blocks tying the rails together (the real frame's corner
  // gussets), a step lighter so the joints read at any zoom.
  const cb = Math.min(bw * 1.6, cL / 2, cW / 2);
  ctx.fillStyle = cssVar('--fg', '#e6e6e8');
  for (const cxx of [left, left + cL - cb]) {
    for (const cyy of [top, top + cW - cb]) {
      ctx.fillRect(cxx, cyy, cb, cb);
      ctx.strokeRect(cxx, cyy, cb, cb);
    }
  }

  // MK5i modules: the Blender-rendered top view of the real CAD module
  // parked at each corner's installed yaw (2D shows no steering
  // animation — user decision 2026-10-03: the wheels are not visible
  // turning anyway). Real hardware size always: the sprite spans its
  // render ortho scale regardless of chassis scaling, matching 3D
  // where the module GLB is never scaled. The render's image-up is
  // robot-frame −Y (camera up = glTF −Z), so the draw flips
  // vertically — mirroring the 3D mount's rotation.y = −yaw.
  if (sprite) {
    const S = MK5I_MODULE_TOP_WORLD_M * scale;
    for (const m of modules) {
      ctx.save();
      ctx.translate(m.x * scale, -m.y * scale);
      ctx.rotate(-moduleBaseYaw(m));
      ctx.scale(1, -1);
      ctx.drawImage(sprite, -S / 2, -S / 2, S, S);
      ctx.restore();
    }
  }

  // Heading wedge rides the front bumper band (user request 2026-10-04):
  // base pinned to the band's inner edge — never on the chassis rails —
  // tip one band depth past the outer face, onto the outgoing ground
  // tape. The 10 px screen floor keeps it readable at small zoom; any
  // extra length goes outward, never inward.
  const tipOut = Math.max(bd, 10 - bd);
  const halfW = Math.max(0.75 * bd, 2);
  ctx.fillStyle = r.color;
  ctx.beginPath();
  ctx.moveTo(ox + L / 2 + tipOut, 0);
  ctx.lineTo(ox + L / 2 - bd, -halfW);
  ctx.lineTo(ox + L / 2 - bd, halfW);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  // Team number callout (user request 2026-10-04, replacing the
  // on-bumper print — unreadable once the whole field fits on screen):
  // a leader line + anchor dot like the Preferences mouse diagram, the
  // number itself at the leader tip. Screen-space throughout: the
  // number stays upright and constant-size at any heading and zoom.
  const num = robotAnnotation(r.trajectory);
  if (num) {
    // The visible footprint can be offset from the trajectory origin.
    // Rotate that local offset exactly as the bumper/chassis above.
    const cos = Math.cos(pose.heading);
    const sin = Math.sin(pose.heading);
    const cx = sx(pose.x + outer.offsetX * cos - outer.offsetY * sin);
    const cy = sy(pose.y + outer.offsetX * sin + outer.offsetY * cos);
    const reach = Math.hypot(L, W) / 2;
    ctx.save();
    ctx.font = 'bold 13px ui-sans-serif, system-ui, sans-serif';
    const tw = ctx.measureText(num).width;
    // Reuse the theme-aware alliance control colors, including their
    // lighter dark-theme variants, rather than a white number or accent dot.
    const color = cssVar(
      r.trajectory.alliance === 'red' ? '--seg-red-fg' : '--seg-blue-fg',
      bumperColor(r.trajectory.alliance),
    );
    const plate = cssVar('--bg-panel', '#ffffff');
    const pad = 7;
    const labelW = tw + pad * 2;
    const labelH = 24;
    const margin = 6;
    const leader = 20;
    const offset = Math.SQRT1_2 * (reach + leader);
    const dir = cx + offset + labelW + margin <= canvasW ? 1 : -1;
    // Keep the badge inside the viewport and align its text to backing
    // pixels. Font size remains in CSS pixels; the existing DPR transform
    // rasterizes it directly at display resolution, independent of zoom.
    const dpr = window.devicePixelRatio || 1;
    const snap = (value: number) => Math.round(value * dpr) / dpr;
    const bx = snap(Math.max(margin, Math.min(
      cx + dir * offset - (dir < 0 ? labelW : 0),
      canvasW - margin - labelW,
    )));
    const by = snap(Math.max(margin, Math.min(
      cy - offset - labelH / 2,
      canvasH - margin - labelH,
    )));
    const lx = dir > 0 ? bx : bx + labelW;
    const ly = by + labelH / 2;
    // An opaque under-stroke keeps the fine leader legible over artwork.
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(lx, ly);
    ctx.strokeStyle = plate;
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(cx, cy, 3, 0, Math.PI * 2);
    ctx.strokeStyle = plate;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fill();

    // A solid, compact badge isolates the glyphs from field textures.
    // Avoid thick strokeText outlines, which muddy small letter counters.
    ctx.beginPath();
    ctx.roundRect(bx, by, labelW, labelH, 6);
    ctx.fillStyle = plate;
    ctx.fill();
    ctx.strokeStyle = cssVar('--border', 'rgba(0, 0, 0, 0.10)');
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = color;
    ctx.fillText(num, snap(bx + pad), snap(ly));
    ctx.restore();
  }
}

function hexAlpha(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}
