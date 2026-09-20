import { useEffect, useState } from 'react';
import type { SessionTrajectory } from '@pathblender/core';
import { useI18n } from '../i18n';
interface Props {
  robot: SessionTrajectory;
  onEditWaypoint: (id: string, idx: number, pos: { x: number; y: number }, kind: 'anchor' | 'prevControl' | 'nextControl') => void;
  onAddWaypoint: (id: string, afterIdx: number) => void;
  onRemoveWaypoint: (id: string, idx: number) => void;
}
export function WaypointPanel({ robot, onEditWaypoint, onAddWaypoint, onRemoveWaypoint }: Props) {
  const { t } = useI18n();
  const e = robot.trajectory.editable;
  const id = robot.trajectory.id;
  const ppWaypoints = e?.kind === 'pathplanner' ? e.path.waypoints : [];
  const choreoWaypoints = e?.kind === 'choreo' ? e.waypoints : [];
  const waypointCount = ppWaypoints.length || choreoWaypoints.length;
  return (
        <aside className="waypoint-panel">
          <h2>
            {t('editor.waypoints')} ({waypointCount})
          </h2>
          {e?.kind === 'pathplanner' &&
            ppWaypoints.map((wp, i) => (
              <PpRow
                key={i}
                idx={i}
                anchor={wp.anchor}
                prev={wp.prevControl}
                next={wp.nextControl}
                onEdit={(pos, kind) => onEditWaypoint(id, i, pos, kind)}
                onRemove={() => onRemoveWaypoint(id, i)}
                canRemove={ppWaypoints.length > 2}
                labels={{
                  prev: t('editor.prevCtl'),
                  next: t('editor.nextCtl'),
                  remove: t('robots.remove'),
                }}
              />
            ))}
          {e?.kind === 'choreo' &&
            choreoWaypoints.map((wp, i) => (
              <ChoreoRow
                key={i}
                idx={i}
                wp={wp}
                onEdit={(pos) => onEditWaypoint(id, i, pos, 'anchor')}
                onRemove={() => onRemoveWaypoint(id, i)}
                canRemove={choreoWaypoints.length > 2}
                labels={{ heading: t('editor.heading'), remove: t('robots.remove') }}
              />
            ))}
          <button
            className="btn small editor-add"
            onClick={() => onAddWaypoint(id, waypointCount - 1)}
          >
            + {t('editor.add')}
          </button>
        </aside>
  );
}

/** Numeric field that commits on blur/Enter (typing doesn't regenerate). */
function Num({
  value,
  onCommit,
  label,
}: {
  value: number;
  onCommit: (v: number) => void;
  label?: string;
}) {
  const [draft, setDraft] = useState(value.toFixed(2));
  useEffect(() => setDraft(value.toFixed(2)), [value]);
  const commit = () => {
    const n = Number(draft);
    if (draft.trim() !== '' && Number.isFinite(n) && Math.abs(n - value) > 1e-6) onCommit(n);
    else setDraft(value.toFixed(2));
  };
  return (
    <input
      type="text"
      inputMode="decimal"
      aria-label={label}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
      }}
    />
  );
}

function PpRow({
  idx,
  anchor,
  prev,
  next,
  onEdit,
  onRemove,
  canRemove,
  labels,
}: {
  idx: number;
  anchor: { x: number; y: number };
  prev: { x: number; y: number } | null;
  next: { x: number; y: number } | null;
  onEdit: (pos: { x: number; y: number }, kind: 'anchor' | 'prevControl' | 'nextControl') => void;
  onRemove: () => void;
  canRemove: boolean;
  labels: { prev: string; next: string; remove: string };
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`wp-row ${open ? 'open' : ''}`}>
      <div className="wp-head">
        <button className="wp-toggle" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <span className="wp-idx">{idx + 1}</span>
        <span className="wp-coords">
          {anchor.x.toFixed(2)}, {anchor.y.toFixed(2)}
        </span>
        <span className={`chev ${open ? 'open' : ''}`}>▸</span>
        </button>
        <button
          className="robot-remove"
          title={labels.remove}
          disabled={!canRemove}
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
        >
          ✕
        </button>
      </div>
      {open && (
        <div className="wp-body">
          <div className="wp-nums">
            <Num label="x" value={anchor.x} onCommit={(x) => onEdit({ x, y: anchor.y }, 'anchor')} />
            <Num label="y" value={anchor.y} onCommit={(y) => onEdit({ x: anchor.x, y }, 'anchor')} />
          </div>
          {prev && (
            <div className="wp-ctl">
              <span>{labels.prev}</span>
              <div className="wp-nums">
                <Num label="prev x" value={prev.x} onCommit={(x) => onEdit({ x, y: prev.y }, 'prevControl')} />
                <Num label="prev y" value={prev.y} onCommit={(y) => onEdit({ x: prev.x, y }, 'prevControl')} />
              </div>
            </div>
          )}
          {next && (
            <div className="wp-ctl">
              <span>{labels.next}</span>
              <div className="wp-nums">
                <Num label="next x" value={next.x} onCommit={(x) => onEdit({ x, y: next.y }, 'nextControl')} />
                <Num label="next y" value={next.y} onCommit={(y) => onEdit({ x: next.x, y }, 'nextControl')} />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ChoreoRow({
  idx,
  wp,
  onEdit,
  onRemove,
  canRemove,
  labels,
}: {
  idx: number;
  wp: { x: number; y: number; heading: number };
  onEdit: (pos: { x: number; y: number }) => void;
  onRemove: () => void;
  canRemove: boolean;
  labels: { heading: string; remove: string };
}) {
  const deg = (wp.heading * 180) / Math.PI;
  return (
    <div className="wp-row">
      <div className="wp-head-static">
        <span className="wp-idx">{idx + 1}</span>
        <div className="wp-nums">
          <Num label="x" value={wp.x} onCommit={(x) => onEdit({ x, y: wp.y })} />
          <Num label="y" value={wp.y} onCommit={(y) => onEdit({ x: wp.x, y })} />
          {/* Core supports position edits for Choreo; heading is shown read-only. */}
          <span className="wp-heading" title={labels.heading}>
            {deg.toFixed(0)}°
          </span>
        </div>
        <button className="robot-remove" title={labels.remove} disabled={!canRemove} onClick={onRemove}>
          ✕
        </button>
      </div>
    </div>
  );
}
