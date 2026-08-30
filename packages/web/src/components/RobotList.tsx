import { useState } from 'react';
import type { CollisionInterval, RobotGeometry, SessionTrajectory } from '@pathblender/core';
import { useI18n } from '../i18n';

interface Props {
  robots: SessionTrajectory[];
  conflicts: CollisionInterval[];
  editingId: string | null;
  onUpdate: (id: string, patch: Partial<SessionTrajectory>) => void;
  onSetAlliance: (id: string, alliance: 'blue' | 'red') => void;
  onSetGeometry: (id: string, patch: Partial<RobotGeometry>) => void;
  onSetTeamNumber: (id: string, teamNumber: string) => void;
  onToggleEdit: (id: string) => void;
  onResetEdit: (id: string) => void;
  onExport: (id: string, format: 'path' | 'traj' | 'ghostauto') => void;
  onRemove: (id: string) => void;
}

export function RobotList({
  robots,
  conflicts,
  editingId,
  onUpdate,
  onSetAlliance,
  onSetGeometry,
  onSetTeamNumber,
  onToggleEdit,
  onResetEdit,
  onExport,
  onRemove,
}: Props) {
  const { t } = useI18n();
  // Choreo-style: rows stay compact; details unfold under the selected row.
  // Rows are open by default (fresh imports are one click from edits); the
  // set only remembers what the user deliberately collapsed.
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());

  const toggle = (id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <aside className="robot-list">
      <h2>{t('robots.title', { n: robots.length })}</h2>
      {robots.map((r) => {
        const hit = conflicts.some(
          (c) => c.aId === r.trajectory.id || c.bId === r.trajectory.id,
        );
        const open = !collapsed.has(r.trajectory.id);
        return (
          <div
            key={r.trajectory.id}
            className={`robot-card ${hit ? 'has-conflict' : ''} ${open ? 'open' : ''}`}
          >
            <div
              className="robot-head"
              role="button"
              tabIndex={0}
              aria-expanded={open}
              aria-label={r.trajectory.name}
              onClick={() => toggle(r.trajectory.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') toggle(r.trajectory.id);
              }}
            >
              <span className="band-dot" style={{ background: r.color }} />
              <span className="robot-name" title={r.trajectory.name}>
                {r.trajectory.name}
              </span>
              <span className={`source-badge src-${r.trajectory.source}`}>
                {sourceLabel(r.trajectory.source)}
              </span>
              {hit && (
                <span className="conflict-dot" title={t('robots.collision')}>
                  ●
                </span>
              )}
              <span className={`chev ${open ? 'open' : ''}`}>▸</span>
              <button
                className="btn icon danger robot-remove"
                title={t('robots.remove')}
                onClick={(e) => {
                  e.stopPropagation();
                  onRemove(r.trajectory.id);
                }}
              >
                ✕
              </button>
            </div>

            {open && (
              <div className="robot-body">
                <div className="robot-meta">
                  {r.trajectory.teamName && <span>{r.trajectory.teamName}</span>}
                  <span>{r.trajectory.durationS.toFixed(2)} s</span>
                  {hit && <span className="conflict-tag">{t('robots.collision')}</span>}
                </div>

                {r.trajectory.warnings.map((w, i) => (
                  <div key={i} className="robot-warning">⚠ {w}</div>
                ))}

                <div className="robot-row">
                  <label>{t('robots.alliance')}</label>
                  <div className="seg">
                    <button
                      className={r.trajectory.alliance === 'blue' ? 'on-blue' : ''}
                      onClick={() => onSetAlliance(r.trajectory.id, 'blue')}
                    >
                      {t('robots.blue')}
                    </button>
                    <button
                      className={r.trajectory.alliance === 'red' ? 'on-red' : ''}
                      onClick={() => onSetAlliance(r.trajectory.id, 'red')}
                    >
                      {t('robots.red')}
                    </button>
                  </div>
                </div>

                <div className="robot-row">
                  <label>{t('robots.teamNumber')}</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={5}
                    placeholder="—"
                    value={r.trajectory.teamNumber}
                    title={t('robots.teamNumber')}
                    onChange={(e) =>
                      onSetTeamNumber(
                        r.trajectory.id,
                        e.target.value.replace(/\D/g, '').slice(0, 5),
                      )
                    }
                  />
                </div>

                <div className="robot-row">
                  <label>{t('robots.delay')}</label>
                  <input
                    type="number"
                    min={0}
                    step={0.1}
                    value={r.startDelayS}
                    onChange={(e) =>
                      onUpdate(r.trajectory.id, {
                        startDelayS: Math.max(0, Number(e.target.value) || 0),
                      })
                    }
                  />
                </div>

                <div className="robot-row geom">
                  <label>
                    {t('robots.bumper')}
                    {r.trajectory.geometrySource === 'default' && (
                      <span className="geom-note">{t('robots.bumperDefault')}</span>
                    )}
                  </label>
                  <span className="geom-inputs">
                    <input
                      type="number"
                      min={0.2}
                      max={2}
                      step={0.01}
                      value={r.trajectory.geometry.lengthM}
                      title={t('robots.length')}
                      onChange={(e) =>
                        onSetGeometry(r.trajectory.id, {
                          lengthM: clampMeters(e.target.value),
                        })
                      }
                    />
                    ×
                    <input
                      type="number"
                      min={0.2}
                      max={2}
                      step={0.01}
                      value={r.trajectory.geometry.widthM}
                      title={t('robots.width')}
                      onChange={(e) =>
                        onSetGeometry(r.trajectory.id, {
                          widthM: clampMeters(e.target.value),
                        })
                      }
                    />
                  </span>
                </div>

                <label className="switch robot-visible">
                  <input
                    type="checkbox"
                    checked={r.visible}
                    onChange={(e) => onUpdate(r.trajectory.id, { visible: e.target.checked })}
                  />
                  <span className="sw-track" aria-hidden="true" />
                  <span className="sw-text">{t('robots.visible')}</span>
                </label>

                <div className="robot-row edit-row">
                  <button
                    className="btn small"
                    disabled={!r.trajectory.editable}
                    title={
                      r.trajectory.editable
                        ? undefined
                        : t('robots.editUnavailable')
                    }
                    onClick={() => onToggleEdit(r.trajectory.id)}
                  >
                    {editingId === r.trajectory.id
                      ? t('robots.doneEdit')
                      : t('robots.editPath')}
                  </button>
                  {r.trajectory.edited && (
                    <>
                      <span className="adjusted-badge">{t('robots.adjusted')}</span>
                      <button
                        className="btn small"
                        onClick={() => onResetEdit(r.trajectory.id)}
                      >
                        {t('robots.resetEdit')}
                      </button>
                    </>
                  )}
                </div>

                <div className="robot-row export-row">
                  <label>{t('robots.export')}</label>
                  <span className="seg">
                    <button
                      disabled={r.trajectory.editable?.kind !== 'pathplanner'}
                      title={r.trajectory.editable?.kind === 'pathplanner' ? undefined : t('robots.exportNoSource')}
                      onClick={() => onExport(r.trajectory.id, 'path')}
                    >
                      .path
                    </button>
                    <button
                      disabled={r.trajectory.editable?.kind !== 'choreo'}
                      title={r.trajectory.editable?.kind === 'choreo' ? undefined : t('robots.exportNoSource')}
                      onClick={() => onExport(r.trajectory.id, 'traj')}
                    >
                      .traj
                    </button>
                    <button onClick={() => onExport(r.trajectory.id, 'ghostauto')}>
                      .ghostauto
                    </button>
                  </span>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </aside>
  );
}

function clampMeters(v: string): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0.9;
  return Math.min(2, Math.max(0.2, n));
}

function sourceLabel(source: SessionTrajectory['trajectory']['source']): string {
  switch (source) {
    case 'choreo-traj': return 'Choreo';
    case 'ghostauto': return 'Ghost';
    case 'pathplanner-path': return 'PP';
    case 'pathplanner-auto': return 'PP Auto';
  }
}
