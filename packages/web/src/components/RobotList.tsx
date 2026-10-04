import { useRef, useState, type ReactNode } from 'react';
import type { CollisionInterval, RobotGeometry, SessionTrajectory } from '@pathblender/core';
import { useI18n } from '../i18n';
import { VIEWER_ONLY } from '../viewer';
import { displayName, routeLabel, type LibraryProfile } from '../route-library';
import './RobotList.css';
import { robotIdentity } from '../robot-identity';

interface RobotListProps {
  robots: SessionTrajectory[];
  conflicts: CollisionInterval[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onImport: () => void;
  onUpdate: (id: string, patch: Partial<SessionTrajectory>) => void;
  /** Robot slot id → library route id. */
  onPickRoute: (robotId: string, routeId: string) => void;
}

interface RobotInspectorProps {
  robot: SessionTrajectory | undefined;
  onRemove: (id: string) => void;
  libraryProfiles: LibraryProfile[];
  onApplyProfile: (robotId: string, profileId: string) => void;
}

/**
 * Team-number chip + pencil on each robot row: click to edit inline.
 * Restores metadata editing per the 2026-10-02 user request (the viewer
 * pivot removed PATH editing — this only annotates identity; the number
 * also prints on the robot's bumper). Digits only, max 5, Enter/blur
 * commits, Escape discards.
 */
function TeamNumberCell({ robot, onUpdate, children }: {
  children: ReactNode;
  robot: SessionTrajectory;
  onUpdate: (id: string, patch: Partial<SessionTrajectory>) => void;
}) {
  const { t } = useI18n();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(robot.trajectory.teamNumber);
  const committed = useRef(false);
  if (!editing) {
    return (<>
      {children}
      <button
        className="robot-team-chip"
        title={t('robots.teamNumberEdit')}
        aria-label={t('robots.teamNumberEdit')}
        onClick={() => {
          committed.current = false;
          setDraft(/^[A-Z]{6}$/.test(robot.trajectory.teamNumber) ? '' : robot.trajectory.teamNumber);
          setEditing(true);
        }}
      >
        <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M13 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-8M16 3l5 5M10 14l-1 4 4-1 9-9-3-3Z" /></svg>
      </button>
    </>);
  }
  const commit = () => {
    if (committed.current) return;
    committed.current = true;
    setEditing(false);
    const v = draft.replace(/\D/g, '').slice(0, 5);
    if (!v && /^[A-Z]{6}$/.test(robot.trajectory.teamNumber)) return;
    if (v !== robot.trajectory.teamNumber) {
      onUpdate(robot.trajectory.id, { trajectory: { ...robot.trajectory, teamNumber: v } });
    }
  };
  return (
    <div className="robot-team-editor"><span className="band-dot" style={{ background: robot.color }} aria-hidden="true" /><input
      className="robot-team-input"
      value={draft}
      placeholder={/^[A-Z]{6}$/.test(robot.trajectory.teamNumber) ? robot.trajectory.teamNumber : undefined}
      inputMode="numeric"
      maxLength={5}
      autoFocus
      aria-label={t('robots.teamNumberEdit')}
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setDraft(e.target.value.replace(/\D/g, '').slice(0, 5))}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit();
        if (e.key === 'Escape') { committed.current = true; setEditing(false); }
      }}
    /></div>
  );
}

