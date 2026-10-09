import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { useI18n } from '../i18n';
import './TeamOrderUI.css';

/** View-only contract. Owner supplies the displayed IDs and commits a move;
 * no trajectory, playback, history or persistence writes belong here — see
 * team-order.ts for the one place the array is reshuffled. */
export interface TeamOrderUI {
  ids: string[];
  onMove: (id: string, targetId: string, edge: 'before' | 'after') => void;
}

/** Pointer travel before a press becomes a drag, mirroring the native DnD
 * hysteresis so plain clicks never flicker a ghost. */
const DRAG_THRESHOLD_PX = 6;
/** The ghost rides the cursor at the same offset the native drag image used
 * (setDragImage(row, 12, 12): image point (12,12) sat under the pointer). */
const GHOST_OFFSET = 12;

export function useTeamOrderUI(order?: TeamOrderUI) {
  const { t } = useI18n();
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<{ id: string; edge: 'before' | 'after' } | null>(null);
  const [announcement, setAnnouncement] = useState('');
  /** Tears down an in-flight pointer drag (listeners + ghost + body class);
   * swapped in on each drag start and re-run on unmount so a drag can never
   * outlive the component that started it. */
  const teardownRef = useRef<() => void>(() => {});
  useEffect(() => () => teardownRef.current(), []);
  const clear = () => { setDragging(null); setOver(null); teardownRef.current(); };

  /** Pointer-driven row drag. A native HTML5 drag session is exactly what
   * macOS decorated with a meaningless "0 items" count badge (the page
   * registers no drag items), and it sits in the WKWebView layer that broke
   * row reorder in #306 — so the reorder never starts a system drag at all:
   * after a small hysteresis the row clones into a fixed-position ghost that
   * follows the pointer, a window-level move tracks the row under the pointer
   * for the edge indicator, and pointer-up commits the same onMove call the
   * old drop handler did. */
  const beginPointerDrag = (id: string) => (event: ReactPointerEvent<HTMLElement>) => {
    if (!order || order.ids.length < 2 || !event.isPrimary || event.button !== 0) return;
    const startX = event.clientX;
    const startY = event.clientY;
    const rowEl = event.currentTarget.closest<HTMLElement>('[data-team-order-id]');
    const listEl = rowEl?.parentElement ?? null;
    let active = false;
    let ghost: HTMLElement | null = null;
    let current: { id: string; edge: 'before' | 'after' } | null = null;

    const positionGhost = (x: number, y: number) => {
      ghost?.style.setProperty('transform', `translate3d(${x - GHOST_OFFSET}px, ${y - GHOST_OFFSET}px, 0)`);
    };
    const updateOver = (x: number, y: number) => {
      const row = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-team-order-id]') ?? null;
      const targetId = row?.dataset.teamOrderId ?? null;
      let next: { id: string; edge: 'before' | 'after' } | null = null;
      if (row && targetId && targetId !== id) {
        const rect = row.getBoundingClientRect();
        next = { id: targetId, edge: y < rect.top + rect.height / 2 ? 'before' : 'after' };
      } else if (!row && listEl) {
        next = nearestRow(listEl, id, x, y);
      }
      if (next?.id !== current?.id || next?.edge !== current?.edge) {
        current = next;
        setOver(next);
      }
    };
    const start = () => {
      active = true;
      setDragging(id);
      document.body.classList.add('team-order-drag-active');
      if (rowEl) {
        ghost = document.createElement('div');
        ghost.className = 'team-order-ghost';
        ghost.setAttribute('aria-hidden', 'true');
        ghost.style.width = `${rowEl.offsetWidth}px`;
        ghost.appendChild(rowEl.cloneNode(true));
        document.body.appendChild(ghost);
        positionGhost(startX, startY);
      }
    };
    const finish = (commit: boolean) => {
      if (active && commit && current && current.id !== id) order.onMove(id, current.id, current.edge);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('keydown', onKey, true);
      document.body.classList.remove('team-order-drag-active');
      ghost?.remove();
      ghost = null;
      current = null;
      setDragging(null);
      setOver(null);
    };
    const onMove = (e: PointerEvent) => {
      if (!active) {
        if (Math.hypot(e.clientX - startX, e.clientY - startY) < DRAG_THRESHOLD_PX) return;
        start();
      } else {
        e.preventDefault();
      }
      positionGhost(e.clientX, e.clientY);
      updateOver(e.clientX, e.clientY);
    };
    const onUp = () => finish(true);
    const onCancel = () => finish(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        finish(false);
      }
    };
    window.addEventListener('pointermove', onMove, { passive: false });
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    window.addEventListener('keydown', onKey, true);
    teardownRef.current = () => finish(false);
  };

  return {
    /** Rendered once per list: the polite channel a keyboard move speaks its
     * new position into. Only the list whose handle was pressed carries text,
     * so a move is announced exactly once. */
    live: order && <span aria-live="polite" className="team-order-live">{announcement}</span>,
    row: (id: string) => order ? {
      'data-team-order-id': id,
      'data-order-dragging': dragging === id || undefined,
      'data-order-edge': over?.id === id && dragging !== id ? over.edge : undefined,
    } : {},
    handle: (id: string, name: string) => order && <button type="button" className="team-order-handle"
      disabled={order.ids.length < 2}
      title={t('robots.reorderHandle', { name, position: order.ids.indexOf(id) + 1, total: order.ids.length })}
      aria-label={t('robots.reorderHandle', { name, position: order.ids.indexOf(id) + 1, total: order.ids.length })}
      aria-keyshortcuts="ArrowUp ArrowDown"
      onClick={event => event.stopPropagation()} onDoubleClick={event => event.stopPropagation()}
      onPointerDown={beginPointerDrag(id)}
      onKeyDown={event => {
        if (event.key === 'Escape') { clear(); return; }
        if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
        event.preventDefault(); event.stopPropagation();
        const offset = event.key === 'ArrowUp' ? -1 : 1;
        const target = order.ids[order.ids.indexOf(id) + offset];
        if (!target) return;
        const edge = offset < 0 ? 'before' : 'after';
        const position = landing(order.ids, id, target, edge);
        if (position === null) return;
        order.onMove(id, target, edge);
        setAnnouncement(t('robots.reorderMoved', { name, position: position + 1, total: order.ids.length }));
        // React moves (never remounts) the focused button when the list
        // re-renders in the new order; re-asserting focus covers the engines
        // that drop it on a DOM move so arrow keys stay on this handle.
        event.currentTarget.focus();
      }}>
      <svg width="12" height="16" viewBox="0 0 12 16" fill="currentColor" aria-hidden="true">
        {[4, 8, 12].flatMap(y => [4, 8].map(x => <circle key={`${x}-${y}`} cx={x} cy={y} r="1" />))}
      </svg>
    </button>,
  };
}

