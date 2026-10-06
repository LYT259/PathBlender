import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { FieldPackage, SessionTrajectory } from '@pathblender/core';
import type { CollisionInterval, OutOfBoundsInterval } from '@pathblender/core';
import { renderFieldFrame, fitViewFor, type RenderView } from '../canvas2d-render';
import { saveBytes } from '../download';
import { useI18n } from '../i18n';
import { useTheme } from '../theme';
import { MK5I_MODULE_TOP_URL } from '../robot-sprites';
import {
  chaseAlpha,
  classifyWheelInput,
  KEY_ZOOM_STEP,
  markGestureEnd,
  markGestureStart,
  pinchZoomFactor,
  splitInstant,
  wheelSuppressed,
  wheelZoomFactor,
} from '../zoom';

export interface FieldCanvasHandle {
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
  const viewRef = useRef<RenderView>({ scale: 40, cx: field.lengthM / 2, cy: field.widthM / 2 });
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
    viewRef.current = fitViewFor(field, w, h);
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

  // Keyboard zoom (2026-10-06 keyboard pass): the canvas is a focus entry —
  // +/-/= zoom about the center at the same per-press step as one wheel
  // notch, 0 refits. No arrow pan here BY DESIGN (recorded 2026-10-02: the
  // 2D field is never panned, so a keyboard pan would strand the view) —
  // arrows fall through to the global playback scrub instead.
  const keyZoom = useCallback((factor: number) => {
    const { w, h } = sizeRef.current;
    if (!w || !h) return;
    autoFitRef.current = false;
    const v = viewRef.current;
    v.scale = Math.min(6000, Math.max(Math.max(8, fitScaleRef.current), v.scale * factor));
    requestDraw();
  }, [requestDraw]);
  const onCanvasKeyDown = useCallback((event: ReactKeyboardEvent<HTMLCanvasElement>) => {
    const native = event.nativeEvent;
    if (native.isComposing || native.keyCode === 229 || native.metaKey || native.ctrlKey || native.altKey) return;
    if (event.key === '+' || event.key === '=') {
      event.preventDefault(); event.stopPropagation();
      keyZoom(KEY_ZOOM_STEP);
    } else if (event.key === '-') {
      event.preventDefault(); event.stopPropagation();
      keyZoom(1 / KEY_ZOOM_STEP);
    } else if (event.key === '0' && !native.repeat) {
      event.preventDefault(); event.stopPropagation();
      fit();
    }
  }, [fit, keyZoom]);

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
    let chaseTarget: RenderView | null = null;
    let chaseRaf = 0;
    let lastChaseT = 0;
    const stopChase = () => {
      chaseTarget = null;
      if (chaseRaf) cancelAnimationFrame(chaseRaf);
      chaseRaf = 0;
    };
    const zoomAtView = (v: RenderView, sx: number, sy: number, factor: number): RenderView => {
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
  // The frame body itself lives in canvas2d-render.ts, shared with the
  // solution-package exporter so both hosts paint the identical picture.
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
      const effT = overrideTRef.current ?? currentT;
      renderFieldFrame(ctx, {
        w,
        h,
        view: viewRef.current,
        field,
        fieldImg: imgRef.current,
        sprite: spriteRef.current,
        robots,
        currentT: effT,
        conflicts,
        bounds,
        showTrail,
        showHeatmap,
        clockLabel: t('canvas.clock', { t: effT.toFixed(2) }),
      });
    };
    requestDraw();
  }, [field, robots, currentT, conflicts, bounds, showTrail, showHeatmap, imgReady, spriteReady, theme, t, requestDraw]);

  useImperativeHandle(ref, () => ({
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
      <canvas ref={canvasRef} className="field-canvas" tabIndex={0} aria-label={t('canvas.view')} onKeyDown={onCanvasKeyDown} />
    </div>
  );
});
