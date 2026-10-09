/**
 * Shared 2D field renderer (2026-10-06): the frame-drawing body extracted
 * from FieldCanvas so the workspace canvas and the solution-package export
 * (路线总览.png / 回放.mp4, rendered off-screen) paint byte-for-byte the same
 * picture — one drawing implementation, two consumers.
 *
 * The caller owns its canvas, DPR transform and image caches; this module
 * draws one frame given explicit parameters. All coordinates are CSS-style
 * pixels matching the ctx's current transform (the workspace passes w/h in
 * CSS px after scaling by devicePixelRatio; the exporter uses a 1:1 backing
 * store).
 */

import type {
  CollisionInterval,
  FieldPackage,
  ModuleLocation,
  OutOfBoundsInterval,
  SessionTrajectory,
} from '@pathblender/core';
import {
  chassisModules,
  fieldImageWorldRect,
  moduleBaseYaw,
  resolveSequence,
  robotVisualGeometry,
  samplePoseAt,
  sampleStateAt,
  groupedActionsAt,
} from '@pathblender/core';
import { TRAIL_WIDTH_M } from './ground-trail';
import { bumperColor, heatmapColor, robotAnnotation } from './robot-identity';
import { MK5I_MODULE_TOP_WORLD_M } from './robot-sprites';

export interface RenderView {
  /** Screen pixels per meter. */
  scale: number;
  /** World point (meters) at the canvas center. */
  cx: number;
  cy: number;
}

type PathPoint = { x: number; y: number; heading: number };

/** Per-segment path geometry: composed robots contribute one array per
 * segment (no inter-segment bridge), legacy robots their single route. */
function pathSegmentsOf(r: SessionTrajectory): PathPoint[][] {
  const resolved = resolveSequence(r);
  if (resolved) return resolved.map((segment) => segment.trajectory.samples);
  return [r.trajectory.samples];
}

function pathSegments(r: SessionTrajectory): PathPoint[] {
  return pathSegmentsOf(r).flat();
}

export interface ToleranceGhost {
  robot: SessionTrajectory;
  pose: { x: number; y: number; heading: number };
  /** Relative clock shift (seconds) the pose is sampled under. */
  offsetS: number;
}

/**
 * Slip-scenario ghosts: while the playhead sits inside a tolerance-kind
 * conflict window, the shifted robot's pose at its slipped clock (the scan's
 * own frame — a at t, b at t − offsetS). The paper plan alone can't show this
 * collision; the ghost overlays where the worst-case start slip would put the
 * robot, so the overlap reads directly on the field.
 */
export function toleranceGhostsAt(
  conflicts: readonly CollisionInterval[],
  robots: readonly SessionTrajectory[],
  currentT: number,
): ToleranceGhost[] {
  const byId = new Map(robots.map((r) => [r.trajectory.id, r]));
  const ghosts: ToleranceGhost[] = [];
  for (const c of conflicts) {
    if (c.kind !== 'tolerance') continue;
    if (currentT < c.startT - 1e-9 || currentT > c.endT + 1e-9) continue;
    const b = byId.get(c.bId);
    if (!b) continue;
    ghosts.push({ robot: b, pose: samplePoseAt(b, currentT - c.offsetS), offsetS: c.offsetS });
  }
  return ghosts;
}

/** Full-field fit view — the same math the workspace canvas uses on open. */
export function fitViewFor(field: FieldPackage, w: number, h: number): RenderView {
  if (w === 0 || h === 0) return { scale: 40, cx: field.lengthM / 2, cy: field.widthM / 2 };
  const rect = field.image
    ? fieldImageWorldRect(field.image, field.lengthM, field.widthM)
    : { left: -0.5, right: field.lengthM + 0.5, bottom: -0.5, top: field.widthM + 0.5 };
  const spanX = rect.right - rect.left;
  const spanY = rect.top - rect.bottom;
  return { scale: Math.min(w / spanX, h / spanY), cx: field.lengthM / 2, cy: field.widthM / 2 };
}

