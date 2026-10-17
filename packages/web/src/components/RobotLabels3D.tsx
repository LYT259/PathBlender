import { forwardRef, useImperativeHandle, useRef, type CSSProperties } from 'react';
import type { ActionGroup } from '@pathblender/core';
import { placeLabel, rectsIntersect, type LayoutRect } from '../callout-layout';
import './RobotLabels3D.css';

/** Presentation contract: time and action boundaries belong to the shared core. */
export interface RobotLabel3D {
  id: string;
  identity: string;
  alliance: 'red' | 'blue';
  pathColor: string;
  actions: ActionGroup[];
}

export interface RobotLabelAnchor {
  id: string;
  x: number;
  y: number;
  visible: boolean;
  /** On-screen body radius in CSS px (from camera distance); plates keep clear of it. */
  radius?: number;
}

export interface RobotLabels3DHandle {
  /** Called with the same camera frame as WebGL, without a React render per orbit. */
  place: (anchors: RobotLabelAnchor[], viewport: { w: number; h: number }, reserved?: LayoutRect[]) => void;
}

interface Props {
  labels: RobotLabel3D[];
  currentT: number;
  secondsLabel: string;
  /** Formats the folded-row count when a plate is taller than the viewport allows. */
  moreLabel: (n: number) => string;
}

/* Reviewable UI proposal — screen-fixed sizes, independent of camera zoom.
   The field's camera never scales this DOM layer. */
const PLATE_WIDTH = 184;
const PLATE_MARGIN = 12;
const PLATE_GAP = 10;
/** Keep-clear square half-size around each anchor dot; clamped so a zoomed-in
 *  robot's plate lifts above its body instead of covering it. */
const ANCHOR_MIN_CLEAR = 22;
const ANCHOR_MAX_CLEAR = 260;
/** A plate taller than this fraction of the viewport folds its last action
 *  rows behind a visible "+n" count (2026-10-17: extreme stacks must not run
 *  past the canvas, and must never lose actions or countdowns silently). */
const PLATE_MAX_H_FRACTION = 0.45;
const PLATE_MIN_MAX_H = 132;
/** .robot-label-3d-action + .robot-label-3d-action margin-top. */
const ROW_GAP = 6;
/** Leader corridor padding: the 1.5px ink + 4.5px underlay plus breathing room. */
const LEADER_PAD = 4;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

interface PlacementMemory {
  side: 1 | -1;
  /** Plate offset from the anchor, reused while the ideal spot is contested. */
  dx: number;
  dy: number;
}

export interface LeaderGeometry {
  d: string;
  /** Obstacle corridors for plates placed after this one. */
  segments: LayoutRect[];
}

function segmentRect(a: { x: number; y: number }, b: { x: number; y: number }): LayoutRect {
  return {
    x: Math.min(a.x, b.x) - LEADER_PAD,
    y: Math.min(a.y, b.y) - LEADER_PAD,
    w: Math.abs(a.x - b.x) + 2 * LEADER_PAD,
    h: Math.abs(a.y - b.y) + 2 * LEADER_PAD,
  };
}

/**
 * Anchor dot → plate edge. When the plate sits straight above or below the
 * anchor, the line docks into the plate's horizontal edge (a mostly vertical
 * stroke); otherwise it leaves the nearest vertical edge via a short elbow.
 * The dot always marks the actual projected footprint center.
 */
export function leaderGeometry(anchor: { x: number; y: number }, rect: LayoutRect): LeaderGeometry {
  if (anchor.x >= rect.x - 1 && anchor.x <= rect.x + rect.w + 1) {
    const dockX = clamp(anchor.x, rect.x + 12, rect.x + rect.w - 12);
    const edgeY = anchor.y > rect.y + rect.h / 2 ? rect.y + rect.h : rect.y;
    return {
      d: `M ${anchor.x} ${anchor.y} L ${dockX} ${edgeY}`,
      segments: [segmentRect(anchor, { x: dockX, y: edgeY })],
    };
  }
  const edgeX = anchor.x < rect.x + rect.w / 2 ? rect.x : rect.x + rect.w;
  const edgeY = clamp(anchor.y, rect.y + 12, rect.y + rect.h - 12);
  const elbow = { x: edgeX + (anchor.x < edgeX ? -12 : 12), y: edgeY };
  return {
    d: `M ${anchor.x} ${anchor.y} L ${elbow.x} ${elbow.y} L ${edgeX} ${edgeY}`,
    segments: [segmentRect(anchor, elbow), segmentRect(elbow, { x: edgeX, y: edgeY })],
  };
}

