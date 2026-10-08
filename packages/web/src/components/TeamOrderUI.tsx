import { useState, type DragEvent } from 'react';
import { useI18n } from '../i18n';
import './TeamOrderUI.css';

/** View-only contract. Owner supplies the displayed IDs and commits a move;
 * no trajectory, playback, history or persistence writes belong here — see
 * team-order.ts for the one place the array is reshuffled. */
export interface TeamOrderUI {
  ids: string[];
  onMove: (id: string, targetId: string, edge: 'before' | 'after') => void;
}
const MIME = 'application/x-pathblender-team-order';

export function useTeamOrderUI(order?: TeamOrderUI) {
  const { t } = useI18n();
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<{ id: string; edge: 'before' | 'after' } | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const clear = () => { setDragging(null); setOver(null); };
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
  return {
    /** Rendered once per list: the polite channel a keyboard move speaks its
     * new position into. Only the list whose handle was pressed carries text,
     * so a move is announced exactly once. */
    live: order && <span aria-live="polite" className="team-order-live">{announcement}</span>,
    row: (id: string) => order ? {
      'data-team-order-id': id,
      'data-order-dragging': dragging === id || undefined,
      'data-order-edge': over?.id === id && dragging !== id ? over.edge : undefined,
      onDragOver: (event: DragEvent<HTMLElement>) => {
        // Only our own custom MIME participates; file drags fall through to
        // the window import handler untouched.
        if (!dragging || !event.dataTransfer.types.includes(MIME)) return;
        event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = 'move';
        const rect = event.currentTarget.getBoundingClientRect();
        setOver({ id, edge: event.clientY < rect.top + rect.height / 2 ? 'before' : 'after' });
      },
      onDragLeave: (event: DragEvent<HTMLElement>) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOver(null);
      },
      onDrop: (event: DragEvent<HTMLElement>) => {
        if (!dragging) return;
        event.preventDefault(); event.stopPropagation();
        if (over && dragging !== id) order.onMove(dragging, id, over.edge);
        clear();
      },
    } : {},
    handle: (id: string, name: string) => order && <button type="button" className="team-order-handle"
      draggable={order.ids.length > 1} disabled={order.ids.length < 2}
      title={t('robots.reorderHandle', { name, position: order.ids.indexOf(id) + 1, total: order.ids.length })}
      aria-label={t('robots.reorderHandle', { name, position: order.ids.indexOf(id) + 1, total: order.ids.length })}
      aria-keyshortcuts="ArrowUp ArrowDown"
      onClick={event => event.stopPropagation()} onDoubleClick={event => event.stopPropagation()}
      onDragStart={event => {
        event.stopPropagation(); event.dataTransfer.setData(MIME, id); event.dataTransfer.effectAllowed = 'move';
        const row = event.currentTarget.closest('[data-team-order-id]');
        if (row) event.dataTransfer.setDragImage(row, 12, 12);
        setDragging(id);
      }} onDragEnd={clear}
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