/** The 0-based index a keyboard move lands at, or null when the move is a
 * no-op (already on that edge of the target) — mirrors moveTeamOrder's
 * same-reference suppression so the screen reader never announces a move
 * that did not happen. */
const landing = (ids: string[], id: string, targetId: string, edge: 'before' | 'after'): number | null => {
  const from = ids.indexOf(id);
  const to = ids.indexOf(targetId);
  if (from < 0 || to < 0) return null;
  if (edge === 'before' ? from === to - 1 : from === to + 1) return null;
  // The moved slot vacates its own index first; a target below it shifts
  // up by one before the insert.
  return (from < to ? to - 1 : to) + (edge === 'after' ? 1 : 0);
};

/** Pointer outside every row — below the last row (the timeline's ruler
 * strip), above the first, or in a gap between the sidebar cards: the
 * vertical position still names an insertion point. Dragged under the whole
 * list the user plainly means "put me last" (user 2026-10-09), so the row
 * nearest the pointer vertically, within the list's horizontal span, carries
 * the indicator; moveTeamOrder's same-reference check absorbs the no-ops
 * (e.g. the last row dropped below itself). */
function nearestRow(list: HTMLElement, draggedId: string, x: number, y: number): { id: string; edge: 'before' | 'after' } | null {
  const scope = list.getBoundingClientRect();
  if (x < scope.left || x > scope.right) return null;
  let best: { id: string; edge: 'before' | 'after' } | null = null;
  let bestDistance = Infinity;
  for (const row of Array.from(list.querySelectorAll<HTMLElement>('[data-team-order-id]'))) {
    const rowId = row.dataset.teamOrderId;
    if (!rowId || rowId === draggedId) continue;
    const rect = row.getBoundingClientRect();
    const edge = y < rect.top + rect.height / 2 ? 'before' : 'after';
    const distance = edge === 'before' ? rect.top - y : y - rect.bottom;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = { id: rowId, edge };
    }
  }
  return best;
}
