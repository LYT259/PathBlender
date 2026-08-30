import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import type { FieldPackage, SessionTrajectory } from '@pathblender/core';
import { fieldImageWorldRect, samplePoseAt } from '@pathblender/core';
import { saveBytes } from '../download';
import type { CollisionInterval, OutOfBoundsInterval } from '@pathblender/core';
import { useI18n } from '../i18n';

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

export const FieldCanvas = forwardRef<FieldCanvasHandle, Props>(function FieldCanvas(
  {
    field,
    fieldImageUrl,
    robots,
    currentT,
    conflicts,
    bounds,
    editRobot = null,
    onEditWaypoint,
    onAddWaypoint,
    onRemoveWaypoint,
    showTrail = true,
  },
  ref,
) {
  const { t } = useI18n();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [imgReady, setImgReady] = useState(false);
  const viewRef = useRef<View>({ scale: 40, cx: field.lengthM / 2, cy: field.widthM / 2 });
  const sizeRef = useRef({ w: 0, h: 0 });

  // (Re)load the field image when the season changes.
  useEffect(() => {
    imgRef.current = null;
    setImgReady(false);
    if (!fieldImageUrl) return;
    const img = new Image();
    img.src = fieldImageUrl;
    img.onload = () => {
      imgRef.current = img;
      setImgReady(true);
    };
  }, [fieldImageUrl, field.id]);

  const fit = useCallback(() => {
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
  }, [field]);

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
    });
    ro.observe(wrap);
    return () => ro.disconnect();
  }, []);

  // Pointer pan + wheel zoom (anchored at the cursor); in edit mode a
  // pointer-down on a waypoint captures the drag for the waypoint instead.
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

    type WpTarget = { idx: number; kind: 'anchor' | 'prevControl' | 'nextControl' };
    let wpDrag: WpTarget | null = null;
    const HIT_M = 12 / viewRef.current.scale; // ~12 px grab radius in meters

    const hitWaypoint = (wx: number, wy: number): WpTarget | null => {
      const e = editRobot?.trajectory.editable;
      if (!e) return null;
      if (e.kind === 'pathplanner') {
        for (let i = e.path.waypoints.length - 1; i >= 0; i--) {
          const wp = e.path.waypoints[i]!;
          if (wp.nextControl && Math.hypot(wx - wp.nextControl.x, wy - wp.nextControl.y) < HIT_M)
            return { idx: i, kind: 'nextControl' };
          if (wp.prevControl && Math.hypot(wx - wp.prevControl.x, wy - wp.prevControl.y) < HIT_M)
            return { idx: i, kind: 'prevControl' };
          if (Math.hypot(wx - wp.anchor.x, wy - wp.anchor.y) < HIT_M)
            return { idx: i, kind: 'anchor' };
        }
        return null;
      }
      for (let i = e.waypoints.length - 1; i >= 0; i--) {
        const wp = e.waypoints[i]!;
        if (Math.hypot(wx - wp.x, wy - wp.y) < HIT_M) return { idx: i, kind: 'anchor' };
      }
      return null;
    };

    const nearestSegment = (wx: number, wy: number): number => {
      const e = editRobot?.trajectory.editable;
      const pts =
        e?.kind === 'pathplanner'
          ? e.path.waypoints.map((w) => w.anchor)
          : e?.kind === 'choreo'
            ? e.waypoints.map((w) => ({ x: w.x, y: w.y }))
            : [];
      let best = -1;
      let bestD = 0.35; // meters — double-click radius
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i]!;
        const b = pts[i + 1]!;
        const abx = b.x - a.x;
        const aby = b.y - a.y;
        const len2 = abx * abx + aby * aby;
        const tt = len2 > 1e-9 ? Math.max(0, Math.min(1, ((wx - a.x) * abx + (wy - a.y) * aby) / len2)) : 0;
        const d = Math.hypot(wx - (a.x + abx * tt), wy - (a.y + aby * tt));
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
      return best;
    };

    const onDown = (e: PointerEvent) => {
      // Edit-mode waypoint drags only — the field itself is never panned
      // (a panned-away field is easy to lose; zoom stays anchored).
      if (editRobot && e.button === 0) {
        const w = world(e.offsetX, e.offsetY);
        const hit = hitWaypoint(w.x, w.y);
        if (hit) {
          wpDrag = hit;
          canvas.setPointerCapture(e.pointerId);
          return;
        }
      }
    };
    const onMove = (e: PointerEvent) => {
      if (!wpDrag || !editRobot || !onEditWaypoint) return;
      const w = world(e.offsetX, e.offsetY);
      onEditWaypoint(editRobot.trajectory.id, wpDrag.idx, w, wpDrag.kind);
    };
    const onUp = () => {
      wpDrag = null;
    };
    // WebKit trackpad pinch fires gesture* events (not wheel+ctrlKey).
    let lastScale = 1;
    const gestureScale = (e: Event) => (e as Event & { scale?: number }).scale ?? 1;
    const onGestureStart = (e: Event) => {
      lastScale = gestureScale(e);
    };
    const onGestureChange = (e: Event) => {
      e.preventDefault();
      const scale = gestureScale(e);
      if (scale > 0 && lastScale > 0) {
        const v = viewRef.current;
        v.scale = Math.min(400, Math.max(8, v.scale * (scale / lastScale)));
      }
      lastScale = scale;
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const v = viewRef.current;
      const before = world(e.offsetX, e.offsetY);
      v.scale = Math.min(400, Math.max(8, v.scale * Math.exp(-e.deltaY * 0.0012)));
      const after = world(e.offsetX, e.offsetY);
      v.cx += before.x - after.x;
      v.cy += before.y - after.y;
    };
    const onDblClick = (e: MouseEvent) => {
      if (!editRobot || !onAddWaypoint) return;
      const w = world(e.offsetX, e.offsetY);
      const seg = nearestSegment(w.x, w.y);
      if (seg >= 0) onAddWaypoint(editRobot.trajectory.id, seg);
    };
    const onContextMenu = (e: MouseEvent) => {
      if (!editRobot || !onRemoveWaypoint) return;
      const w = world(e.offsetX, e.offsetY);
      const hit = hitWaypoint(w.x, w.y);
      if (hit) {
        e.preventDefault();
        onRemoveWaypoint(editRobot.trajectory.id, hit.idx);
      }
    };

    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('gesturestart', onGestureStart);
    canvas.addEventListener('gesturechange', onGestureChange);
    canvas.addEventListener('dblclick', onDblClick);
    canvas.addEventListener('contextmenu', onContextMenu);
    return () => {
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('gesturestart', onGestureStart);
      canvas.removeEventListener('gesturechange', onGestureChange);
      canvas.removeEventListener('dblclick', onDblClick);
      canvas.removeEventListener('contextmenu', onContextMenu);
    };
  }, [editRobot, onEditWaypoint, onAddWaypoint, onRemoveWaypoint]);

  // Redraw whenever anything relevant changes.
  // Redraw on every animation frame: canvas panning/zooming mutates
  // viewRef without a React render, so a render-driven redraw would miss it.
  useEffect(() => {
    let raf = 0;
    const redraw = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { w, h } = sizeRef.current;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = cssVar('--bg', '#1e1e20');
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

    // Meditation-edit waypoint overlay for the robot in edit mode.
    const eEdit = editRobot?.trajectory.editable;
    if (eEdit) {
      const color = editRobot.color;
      if (eEdit.kind === 'pathplanner') {
        // Control arms + points, then anchors on top.
        ctx.strokeStyle = hexAlpha(color, 0.5);
        ctx.setLineDash([4, 4]);
        ctx.lineWidth = 1;
        for (const wp of eEdit.path.waypoints) {
          if (wp.prevControl) {
            ctx.beginPath();
            ctx.moveTo(sx(wp.anchor.x), sy(wp.anchor.y));
            ctx.lineTo(sx(wp.prevControl.x), sy(wp.prevControl.y));
            ctx.stroke();
          }
          if (wp.nextControl) {
            ctx.beginPath();
            ctx.moveTo(sx(wp.anchor.x), sy(wp.anchor.y));
            ctx.lineTo(sx(wp.nextControl.x), sy(wp.nextControl.y));
            ctx.stroke();
          }
        }
        ctx.setLineDash([]);
        ctx.fillStyle = hexAlpha(color, 0.8);
        for (const wp of eEdit.path.waypoints) {
          for (const c of [wp.prevControl, wp.nextControl]) {
            if (!c) continue;
            ctx.beginPath();
            ctx.arc(sx(c.x), sy(c.y), 4, 0, Math.PI * 2);
            ctx.fill();
          }
        }
        ctx.fillStyle = cssVar('--fg', '#e6e6e8');
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        for (const wp of eEdit.path.waypoints) {
          ctx.fillRect(sx(wp.anchor.x) - 5, sy(wp.anchor.y) - 5, 10, 10);
          ctx.strokeRect(sx(wp.anchor.x) - 5, sy(wp.anchor.y) - 5, 10, 10);
        }
      } else {
        ctx.fillStyle = cssVar('--fg', '#e6e6e8');
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        for (const wp of eEdit.waypoints) {
          const px = sx(wp.x);
          const py = sy(wp.y);
          ctx.beginPath();
          ctx.arc(px, py, 6, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
          // Heading tick.
          ctx.beginPath();
          ctx.moveTo(px, py);
          ctx.lineTo(px + Math.cos(wp.heading) * 12, py - Math.sin(wp.heading) * 12);
          ctx.stroke();
        }
      }
      ctx.fillStyle = cssVar('--fg-dim', '#9a9aa0');
      ctx.font = '11px ui-sans-serif, system-ui, sans-serif';
      ctx.fillText(t('canvas.editHint'), 12, 36);
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
      const pose = samplePoseAt(r, currentT);
      drawRobot(
        ctx,
        sx,
        sy,
        pose,
        r,
        v.scale,
        inCollisionNow.has(r.trajectory.id),
        outOfBoundsNow.has(r.trajectory.id),
      );
    }

    // Clock overlay.
    ctx.fillStyle = cssVar('--fg', '#e6e6e8');
    ctx.font = '13px ui-monospace, monospace';
    ctx.fillText(t('canvas.clock', { t: currentT.toFixed(2) }), 12, 20);
    };
    const loop = () => {
      redraw();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  });

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
  }));

  // Fit once the image is ready and a size is known.
  useEffect(() => {
    if (imgReady && sizeRef.current.w > 0) fit();
  }, [imgReady, fit]);

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
  scale: number,
  collided: boolean,
  outOfBounds: boolean,
) {
  const { geometry, moduleLocations } = r.trajectory;
  ctx.save();
  ctx.translate(sx(pose.x), sy(pose.y));
  // Screen y is flipped relative to world y, so rotate by -heading.
  ctx.rotate(-pose.heading);

  // Bumper rectangle in robot frame.
  const L = geometry.lengthM * scale;
  const W = geometry.widthM * scale;
  const ox = geometry.offsetX * scale;
  const oy = geometry.offsetY * scale;
  ctx.fillStyle = hexAlpha(r.color, 0.28);
  ctx.strokeStyle = collided ? '#ff3b30' : outOfBounds ? '#ffa726' : r.color;
  ctx.lineWidth = collided || outOfBounds ? 3 : 2;
  ctx.beginPath();
  ctx.rect(ox - L / 2, -oy - W / 2, L, W);
  ctx.fill();
  ctx.stroke();

  // Heading wedge on the +x end.
  ctx.fillStyle = r.color;
  ctx.beginPath();
  ctx.moveTo(ox + L / 2, 0);
  ctx.lineTo(ox + L / 2 - 6, -5);
  ctx.lineTo(ox + L / 2 - 6, 5);
  ctx.closePath();
  ctx.fill();

  // Wheel modules, when the file provided them.
  ctx.fillStyle = r.color;
  for (const m of moduleLocations) {
    ctx.fillRect(m.x * scale - 3, -m.y * scale - 3, 6, 6);
  }
  ctx.restore();

  // Team number annotation, drawn upright so it stays readable at any
  // robot heading (report v1.4 §6.1: color = path = legend = number).
  if (r.trajectory.teamNumber) {
    ctx.save();
    ctx.translate(sx(pose.x), sy(pose.y));
    ctx.font = `bold ${Math.max(11, Math.round(0.26 * geometry.lengthM * scale))}px ui-sans-serif, system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 3;
    // Halo in the page background color keeps the number readable on any
    // field artwork, in both themes (fg text + bg halo).
    ctx.strokeStyle = cssVar('--bg', '#1e1e20');
    ctx.strokeText(r.trajectory.teamNumber, 0, 0);
    ctx.fillStyle = cssVar('--fg', '#e6e6e8');
    ctx.fillText(r.trajectory.teamNumber, 0, 0);
    ctx.restore();
  }
}

function hexAlpha(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}