export interface FieldFrameParams {
  /** Canvas size in the ctx's coordinate space (CSS px on-screen). */
  w: number;
  h: number;
  view: RenderView;
  field: FieldPackage;
  fieldImg: HTMLImageElement | null;
  sprite: HTMLImageElement | null;
  robots: SessionTrajectory[];
  currentT: number;
  conflicts: CollisionInterval[];
  bounds: OutOfBoundsInterval[];
  showTrail?: boolean;
  showHeatmap?: boolean;
  /** Robot (trajectory) ids whose path tape renders gray instead of the
   * team color — illegal start zone verdicts (user 2026-10-09). */
  dimPathIds?: ReadonlySet<string>;
  /** Clock overlay text; undefined draws the standard t-label, null draws none. */
  clockLabel?: string | null;
}

export function renderFieldFrame(ctx: CanvasRenderingContext2D, p: FieldFrameParams): void {
  const { w, h, view, field, robots, conflicts, bounds } = p;
  const currentT = p.currentT;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = cssVar('--canvas-bg', '#1c1c1e');
  ctx.fillRect(0, 0, w, h);

  const sx = (x: number) => w / 2 + (x - view.cx) * view.scale;
  const sy = (y: number) => h / 2 - (y - view.cy) * view.scale;

  // Field image: world rect from corner or uniform-margin calibration.
  const rect = fieldImageWorldRect(
    field.image ?? { pixelWidth: 0, pixelHeight: 0, ppm: 1, marginM: 0.5 },
    field.lengthM,
    field.widthM,
  );
  if (p.fieldImg) {
    ctx.drawImage(
      p.fieldImg,
      sx(rect.left),
      sy(rect.top),
      (rect.right - rect.left) * view.scale,
      (rect.top - rect.bottom) * view.scale,
    );
    // Field panel border — keeps the field readable as a distinct panel
    // when light artwork zones meet the light background (AS style).
    ctx.strokeStyle = cssVar('--border', '#3d3d41');
    ctx.lineWidth = 1;
    ctx.strokeRect(
      sx(rect.left),
      sy(rect.top),
      (rect.right - rect.left) * view.scale,
      (rect.top - rect.bottom) * view.scale,
    );
  } else {
    // Fallback outline while the image loads.
    ctx.strokeStyle = cssVar('--border', '#3d3d41');
    ctx.lineWidth = 2;
    ctx.strokeRect(sx(0), sy(field.widthM), field.lengthM * view.scale, field.widthM * view.scale);
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
  if (p.showHeatmap) {
    ctx.save();
    ctx.globalAlpha = 0.06;
    for (const r of robots) {
      // Alliance tint: blue keeps the accent, red pairs with the theme red.
      ctx.fillStyle = heatmapColor(r.trajectory.alliance, cssVar('--accent', '#0a84ff'), cssVar('--danger', '#ff453a'));
      // Composed robots contribute every segment; legacy robots their one route.
      const segmentSamples = pathSegments(r);
      const stride = Math.max(1, Math.ceil(segmentSamples.length / 120));
      const L = r.trajectory.geometry.lengthM;
      const W = r.trajectory.geometry.widthM;
      for (let i = 0; i < segmentSamples.length; i += stride) {
        const point = segmentSamples[i] as { x: number; y: number; heading: number };
        ctx.save();
        ctx.translate(sx(point.x), sy(point.y));
        ctx.rotate(-point.heading);
        ctx.fillRect(-(L * view.scale) / 2, -(W * view.scale) / 2, L * view.scale, W * view.scale);
        ctx.restore();
      }
    }
    ctx.restore();
  }

  // Ground tape: always the full route, so the tape runs continuously
  // under the robot and into the heading wedge on the front bumper.
  // A composed robot draws one tape per segment — never a line bridging
  // a wait (that would fake a connecting route the robot does not drive).
  if (p.showTrail !== false) {
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.lineWidth = TRAIL_WIDTH_M * view.scale;
    for (const r of robots) {
      const segments = pathSegmentsOf(r);
      ctx.strokeStyle = p.dimPathIds?.has(r.trajectory.id)
        ? cssVar('--fg-dim', '#a1a1aa')
        : r.color;
      for (const samples of segments) {
        if (samples.length < 2) continue;
        ctx.beginPath();
        samples.forEach((point, i) => {
          if (i === 0) ctx.moveTo(sx(point.x), sy(point.y));
          else ctx.lineTo(sx(point.x), sy(point.y));
        });
        ctx.stroke();
      }
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

  // Which robots are in collision at the current time. Tolerance-kind
  // windows are hypothetical (a slipped start — drawn as the faded ghost
  // above), so they don't paint the solid robots red: a red bumper means
  // a real, on-paper overlap.
  const inCollisionNow = new Set<string>();
  for (const c of conflicts) {
    if (c.kind === 'tolerance') continue;
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

  // Tolerance-conflict ghosts: the slipped robot drawn faded (dashed bumper
  // edge) at its worst-case clock pose, under the solid robots — the plan
  // stays ground truth, the hypothetical collision reads on the field.
  for (const g of toleranceGhostsAt(conflicts, robots, currentT)) {
    const vis = robotVisualGeometry(g.robot.trajectory, field.year);
    const modules = chassisModules(g.robot.trajectory, vis.chassis);
    ctx.save();
    ctx.globalAlpha = 0.35;
    drawRobot(ctx, sx, sy, g.pose, g.robot, vis, modules, p.sprite, view.scale, false, false, null, currentT, w, h, true);
    ctx.restore();
  }

  // Robots at currentT.
  for (const r of robots) {
    const state = sampleStateAt(r, currentT);
    const pose = state
      ? { x: state.x, y: state.y, heading: state.heading }
      : samplePoseAt(r, currentT);
    const vis = robotVisualGeometry(r.trajectory, field.year);
    const modules = chassisModules(r.trajectory, vis.chassis);
    // The actions this robot is performing right now, as a set: sustained
    // mechanism groups still open plus one-shot moves inside their flash
    // window (action-words.ts). Empty before anything fires and for
    // unannotated routes — the callout then draws nothing.
    // One box per distinct ending time (user layout 2026-10-08): same
    // enders share a box, boxes stack soonest-ending first, the box's one
    // countdown counts to their shared end — pairs and successors exact,
    // open-ended to the route end, flashes to their window.
    const actionGroups = groupedActionsAt(r, currentT);
    const action = actionGroups.length ? actionGroups : null;
    drawRobot(
      ctx,
      sx,
      sy,
      pose,
      r,
      vis,
      modules,
      p.sprite,
      view.scale,
      inCollisionNow.has(r.trajectory.id),
      outOfBoundsNow.has(r.trajectory.id),
      action,
      currentT,
      w,
      h,
    );
  }

  // Clock overlay.
  if (p.clockLabel !== null) {
    ctx.fillStyle = cssVar('--fg', '#e6e6e8');
    ctx.font = '13px ui-monospace, monospace';
    ctx.fillText(p.clockLabel ?? t_defaultClock(currentT), 12, 20);
  }
}

function t_defaultClock(t: number): string {
  return `t = ${t.toFixed(2)} s`;
}

/** Resolve a palette token at draw time (theme-aware canvases). */
export function cssVar(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

function drawRobot(
  ctx: CanvasRenderingContext2D,
  sx: (x: number) => number,
  sy: (y: number) => number,
  pose: { x: number; y: number; heading: number },
  r: SessionTrajectory,
  vis: ReturnType<typeof robotVisualGeometry>,
  modules: ModuleLocation[],
  sprite: HTMLImageElement | null,
  scale: number,
  collided: boolean,
  outOfBounds: boolean,
  actions: import('@pathblender/core').ActionGroup[] | null,
  currentT: number,
  canvasW: number,
  canvasH: number,
  ghost = false,
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
  // Ghost edge (tolerance slip scenario): dashed reads "hypothetical" —
  // set inside the transform save/restore so solid robots keep solid edges.
  ctx.setLineDash(ghost ? [5, 4] : []);
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
  // Horizontal side the number badge took (1 right, -1 left, 1 when it
  // never drew) — the action badge mirrors onto the other side.
  let numDir = 1;
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
    numDir = dir;
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

  // Current-action callout (user request 2026-10-08, stacked per action the
  // same day): the same leader-line language on the diagonal opposite the
  // team number — ONE badge per active action, each on its own line fanning
  // from a shared anchor dot, stacked downward (user: "两个动作就是两条线
  // 拉出来两个框，要分开的"). The active set comes from the vocabulary table
  // in core/action-words.ts (pairs resolve to exact intervals;
  // same-mechanism events replace; one-shot moves flash and fade) — empty
  // before anything fires and for unannotated routes, drawing nothing.
  // Names render verbatim in mono (the annotations' own identifiers, not
  // UI copy) in the robot's session color, distinct from the
  // alliance-colored number badge above.
  if (actions) {
    const cos = Math.cos(pose.heading);
    const sin = Math.sin(pose.heading);
    const cx = sx(pose.x + outer.offsetX * cos - outer.offsetY * sin);
    const cy = sy(pose.y + outer.offsetX * sin + outer.offsetY * cos);
    const reach = Math.hypot(L, W) / 2;
    ctx.save();
    ctx.font = '12px ui-monospace, monospace';
    const color = r.color;
    const plate = cssVar('--bg-panel', '#ffffff');
    const pad = 6;
    const lineH = 16;
    const colGap = 8;
    const margin = 6;
    const gap = 4;
    const leader = 20;
    const offset = Math.SQRT1_2 * (reach + leader);
    const dir = -numDir;
    const dpr = window.devicePixelRatio || 1;
    const snap = (value: number) => Math.round(value * dpr) / dpr;
    // Pre-measure every box: names stack left, the one countdown sits
    // right-aligned at the box's vertical middle.
    const boxes = actions.map((group) => {
      const sec = `${Math.max(0, group.endsAt - currentT).toFixed(1)}s`;
      const nameW = Math.max(...group.actions.map((a) => ctx.measureText(a.name).width));
      const secW = ctx.measureText(sec).width;
      const h = 22 + (group.actions.length - 1) * lineH;
      const w = pad + nameW + colGap + secW + pad;
      return { group, sec, secW, h, w };
    });
    const stackH = boxes.reduce((m, b) => m + b.h, 0) + (boxes.length - 1) * gap;
    const y0 = snap(Math.max(margin, Math.min(
      cy + offset - 11,
      canvasH - margin - stackH,
    )));
    ctx.lineCap = 'round';
    // Shared anchor dot at the footprint center, robot-colored.
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(cx, cy, 3, 0, Math.PI * 2);
    ctx.strokeStyle = plate;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fill();
    let byCursor = y0;
    for (const box of boxes) {
      const bx = snap(Math.max(margin, Math.min(
        cx + dir * offset - (dir < 0 ? box.w : 0),
        canvasW - margin - box.w,
      )));
      const ly = byCursor + box.h / 2;
      const lx = dir > 0 ? bx : bx + box.w;
      // Leader from the anchor to this badge's robot-facing edge — the
      // stack fans out without any line crossing a badge above it.
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(lx, ly);
      ctx.strokeStyle = plate;
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.beginPath();
      ctx.roundRect(bx, byCursor, box.w, box.h, 5);
      ctx.fillStyle = plate;
      ctx.fill();
      ctx.strokeStyle = cssVar('--border', 'rgba(0, 0, 0, 0.10)');
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = color;
      box.group.actions.forEach((a, i) => {
        ctx.fillText(a.name, snap(bx + pad), snap(byCursor + 11 + i * lineH));
      });
      // The box's single countdown, right-aligned mid-box.
      ctx.textAlign = 'right';
      ctx.fillText(box.sec, snap(bx + box.w - pad), snap(ly));
      ctx.textAlign = 'left';
      byCursor += box.h + gap;
    }
    ctx.restore();
  }
}

function hexAlpha(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}
