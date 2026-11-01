import { forwardRef, useImperativeHandle, useRef, type CSSProperties } from 'react';
import type { ActionGroup } from '@pathblender/core';
import type { LayoutRect } from '../callout-layout';
import { ROBOT_LABEL_STYLE, robotLabelCssVars } from '../robot-label-style';
import {
  ROBOT_LABEL_MARGIN, anchorClearRect, placeRobotLabel, plateHeightCap,
  type RobotLabelFrame, type RobotLabelMemory,
} from '../robot-label-layout';
export { leaderGeometry } from '../robot-label-leader';
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
   The field's camera never scales this DOM layer. Placement rules, margins
   and the folding threshold live in robot-label-layout.ts, shared with 2D. */
const PLATE_WIDTH = ROBOT_LABEL_STYLE.maxWidth;
const PLATE_MARGIN = ROBOT_LABEL_MARGIN;
/** .robot-label-3d-action + .robot-label-3d-action margin-top. */
const ROW_GAP = ROBOT_LABEL_STYLE.rowGap;

type PlacementMemory = RobotLabelMemory;

/** What a plate's height depends on: text and wrap, never the camera. The
 *  digit counts cover the one case where the countdown column widens. */
function contentSignature(label: RobotLabel3D, currentT: number, secondsLabel: string): string {
  const digits = (n: number) => Math.max(0, n).toFixed(1).length;
  return `${label.identity}\u0001${secondsLabel}\u0001${digits(currentT)}\u0001`
    + label.actions.map((g) => `${g.actions.map((a) => a.name).join('\u0001')}@${digits(g.endsAt - currentT)}`).join('\u0002');
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
        anchorRects.set(anchor.id, anchorClearRect(anchor, anchor.radius));
      }
      // Hard obstacles (bodies, plates, reserved areas) block everything; leader
      // corridors only steer the search for a new spot (robot-label-layout.ts).
      const frame: RobotLabelFrame = { hard: [...reserved, ...anchorRects.values()], corridors: [] };
      const cap = plateHeightCap(viewport.h);
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
          card.style.width = ''; // Measure natural content width before locking it for this content.
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
          // Round upward: offsetWidth rounds down some natural widths,
          // forcing a final glyph onto another line when width is locked.
          w: Math.ceil(card.getBoundingClientRect().width || card.offsetWidth),
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
        // Keep the unfolded width while folding; otherwise max-content would
        // shrink behind the placement cache and move the leader off its edge.
        plan.card.style.width = `${cached.w}px`;
        plan.w = cached.w;
        plan.h = h;
      }

      // Phase D — placement writes, in the same robots order every frame.
      const dpr = window.devicePixelRatio || 1;
      const snap = (n: number) => Math.round(n * dpr) / dpr;
      for (const plan of plans) {
        const { id, anchor, card, w, h } = plan;
        if (w <= 0 || h <= 0) {
          setShown(id, card, false);
          continue;
        }
        setShown(id, card, true);
        const anchorRect = anchorRects.get(id)!;
        const placed = placeRobotLabel({
          anchor, clear: anchorRect.w / 2, size: { w, h }, viewport,
          remembered: memory.current.get(id), frame,
        });
        memory.current.set(id, placed.memory);

        card.style.transform = `translate(${snap(placed.rect.x)}px, ${snap(placed.rect.y)}px)`;
        const leader = leaders.current.get(id);
        leader?.querySelectorAll('path').forEach((node) => node.setAttribute('d', placed.leader.d));
        leader?.querySelectorAll('circle').forEach((node) => {
          node.setAttribute('cx', String(snap(anchor.x)));
          node.setAttribute('cy', String(snap(anchor.y)));
        });
      }
    },
  }), []);

  return <div className="robot-labels-3d" style={robotLabelCssVars as CSSProperties}>
    <svg className="robot-labels-3d-leaders" aria-hidden="true">
      {labels.map((label) => <g key={label.id} className="robot-labels-3d-leader" data-alliance={label.alliance}
        ref={(el) => { if (el) leaders.current.set(label.id, el); else leaders.current.delete(label.id); }}>
        <path className="robot-labels-3d-leader-underlay" />
        <path className="robot-labels-3d-leader-ink" />
        <circle r={ROBOT_LABEL_STYLE.anchorRadius} className="robot-labels-3d-anchor" />
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
