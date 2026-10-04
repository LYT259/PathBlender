import { useRef, useState, type ReactNode } from 'react';
import { activeEndT, activeStartT, type CollisionInterval, type RobotGeometry, type SessionTrajectory } from '@pathblender/core';
import { useI18n } from '../i18n';
import { VIEWER_ONLY } from '../viewer';
import { displayName, routeLabel, sameRouteTrajectory, type LibraryProfile } from '../route-library';
import { formatLength, formatLengthNumber, useLengthUnit } from '../length-units';
import './RobotList.css';
import { robotIdentity, robotOriginalIdentity } from '../robot-identity';
import { AutoSequenceEditor, type AutoSequenceEditorProps } from './AutoSequenceEditor';

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
  sequence: AutoSequenceEditorProps;
}

/** Editable display label; actual team-number/name fields remain independent. */
function TeamNumberCell({ robot, onUpdate, children, metadata }: {
  children: ReactNode;
  metadata: ReactNode;
  robot: SessionTrajectory;
  onUpdate: (id: string, patch: Partial<SessionTrajectory>) => void;
}) {
  const { t } = useI18n();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(robot.trajectory.displayName ?? robot.trajectory.teamNumber);
  const committed = useRef(false);
  if (!editing) {
    return (<div className="robot-identity-cell">
      {children}
      <button
        className="robot-team-chip"
        title={t('robots.teamNumberEdit')}
        aria-label={t('robots.teamNumberEdit')}
        onClick={() => {
          committed.current = false;
          setDraft(robot.trajectory.displayName ?? robot.trajectory.teamNumber);
          setEditing(true);
        }}
      >
        <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M13 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-8M16 3l5 5M10 14l-1 4 4-1 9-9-3-3Z" /></svg>
      </button>
      {metadata}
    </div>);
  }
  const commit = () => {
    if (committed.current) return;
    committed.current = true;
    setEditing(false);
    const v = draft.trim();
    // Empty input restores the original identity; it never creates a new placeholder.
    if (v !== (robot.trajectory.displayName ?? robot.trajectory.teamNumber)) {
      onUpdate(robot.trajectory.id, { trajectory: { ...robot.trajectory, displayName: v || undefined } });
    }
  };
  return (
    <div className="robot-team-editor"><span className="band-dot" style={{ background: robot.color }} aria-hidden="true" /><input
      className="robot-team-input"
      value={draft}
      placeholder={robot.trajectory.teamNumber}
      maxLength={64}
      autoFocus
      aria-label={t('robots.teamNumberEdit')}
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.nativeEvent.isComposing || e.keyCode === 229) return;
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
            // A composed robot spans waits and segments; its duration is the
            // active window, not the stale single-route trajectory length.
            const composed = !!robot.sequence && robot.sequence.segments.length > 0;
            const shownDuration = composed ? activeEndT(robot) - activeStartT(robot) : trajectory.durationS;
            const selectionLabel = [
              robotIdentity(trajectory),
              sourceLabel(trajectory.source),
              `${shownDuration.toFixed(2)} s`,
              hit ? t('robots.collision') : '',
            ].filter(Boolean).join(', ');
            const libraryRoutes = robot.routeOptions ?? [];
            // No stored routeId? The current trajectory may still BE one of
            // the library options (welcome example, pre-routeId sessions) —
            // select that option instead of adding a duplicate pseudo-entry.
            const currentRoute = libraryRoutes.find((r) => r.id === robot.routeId)
              ?? libraryRoutes.find((r) => sameRouteTrajectory(r.trajectory, trajectory));
            return (
              <li key={trajectory.id} className={`robot-library-row${selectedId === trajectory.id ? ' is-selected' : ''}${robot.visible ? '' : ' is-hidden'}`}>
                <TeamNumberCell robot={robot} onUpdate={onUpdate} metadata={<span className="robot-library-meta">
                      <span>{sourceLabel(trajectory.source)}</span>
                      <span>{shownDuration.toFixed(2)} s</span>
                      {composed && <span>{t('sequence.count', { n: robot.sequence!.segments.length })}</span>}
                      {hit && <span className="robot-library-conflict">{t('robots.collision')}</span>}
                    </span>}><button className="robot-library-select" aria-label={selectionLabel} aria-pressed={selectedId === trajectory.id} onClick={() => onSelect(trajectory.id)}>
                  <span className="band-dot" style={{ background: robot.color }} aria-hidden="true" />
                  <span className="robot-library-content">
                    <span className="robot-library-name" title={robotIdentity(trajectory)}>
                      <span className={trajectory.teamNumber ? "robot-name robot-library-team" : "robot-name"}>{robotIdentity(trajectory)}</span>
                    </span>
                  </span>
                </button></TeamNumberCell>
                {libraryRoutes.length > 0 && (
                  <select
                    className="route-picker"
                    value={robot.routeId ?? currentRoute?.id ?? ''}
                    // A composed robot plays its sequence, not the picked
                    // route; switching here would silently fight the
                    // composition, so the picker hands over to the details
                    // panel until the arrangement is removed.
                    disabled={composed}
                    title={composed ? t('sequence.pickerDisabled') : currentRoute ? currentRoute.relPath : t('library.routeOffLibrary')}
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

export function RobotInspector({ robot, onRemove, libraryProfiles, onApplyProfile, sequence }: RobotInspectorProps) {
  const { t } = useI18n();
  const [unit] = useLengthUnit();
  if (!robot) return <div className="robot-inspector-empty">{t('robots.selectPrompt')}</div>;
  const { trajectory } = robot;
  const id = trajectory.id;
  const fileGeometry = trajectory.geometrySource === 'file';

  return (
    <section className="robot-inspector" key={id} aria-label={trajectory.name}>
      <header className="robot-inspector-heading">
        <span className="band-dot" style={{ background: robot.color }} aria-hidden="true" />
        <h2>{robotOriginalIdentity(trajectory)}</h2>
      </header>
      <AutoSequenceEditor key={id} {...sequence} />

      <section className="robot-inspector-section">
        <div className="robot-inspector-section-heading">
          <h3>{t('robots.data')}</h3>
          <span className={`robot-data-source${fileGeometry ? '' : ' is-estimated'}`}>{t(fileGeometry ? 'robots.fromFile' : 'robots.bumperDefault')}</span>
        </div>
        <p className="robot-inspector-caption">{t('robots.bumper')}</p>
        <dl className="robot-dimensions">
          <div><dt>{t('robots.length')}</dt><dd>{formatLength(trajectory.geometry.lengthM, unit)}</dd></div>
          <div><dt>{t('robots.width')}</dt><dd>{formatLength(trajectory.geometry.widthM, unit)}</dd></div>
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
                  {entry.profile.name} · {formatLengthNumber(entry.profile.geometry.lengthM, unit)}×{formatLengthNumber(entry.profile.geometry.widthM, unit)} {unit}
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