/** Selection lives in the workspace so the list, field and inspector agree. */
export function RobotList({ robots, conflicts, selectedId, onSelect, onImport, onUpdate, onPickRoute }: RobotListProps) {
  const { t } = useI18n();
  return (
    <aside className="robot-list robot-library" aria-label={t('robots.title', { n: robots.length })}>
      <div className="robot-library-heading">
        <h2>{t('robots.title', { n: robots.length })}</h2>
        {robots.length > 0 && <button className="robot-library-add" onClick={onImport} title={t('robots.import')} aria-label={t('robots.import')}>
          <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M10 4v12M4 10h12" /></svg>
        </button>}
      </div>
      {robots.length === 0 ? (
        <div className="robot-library-empty">
          <p>{t('robots.empty')}</p>
        </div>
      ) : (
        <ul className="robot-library-items">
          {robots.map((robot) => {
            const { trajectory } = robot;
            const hit = conflicts.some((c) => c.aId === trajectory.id || c.bId === trajectory.id);
            const visibilityLabel = t(robot.visible ? 'robots.hide' : 'robots.show', { name: robotIdentity(trajectory) });
            const selectionLabel = [
              robotIdentity(trajectory),
              sourceLabel(trajectory.source),
              `${trajectory.durationS.toFixed(2)} s`,
              hit ? t('robots.collision') : '',
            ].filter(Boolean).join(', ');
            const libraryRoutes = robot.routeOptions ?? [];
            const currentRoute = libraryRoutes.find((r) => r.id === robot.routeId);
            return (
              <li key={trajectory.id} className={`robot-library-row${selectedId === trajectory.id ? ' is-selected' : ''}${robot.visible ? '' : ' is-hidden'}`}>
                <TeamNumberCell robot={robot} onUpdate={onUpdate}><button className="robot-library-select" aria-label={selectionLabel} aria-pressed={selectedId === trajectory.id} onClick={() => onSelect(trajectory.id)}>
                  <span className="band-dot" style={{ background: robot.color }} aria-hidden="true" />
                  <span className="robot-library-content">
                    <span className="robot-library-name" title={trajectory.name}>
                      <span className={trajectory.teamNumber ? "robot-name robot-library-team" : "robot-name"}>{robotIdentity(trajectory)}</span>
                    </span>
                    <span className="robot-library-meta">
                      <span>{sourceLabel(trajectory.source)}</span>
                      <span>{trajectory.durationS.toFixed(2)} s</span>
                      {hit && <span className="robot-library-conflict">{t('robots.collision')}</span>}
                    </span>
                  </span>
                </button></TeamNumberCell>
                {libraryRoutes.length > 0 && (
                  <select
                    className="route-picker"
                    value={robot.routeId ?? ''}
                    title={currentRoute ? currentRoute.relPath : t('library.routeOffLibrary')}
                    aria-label={t('library.routePicker', { name: robotIdentity(trajectory) })}
                    onChange={(e) => onPickRoute(trajectory.id, e.target.value)}
                  >
                    {!currentRoute && <option value="">{displayName(trajectory)}</option>}
                    {libraryRoutes.map((route) => (
                      <option key={route.id} value={route.id} title={route.relPath}>
                        {routeLabel(route, libraryRoutes)}
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

    </aside>
  );
}

export function RobotInspector({ robot, onRemove, libraryProfiles, onApplyProfile }: RobotInspectorProps) {
  const { t } = useI18n();
  if (!robot) return <div className="robot-inspector-empty">{t('robots.selectPrompt')}</div>;
  const { trajectory } = robot;
  const id = trajectory.id;
  const fileGeometry = trajectory.geometrySource === 'file';

  return (
    <section className="robot-inspector" key={id} aria-label={trajectory.name}>
      <header className="robot-inspector-heading">
        <span className="band-dot" style={{ background: robot.color }} aria-hidden="true" />
        <h2>{robotIdentity(trajectory)}</h2>
      </header>
      <section className="robot-inspector-section">
        <h3>{t('robots.identity')}</h3>
        {trajectory.teamName && <p className="robot-inspector-team-name">{trajectory.teamName}</p>}
        <div className="robot-inspector-row">
          <span>{t('robots.teamNumber')}</span>
          <span>{trajectory.teamNumber || '—'}</span>
        </div>
        <div className="robot-inspector-row">
          <span>{t('robots.alliance')}</span>
          <span>{t(trajectory.alliance === 'blue' ? 'robots.blue' : 'robots.red')}</span>
        </div>
      </section>

      <section className="robot-inspector-section">
        <h3>{t('robots.timing')}</h3>
        <div className="robot-inspector-row">
          <span>{t('robots.delay')}</span>
          <span>{robot.startDelayS.toFixed(2)} s</span>
        </div>
      </section>

      <section className="robot-inspector-section">
        <div className="robot-inspector-section-heading">
          <h3>{t('robots.data')}</h3>
          <span className={`robot-data-source${fileGeometry ? '' : ' is-estimated'}`}>{t(fileGeometry ? 'robots.fromFile' : 'robots.bumperDefault')}</span>
        </div>
        <p className="robot-inspector-caption">{t('robots.bumper')}</p>
        <dl className="robot-dimensions">
          <div><dt>{t('robots.length')}</dt><dd>{trajectory.geometry.lengthM.toFixed(2)} m</dd></div>
          <div><dt>{t('robots.width')}</dt><dd>{trajectory.geometry.widthM.toFixed(2)} m</dd></div>
          {trajectory.massKG !== undefined && <div><dt>{t('robots.mass')}</dt><dd>{trajectory.massKG.toFixed(0)} kg</dd></div>}
          {trajectory.holonomic !== undefined && <div><dt>{t('robots.drive')}</dt><dd>{t(trajectory.holonomic ? 'robots.driveHolonomic' : 'robots.driveDifferential')}</dd></div>}
        </dl>
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
          <button className="robot-inspector-remove" onClick={() => onRemove(id)}>{t('robots.removeFromSession')}</button>
        </section>
      )}
    </section>
  );
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