/** What a plate's height depends on: text and wrap, never the camera. The
 *  digit counts cover the one case where the countdown column widens. */
function contentSignature(label: RobotLabel3D, currentT: number, secondsLabel: string): string {
  const digits = (n: number) => String(Math.trunc(Math.max(0, n))).length;
  return `${label.identity}\u0001${secondsLabel}\u0001${digits(currentT)}\u0001`
    + label.actions.map((g) => `${g.actions.map((a) => a.name).join('\u0001')}@${digits(g.endsAt)}`).join('\u0002');
}

function applyFold(card: HTMLElement, k: number, count: number, moreLabel: (n: number) => string) {
  const rows = [...card.querySelectorAll<HTMLElement>('.robot-label-3d-action')];
  rows.forEach((row, i) => { row.hidden = i >= rows.length - k; });
  const more = card.querySelector<HTMLElement>('.robot-label-3d-more');
  if (!more) return;
  more.hidden = k === 0;
  if (k > 0) more.textContent = moreLabel(count);
}

/** Fixed CSS-pixel text above the WebGL canvas; never takes pointer input. */
export const RobotLabels3D = forwardRef<RobotLabels3DHandle, Props>(function RobotLabels3D(
  { labels, currentT, secondsLabel, moreLabel }, ref,
) {
  const cards = useRef(new Map<string, HTMLDivElement>());
  const leaders = useRef(new Map<string, SVGGElement>());
  // Cross-frame layout memory: last side + offset per robot, so orbiting,
  // dense frames and action churn keep every plate where the eye learned it.
  const memory = useRef(new Map<string, PlacementMemory>());
  // Content-signature caches (heights depend on text/wrap, not on the camera):
  // one batched measure per content change instead of per drawn frame.
  const sizes = useRef(new Map<string, { key: string; w: number; h: number; rows: number[] }>());
  const foldedTo = useRef(new Map<string, number>());
  const foldedH = useRef(new Map<string, { key: string; h: number }>());
  // Render-time snapshot for the imperative handle (its closure never re-binds).
  const content = useRef({ sigs: new Map<string, string>(), counts: new Map<string, number[]>(), moreLabel });
  content.current = {
    sigs: new Map(labels.map((label) => [label.id, contentSignature(label, currentT, secondsLabel)])),
    counts: new Map(labels.map((label) => [label.id, label.actions.map((g) => g.actions.length)])),
    moreLabel,
  };

  useImperativeHandle(ref, () => ({
    place(anchors, viewport, reserved = []) {
      const { sigs, counts, moreLabel: formatMore } = content.current;
      const byId = new Map(anchors.map((anchor) => [anchor.id, anchor]));
      for (const id of [...memory.current.keys(), ...sizes.current.keys(), ...foldedTo.current.keys()]) {
        if (!byId.has(id)) {
          memory.current.delete(id);
          sizes.current.delete(id);
          foldedTo.current.delete(id);
          foldedH.current.delete(id);
        }
      }

      // Every visible anchor claims a keep-clear square — plates (own included)
      // never park on a robot body, and slides treat robots as obstacles.
      const anchorRects = new Map<string, LayoutRect>();
      for (const anchor of anchors) {
        if (!anchor.visible || !Number.isFinite(anchor.x) || !Number.isFinite(anchor.y)) continue;
        const r = clamp(anchor.radius ?? ANCHOR_MIN_CLEAR, ANCHOR_MIN_CLEAR, ANCHOR_MAX_CLEAR);
        anchorRects.set(anchor.id, { x: anchor.x - r, y: anchor.y - r, w: 2 * r, h: 2 * r });
      }
      // Hard obstacles (bodies, plates, reserved areas) block everything; leader
      // corridors only steer the search for a *new* spot — a plate returning to
      // its remembered offset wins over a hairline corridor overlap, because a
      // visible jump reads far worse than a line's tail grazing a plate edge.
      const hard = [...reserved, ...anchorRects.values()];
      const corridors: LayoutRect[] = [];
      // Folding threshold: the gentler of 45% of the viewport and a 132px
      // floor — but never more than the viewport can actually show, or a
      // squeezed canvas (narrow windows wrap the toolbar/example notice)
      // would clip folded plates again (browser finding 2026-10-17).
      const cap = Math.min(
        Math.max(PLATE_MIN_MAX_H, Math.round(viewport.h * PLATE_MAX_H_FRACTION)),
        Math.max(60, viewport.h - 2 * PLATE_MARGIN),
      );
      const effW = Math.max(0, Math.min(PLATE_WIDTH, viewport.w - 2 * PLATE_MARGIN));
      const setShown = (id: string, card: HTMLElement, shown: boolean) => {
        card.style.visibility = shown ? 'visible' : 'hidden';
        card.setAttribute('aria-hidden', String(!shown));
        const leader = leaders.current.get(id);
        if (leader) leader.style.visibility = shown ? 'visible' : 'hidden';
      };

      // Phase A — decide who is on screen; unfold cards whose content changed
      // so the measurement below reads their natural height.
      const stale = new Set<string>();
      const plans: { id: string; card: HTMLDivElement; anchor: RobotLabelAnchor; w: number; h: number }[] = [];
      for (const [id, card] of cards.current) {
        const anchor = byId.get(id);
        const rect = anchorRects.get(id);
        if (!anchor || !rect || viewport.w <= 0 || viewport.h <= 0) {
          setShown(id, card, false);
          continue;
        }
        const key = `${sigs.get(id) ?? ''}|${effW}`;
        const cached = sizes.current.get(id);
        if (!cached || cached.key !== key) {
          if (foldedTo.current.get(id)) {
            applyFold(card, 0, 0, formatMore);
            foldedTo.current.set(id, 0);
            foldedH.current.delete(id);
          }
          stale.add(id);
        }
        plans.push({ id, card, anchor, w: 0, h: 0 });
      }

      // Phase B — one batched read pass, stale cards only.
      for (const id of stale) {
        const card = cards.current.get(id);
        if (!card) continue;
        sizes.current.set(id, {
          key: `${sigs.get(id) ?? ''}|${effW}`,
          w: card.offsetWidth,
          h: card.offsetHeight,
          rows: [...card.querySelectorAll<HTMLElement>('.robot-label-3d-action')].map((row) => row.offsetHeight),
        });
      }

      // Phase C — overflow folding: whole trailing rows hide behind a "+n" count.
      for (const plan of plans) {
        const cached = sizes.current.get(plan.id);
        if (!cached) continue;
        let h = cached.h;
        let k = 0;
        if (cached.h > cap && cached.rows.length > 0) {
          const rows = cached.rows;
          const moreRowH = rows[rows.length - 1]! + ROW_GAP;
          while (k < rows.length && h > cap) {
            h -= rows[rows.length - 1 - k]! + ROW_GAP;
            k += 1;
            if (k === 1) h += moreRowH; // the count row takes the first hidden row's place
          }
        }
        if (k > 0) {
          const groupCounts = counts.get(plan.id) ?? [];
          const hidden = groupCounts.slice(groupCounts.length - k).reduce((m, c) => m + c, 0);
          const foldKey = `${cached.key}|${k}|${cap}`;
          if (foldedTo.current.get(plan.id) !== k) {
            applyFold(plan.card, k, hidden, formatMore);
            foldedTo.current.set(plan.id, k);
            h = plan.card.offsetHeight;
            foldedH.current.set(plan.id, { key: foldKey, h });
          } else {
            const fh = foldedH.current.get(plan.id);
            if (fh) {
              if (fh.key !== foldKey) foldedH.current.set(plan.id, { key: foldKey, h: fh.h });
              h = fh.h;
            }
          }
        } else if (foldedTo.current.get(plan.id)) {
          applyFold(plan.card, 0, 0, formatMore);
          foldedTo.current.set(plan.id, 0);
          foldedH.current.delete(plan.id);
        }
        plan.w = cached.w;
        plan.h = h;
      }

      // Phase D — placement writes, in the same robots order every frame.
      const dpr = window.devicePixelRatio || 1;
      const snap = (n: number) => Math.round(n * dpr) / dpr;
      const xMin = PLATE_MARGIN;
      const xMax = Math.max(PLATE_MARGIN, viewport.w - PLATE_MARGIN);
      const yMin = PLATE_MARGIN;
      const yMax = Math.max(PLATE_MARGIN, viewport.h - PLATE_MARGIN);
      for (const plan of plans) {
        const { id, anchor, card, w, h } = plan;
        if (w <= 0 || h <= 0) {
          setShown(id, card, false);
          continue;
        }
        setShown(id, card, true);
        const anchorRect = anchorRects.get(id)!;
        const clear = (x: number, y: number, list: LayoutRect[]) =>
          !list.some((o) => rectsIntersect({ x, y, w, h }, o));
        const all = [...hard, ...corridors];

        // Side stickiness (2026-10-17 browser finding): the side is chosen
        // once, from the anchor's half at first sight, and then remembered —
        // an orbiting camera walks every anchor across the midline, and a
        // plate that swapped sides there was untrackable. Only real
        // congestion (placeLabel's fallback below) may move a plate across.
        const remembered = memory.current.get(id);
        const prefer: 1 | -1 = remembered?.side ?? (anchor.x < viewport.w / 2 ? -1 : 1);
        const offset = Math.max(30, anchorRect.w / 2 + 8);
        const lift = Math.max(32, anchorRect.h / 2 + 10);
        const y0 = anchor.y - h - lift;
        const idealX = clamp(anchor.x + prefer * offset - (prefer < 0 ? w : 0), xMin, Math.max(xMin, xMax - w));
        const idealY = clamp(y0, yMin, Math.max(yMin, yMax - h));

        let placement: { x: number; y: number; side: 1 | -1 };
        if (clear(idealX, idealY, all)) {
          placement = { x: idealX, y: idealY, side: prefer };
        } else {
          const rx = remembered ? clamp(anchor.x + remembered.dx, xMin, Math.max(xMin, xMax - w)) : NaN;
          const ry = remembered ? clamp(anchor.y + remembered.dy, yMin, Math.max(yMin, yMax - h)) : NaN;
          placement = remembered && clear(rx, ry, hard)
            ? { x: rx, y: ry, side: remembered.side }
            : placeLabel({ anchor, offset, size: { w, h }, prefer, y0, canvas: viewport,
              margin: PLATE_MARGIN, gap: PLATE_GAP, obstacles: all });
        }
        memory.current.set(id, { side: placement.side, dx: placement.x - anchor.x, dy: placement.y - anchor.y });

        card.style.transform = `translate(${snap(placement.x)}px, ${snap(placement.y)}px)`;
        hard.push({ x: placement.x, y: placement.y, w, h });
        const geo = leaderGeometry(anchor, { x: placement.x, y: placement.y, w, h });
        for (const segment of geo.segments) corridors.push(segment);
        const leader = leaders.current.get(id);
        leader?.querySelectorAll('path').forEach((node) => node.setAttribute('d', geo.d));
        leader?.querySelectorAll('circle').forEach((node) => {
          node.setAttribute('cx', String(snap(anchor.x)));
          node.setAttribute('cy', String(snap(anchor.y)));
        });
      }
    },
  }), []);

  return <div className="robot-labels-3d">
    <svg className="robot-labels-3d-leaders" aria-hidden="true">
      {labels.map((label) => <g key={label.id} className="robot-labels-3d-leader" data-alliance={label.alliance}
        ref={(el) => { if (el) leaders.current.set(label.id, el); else leaders.current.delete(label.id); }}>
        <path className="robot-labels-3d-leader-underlay" />
        <path className="robot-labels-3d-leader-ink" />
        <circle r="4" className="robot-labels-3d-anchor" />
      </g>)}
    </svg>
    {labels.map((label) => <div key={label.id} className="robot-label-3d" data-robot-id={label.id}
      data-alliance={label.alliance}
      ref={(el) => { if (el) cards.current.set(label.id, el); else cards.current.delete(label.id); }}>
      <div className="robot-label-3d-identity">
        <span className="robot-label-3d-path" style={{ '--robot-path-color': label.pathColor } as CSSProperties} aria-hidden="true" />
        <bdi>{label.identity}</bdi>
      </div>
      {label.actions.length > 0 && <div className="robot-label-3d-actions">
        {label.actions.map((group) => <div className="robot-label-3d-action" key={group.endsAt}>
          <div className="robot-label-3d-action-names">
            {group.actions.map((action, index) => <bdi key={`${action.t}-${index}`}>{action.name}</bdi>)}
          </div>
          <span className="robot-label-3d-time" dir="ltr">
            {Math.max(0, group.endsAt - currentT).toFixed(1)}<span className="robot-label-3d-unit">{secondsLabel}</span>
          </span>
        </div>)}
        {/* Folded-overflow count row; place() reveals it with the hidden count. */}
        <div className="robot-label-3d-more" hidden />
      </div>}
    </div>)}
  </div>;
});
