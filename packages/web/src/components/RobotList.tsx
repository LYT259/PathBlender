import { useEffect, useState } from 'react';
import type { CollisionInterval, RobotGeometry, SessionTrajectory } from '@pathblender/core';
import { useI18n } from '../i18n';
import { VIEWER_ONLY } from '../viewer';
import { displayName, type LibraryProfile, type LibraryRoute } from '../route-library';
import './RobotList.css';

interface RobotListProps {
  robots: SessionTrajectory[];
  conflicts: CollisionInterval[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onImport: () => void;
  onUpdate: (id: string, patch: Partial<SessionTrajectory>) => void;
  libraryRoutes: LibraryRoute[];
  libraryProfiles: LibraryProfile[];
  /** Robot slot id → library route id. */
  onPickRoute: (robotId: string, routeId: string) => void;
  onAddRoute: (routeId: string) => void;
}

interface RobotInspectorProps {
  robot: SessionTrajectory | undefined;
  editingId: string | null;
  onUpdate: (id: string, patch: Partial<SessionTrajectory>) => void;
  onSetAlliance: (id: string, alliance: 'blue' | 'red') => void;
  onSetGeometry: (id: string, patch: Partial<RobotGeometry>) => void;
  onSetTeamNumber: (id: string, teamNumber: string) => void;
  onToggleEdit: (id: string) => void;
  onResetEdit: (id: string) => void;
  onExport: (id: string, format: 'path' | 'traj' | 'ghostauto') => void;
  onRemove: (id: string) => void;
  libraryProfiles: LibraryProfile[];
  onApplyProfile: (robotId: string, profileId: string) => void;
}

/** Selection lives in the workspace so the list, field and inspector agree. */
export function RobotList({ robots, conflicts, selectedId, onSelect, onImport, onUpdate, libraryRoutes, libraryProfiles, onPickRoute, onAddRoute }: RobotListProps) {
  const { t } = useI18n();
  return (
    <aside className="robot-list robot-library" aria-label={t('robots.title', { n: robots.length })}>
      <div className="robot-library-heading">
        <h2>{t('robots.title', { n: robots.length })}</h2>
        <button className="robot-library-add" onClick={onImport} title={t('robots.import')} aria-label={t('robots.import')}>
          <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M10 4v12M4 10h12" /></svg>
        </button>
      </div>
      {robots.length === 0 ? (
        <div className="robot-library-empty">
          <p>{t('robots.empty')}</p>
          <button className="btn small" onClick={onImport}>{t('robots.import')}</button>
        </div>
      ) : (
        <ul className="robot-library-items">
          {robots.map((robot) => {
            const { trajectory } = robot;
            const hit = conflicts.some((c) => c.aId === trajectory.id || c.bId === trajectory.id);
            const visibilityLabel = t(robot.visible ? 'robots.hide' : 'robots.show', { name: trajectory.name });
            const selectionLabel = [
              trajectory.teamNumber ? `#${trajectory.teamNumber} ${trajectory.name}` : trajectory.name,
              sourceLabel(trajectory.source),
              `${trajectory.durationS.toFixed(2)} s`,
              hit ? t('robots.collision') : '',
            ].filter(Boolean).join(', ');
            const currentRoute = libraryRoutes.find((r) => r.id === robot.routeId);
            return (
              <li key={trajectory.id} className={`robot-library-row${selectedId === trajectory.id ? ' is-selected' : ''}${robot.visible ? '' : ' is-hidden'}`}>
                <button className="robot-library-select" aria-label={selectionLabel} aria-pressed={selectedId === trajectory.id} onClick={() => onSelect(trajectory.id)}>
                  <span className="band-dot" style={{ background: robot.color }} aria-hidden="true" />
                  <span className="robot-library-content">
                    <span className="robot-library-name" title={trajectory.name}>
                      {trajectory.teamNumber && <strong className="robot-library-team">#{trajectory.teamNumber}</strong>}
                      <span className="robot-name">{trajectory.name}</span>
                    </span>
                    <span className="robot-library-meta">
                      <span>{sourceLabel(trajectory.source)}</span>
                      <span>{trajectory.durationS.toFixed(2)} s</span>
                      {hit && <span className="robot-library-conflict">{t('robots.collision')}</span>}
                    </span>
                  </span>
                </button>
                {libraryRoutes.length > 0 && (
                  <select
                    className="route-picker"
                    value={robot.routeId ?? ''}
                    title={currentRoute ? currentRoute.relPath : t('library.routeOffLibrary')}
                    aria-label={t('library.routePicker', { name: trajectory.name })}
                    onChange={(e) => onPickRoute(trajectory.id, e.target.value)}
                  >
                    {!currentRoute && <option value="">{displayName(trajectory)}</option>}
                    {libraryRoutes.map((route) => (
                      <option key={route.id} value={route.id} title={route.relPath}>
                        {displayName(route.trajectory)} · {route.trajectory.durationS.toFixed(1)} s
                      </option>
                    ))}
                  </select>
                )}
                <button className="robot-library-visibility" aria-label={visibilityLabel} title={visibilityLabel} aria-pressed={robot.visible} onClick={() => onUpdate(trajectory.id, { visible: !robot.visible })}>
                  <EyeIcon visible={robot.visible} />
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {(libraryRoutes.length > 0 || libraryProfiles.length > 0) && (
        <section className="route-library-panel" aria-label={t('library.title')}>
          <h3>{t('library.title', { n: libraryRoutes.length })}</h3>
          {libraryRoutes.length > 0 && (
            <ul className="route-library-items">
              {libraryRoutes.map((route) => (
                <li key={route.id} className="route-library-item" title={route.relPath}>
                  <span className="route-library-item-body">
                    <span className="route-library-item-name">{displayName(route.trajectory)}</span>
                    <span className="route-library-item-meta">{sourceLabel(route.trajectory.source)} · {route.trajectory.durationS.toFixed(1)} s</span>
                  </span>
                  <button className="route-library-add-btn" onClick={() => onAddRoute(route.id)} aria-label={t('library.add', { name: displayName(route.trajectory) })} title={t('library.add', { name: displayName(route.trajectory) })}>+</button>
                </li>
              ))}
            </ul>
          )}
          {libraryProfiles.length > 0 && (
            <ul className="route-library-items route-library-profiles">
              {libraryProfiles.map((entry) => (
                <li key={entry.id} className="route-library-item" title={entry.relPath}>
                  <span className="route-library-item-body">
                    <span className="route-library-item-name">{entry.profile.name}</span>
                    <span className="route-library-item-meta">{t('robots.profileEntry', { l: entry.profile.geometry.lengthM.toFixed(2), w: entry.profile.geometry.widthM.toFixed(2) })}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="route-library-note">{t('library.hint')}</p>
        </section>
      )}
    </aside>
  );
}

export function RobotInspector({ robot, editingId, onUpdate, onSetAlliance, onSetGeometry, onSetTeamNumber, onToggleEdit, onResetEdit, onExport, onRemove, libraryProfiles, onApplyProfile }: RobotInspectorProps) {
  const { t } = useI18n();
  if (!robot) return <div className="robot-inspector-empty">{t('robots.selectPrompt')}</div>;
  const { trajectory } = robot;
  const id = trajectory.id;
  const fileGeometry = trajectory.geometrySource === 'file';

  return (
    <section className="robot-inspector" key={id} aria-label={trajectory.name}>
      <header className="robot-inspector-heading">
        <span className="band-dot" style={{ background: robot.color }} aria-hidden="true" />
        <h2>{trajectory.name}</h2>
        {trajectory.edited && <span className="adjusted-badge">{t('robots.adjusted')}</span>}
      </header>
      <section className="robot-inspector-section">
        <h3>{t('robots.identity')}</h3>
        {trajectory.teamName && <p className="robot-inspector-team-name">{trajectory.teamName}</p>}
        <label className="robot-inspector-row">
          <span>{t('robots.teamNumber')}</span>
          <input type="text" inputMode="numeric" maxLength={5} placeholder="—" value={trajectory.teamNumber} onChange={(event) => onSetTeamNumber(id, event.target.value.replace(/\D/g, '').slice(0, 5))} />
        </label>
        <div className="robot-inspector-row">
          <span>{t('robots.alliance')}</span>
          {VIEWER_ONLY ? <span>{t(trajectory.alliance === 'blue' ? 'robots.blue' : 'robots.red')}</span> : (
            <div className="seg" role="group" aria-label={t('robots.alliance')}>
              <button className={trajectory.alliance === 'blue' ? 'on-blue' : ''} aria-pressed={trajectory.alliance === 'blue'} onClick={() => onSetAlliance(id, 'blue')}>{t('robots.blue')}</button>
              <button className={trajectory.alliance === 'red' ? 'on-red' : ''} aria-pressed={trajectory.alliance === 'red'} onClick={() => onSetAlliance(id, 'red')}>{t('robots.red')}</button>
            </div>
          )}
        </div>
      </section>

      <section className="robot-inspector-section">
        <h3>{t('robots.timing')}</h3>
        <div className="robot-inspector-row">
          <span>{t('robots.delay')}</span>
          {VIEWER_ONLY ? <span>{robot.startDelayS.toFixed(2)} s</span> : (
            <NumberField label={t('robots.delay')} value={robot.startDelayS} min={0} step={0.1} onCommit={(value) => onUpdate(id, { startDelayS: value })} />
          )}
        </div>
        {!VIEWER_ONLY && <p className="robot-inspector-note">{t('robots.delayHint')}</p>}
      </section>

      <section className="robot-inspector-section">
        <div className="robot-inspector-section-heading">
          <h3>{t('robots.data')}</h3>
          <span className={`robot-data-source${fileGeometry ? '' : ' is-estimated'}`}>{t(fileGeometry ? 'robots.fromFile' : 'robots.bumperDefault')}</span>
        </div>
        <p className="robot-inspector-caption">{t('robots.bumper')}</p>
        {fileGeometry || VIEWER_ONLY ? (
          <dl className="robot-dimensions">
            <div><dt>{t('robots.length')}</dt><dd>{trajectory.geometry.lengthM.toFixed(2)} m</dd></div>
            <div><dt>{t('robots.width')}</dt><dd>{trajectory.geometry.widthM.toFixed(2)} m</dd></div>
          </dl>
        ) : (
          <div className="robot-dimensions robot-dimensions-editable">
            <label><span>{t('robots.length')}</span><NumberField label={t('robots.length')} value={trajectory.geometry.lengthM} min={0.2} max={2} step={0.01} onCommit={(value) => onSetGeometry(id, { lengthM: value })} /></label>
            <label><span>{t('robots.width')}</span><NumberField label={t('robots.width')} value={trajectory.geometry.widthM} min={0.2} max={2} step={0.01} onCommit={(value) => onSetGeometry(id, { widthM: value })} /></label>
          </div>
        )}
        <p className="robot-inspector-note">{t(fileGeometry ? 'robots.fileDataNote' : 'robots.defaultDataNote')}</p>
        {libraryProfiles.length > 0 && (
          <label className="robot-inspector-row robot-inspector-profile">
            <span>{t('robots.applyProfile')}</span>
            <select
              aria-label={t('robots.applyProfile')}
              value=""
              title={t('robots.applyProfileHint')}
              onChange={(event) => {
                if (event.target.value) onApplyProfile(id, event.target.value);
                event.target.value = '';
              }}
            >
              <option value="">{t('robots.profilePick')}</option>
              {libraryProfiles.map((entry) => (
                <option key={entry.id} value={entry.id} title={entry.relPath}>
                  {entry.profile.name} · {entry.profile.geometry.lengthM.toFixed(2)}×{entry.profile.geometry.widthM.toFixed(2)} m
                </option>
              ))}
            </select>
          </label>
        )}
        {trajectory.warnings.length > 0 && (
          <ul className="robot-inspector-warnings">{trajectory.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul>
        )}
      </section>

      {!VIEWER_ONLY && (
        <section className="robot-inspector-section robot-inspector-actions">
          <h3>{t('robots.actions')}</h3>
          <button className="btn robot-inspector-edit" disabled={!trajectory.editable} title={trajectory.editable ? undefined : t('robots.editUnavailable')} onClick={() => onToggleEdit(id)}>
            {t(editingId === id ? 'robots.doneEdit' : 'robots.editPath')}
          </button>
          {!trajectory.editable && <p className="robot-inspector-note">{t('robots.editUnavailable')}</p>}
          {trajectory.edited && <button className="btn small" onClick={() => onResetEdit(id)}>{t('robots.resetEdit')}</button>}
          <div className="robot-inspector-export">
            <span>{t('robots.export')}</span>
            <div className="robot-export-options" role="group" aria-label={t('robots.export')}>
              <button className="btn small" disabled={trajectory.editable?.kind !== 'pathplanner'} title={trajectory.editable?.kind === 'pathplanner' ? undefined : t('robots.exportNoSource')} onClick={() => onExport(id, 'path')}>.path</button>
              <button className="btn small" disabled={trajectory.editable?.kind !== 'choreo'} title={trajectory.editable?.kind === 'choreo' ? undefined : t('robots.exportNoSource')} onClick={() => onExport(id, 'traj')}>.traj</button>
              <button className="btn small" onClick={() => onExport(id, 'ghostauto')}>.ghostauto</button>
            </div>
          </div>
          <button className="robot-inspector-remove" onClick={() => onRemove(id)}>{t('robots.removeFromSession')}</button>
        </section>
      )}
    </section>
  );
}

/** Keep incomplete numeric text local; commit only a complete, bounded value. */
function NumberField({ label, value, min, max = Infinity, step, onCommit }: { label: string; value: number; min: number; max?: number; step: number; onCommit: (value: number) => void }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const commit = () => {
    const parsed = draft.trim() === '' ? NaN : Number(draft);
    const next = Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : value;
    setDraft(String(next));
    if (next !== value) onCommit(next);
  };
  return <input type="number" aria-label={label} value={draft} min={min} max={Number.isFinite(max) ? max : undefined} step={step} onChange={(event) => setDraft(event.target.value)} onBlur={commit} onKeyDown={(event) => {
    if (event.key === 'Enter') event.currentTarget.blur();
    if (event.key === 'Escape') setDraft(String(value));
  }} />;
}

function EyeIcon({ visible }: { visible: boolean }) {
  return <svg viewBox="0 0 20 20" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M2 10s3-5 8-5 8 5 8 5-3 5-8 5-8-5-8-5Z" /><circle cx="10" cy="10" r="2.2" />{!visible && <path d="m3 3 14 14" />}</svg>;
}

function sourceLabel(source: SessionTrajectory['trajectory']['source']): string {
  switch (source) {
    case 'choreo-traj': return 'Choreo';
    case 'ghostauto': return 'Ghost';
    case 'pathplanner-path': return 'PathPlanner';
    case 'pathplanner-auto': return 'PP Auto';
  }
}
