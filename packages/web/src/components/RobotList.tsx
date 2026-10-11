import { SelectControl } from './SelectControl';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { activeEndT, activeStartT, type CollisionInterval, type RobotGeometry, type SessionTrajectory } from '@pathblender/core';
import { useI18n } from '../i18n';
import { type LibraryProfile } from '../route-library';
import { Icon } from './Icon';
import { RobotContextMenu } from './RobotContextMenu';
import { formatLength, formatLengthNumber, useLengthUnit } from '../length-units';
import './RobotList.css';
import { useTeamOrderUI, type TeamOrderUI } from './TeamOrderUI';
import { inspectorWarnings } from '../robot-profile-ui';
import { robotIdentity, robotOriginalIdentity } from '../robot-identity';

interface RobotListProps {
  teamOrder?: TeamOrderUI;
  robots: SessionTrajectory[];
  conflicts: CollisionInterval[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onImport: () => void;
  /** Target robot → picked settings.json (real parse + apply happens in App). */
  onSelectSettings?: (robotId: string, file: File) => void;
  onUpdate: (id: string, patch: Partial<SessionTrajectory>) => void;
  /** UI navigation; draft lifecycle remains the composer owner's responsibility. */
  onArrange?: (robotId: string) => void;
  /** Optional until removal/history and mirror state are connected by the implementation owner. */
  onRemoveFromMenu?: (robotId: string) => void;
  onMirror?: (robotId: string) => void;
  /** Always-visible card button; App wires it to the same toggle as the context menu. */
  onMirrorButtonClick?: (robotId: string) => void;
  mirroredIds?: ReadonlySet<string>;
  /** Bumped by Edit ▸ Rename Selected Team (menu bar): opens the inline editor. */
  renameSignal?: number;
  /** Optional slot above the list heading — the example session's onboarding card. */
  header?: ReactNode;
}

interface RobotInspectorProps {
  robot: SessionTrajectory | undefined;
  libraryProfiles: LibraryProfile[];
  onApplyProfile: (robotId: string, profileId: string) => void;
}

/** Editable display label; actual team-number/name fields remain independent.
 *  Editing state is owned by the list (not per-cell) so the menu bar's
 *  rename command can open the editor for the selected team. */
function TeamNumberCell({ robot, onUpdate, editing, onStartEdit, onEndEdit, children }: {
  children: ReactNode;
  robot: SessionTrajectory;
  onUpdate: (id: string, patch: Partial<SessionTrajectory>) => void;
  editing: boolean;
  onStartEdit: () => void;
  onEndEdit: () => void;
}) {
  const { t } = useI18n();
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
          onStartEdit();
        }}
      >
        <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M13 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-8M16 3l5 5M10 14l-1 4 4-1 9-9-3-3Z" /></svg>
      </button>
    </div>);
  }
  const commit = () => {
    if (committed.current) return;
    committed.current = true;
    onEndEdit();
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
        if (e.key === 'Escape') { committed.current = true; onEndEdit(); }
      }}
    /></div>
  );
}

/** Selection lives in the workspace so the list, field and inspector agree. */
export function RobotList({ robots, conflicts, selectedId, onSelect, onImport, onUpdate, onSelectSettings, onArrange, onRemoveFromMenu, onMirror, onMirrorButtonClick, mirroredIds, renameSignal, header, teamOrder }: RobotListProps) {  const { t, n, lang } = useI18n();
  const reorder = useTeamOrderUI(teamOrder);
  const settingsInput = useRef<HTMLInputElement>(null);
  const [contextMenu, setContextMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const contextRobot = robots.find((robot) => robot.trajectory.id === contextMenu?.id);
  const settingsRobot = useRef<string | null>(null);
  // Which team's display name is being edited (menu rename command included).
  const [editingId, setEditingId] = useState<string | null>(null);
  useEffect(() => {
    if (renameSignal && selectedId) setEditingId(selectedId);
  }, [renameSignal, selectedId]);
  return (
    <aside className="robot-list robot-library" aria-label={t('robots.title', { n: robots.length })}>
      <input ref={settingsInput} type="file" accept=".json,application/json" hidden aria-label={t('robots.uploadSettings')} onChange={(event) => {
        const file = event.target.files?.[0];
        if (file && settingsRobot.current) onSelectSettings?.(settingsRobot.current, file);
        event.target.value = '';
      }} />
      {header}
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
          {reorder.live}
          {robots.map((robot) => {
            const { trajectory } = robot;
            const needsSettings = (trajectory.source === 'pathplanner-path' || trajectory.source === 'pathplanner-auto') && trajectory.geometrySource !== 'file';
            const hit = conflicts.some((c) => c.aId === trajectory.id || c.bId === trajectory.id);
            const visibilityLabel = t(robot.visible ? 'robots.hide' : 'robots.show', { name: robotIdentity(trajectory) });
            // A composed robot spans waits and segments; its duration is the
            // active window, not the stale single-route trajectory length.
            const composed = !!robot.sequence;
            const shownDuration = composed ? activeEndT(robot) - activeStartT(robot) : trajectory.durationS;
            const selectionLabel = [
              robotIdentity(trajectory),
              sourceLabel(trajectory.source),
              `${n(shownDuration, 2)} s`,
              hit ? t('robots.collision') : '',
            ].filter(Boolean).join(', ');
            return (
              <li {...reorder.row(trajectory.id)} key={trajectory.id} tabIndex={0} aria-label={selectionLabel}
                onClick={(event) => { if (!(event.target as HTMLElement).closest('button, input, select, a, [role="menu"]')) onSelect(trajectory.id); }}
                onContextMenu={(event) => {
                  if ((event.target as HTMLElement).closest('input, select')) return;
                  event.preventDefault(); event.currentTarget.focus();
                  setContextMenu({ id: trajectory.id, x: event.clientX, y: event.clientY });
                }}
                onKeyDown={(event) => {
                  if (event.target !== event.currentTarget) return;
                  if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect(trajectory.id); }
                  if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
                    event.preventDefault(); const rect = event.currentTarget.getBoundingClientRect();
                    setContextMenu({ id: trajectory.id, x: rect.left + 12, y: rect.bottom });
                  }
                }} className={`robot-library-row${needsSettings && onSelectSettings ? ' needs-settings' : ''}${selectedId === trajectory.id ? ' is-selected' : ''}${robot.visible ? '' : ' is-hidden'}`}>
                {reorder.handle(trajectory.id, robotIdentity(trajectory))}
                <TeamNumberCell robot={robot} onUpdate={onUpdate} editing={editingId === trajectory.id} onStartEdit={() => setEditingId(trajectory.id)} onEndEdit={() => setEditingId(null)}>{/* tabindex=-1: the row <li> is the card's single Tab stop; this button stays
                    the programmatic focus anchor (landing, Escape-restore), and its
                    focus ring is drawn on the whole card via :has() (2026-10-07). */}
                <button className="robot-library-select" tabIndex={-1} aria-label={selectionLabel} aria-pressed={selectedId === trajectory.id} onClick={() => onSelect(trajectory.id)}>
                  <span className="band-dot" style={{ background: robot.color }} aria-hidden="true" />
                  <span className="robot-library-content">
                    <span className="robot-library-name" title={robotIdentity(trajectory)}>
                      <span className={trajectory.teamNumber ? "robot-name robot-library-team" : "robot-name"}>{robotIdentity(trajectory)}</span>
                    </span>
                  </span>
                </button></TeamNumberCell>
                <div className="robot-library-actions">
                <button type="button" className="robot-mirror-button" disabled={!onMirrorButtonClick}
                  aria-pressed={mirroredIds?.has(trajectory.id) ?? false}
                  aria-keyshortcuts="m"
                  title={t('robots.mirror')} aria-label={t('robots.mirror')} aria-description={t('robots.mirrorHint')}
                  onClick={() => onMirrorButtonClick?.(trajectory.id)}>
                  <Icon name="mirror" size={17} />
                </button>
                  <button className="robot-library-visibility" aria-label={visibilityLabel} title={visibilityLabel} aria-pressed={robot.visible} aria-keyshortcuts="h" onClick={() => onUpdate(trajectory.id, { visible: !robot.visible })}>
                  <EyeIcon visible={robot.visible} />
                </button>
                </div>
                <button type="button" className="robot-arrange-button" disabled={!onArrange} title={t('sequence.arrange')}
                  aria-keyshortcuts="e"
                  onClick={() => onArrange?.(trajectory.id)}><Icon name="timeline" size={15} /><span>{t('sequence.arrange')}</span></button>
                {needsSettings && onSelectSettings && <button type="button" className="robot-settings-upload" onClick={() => { settingsRobot.current = trajectory.id; settingsInput.current?.click(); }}>
                  <Icon name="import" size={15} />{t('robots.uploadSettings')}
                </button>}
                <div className="robot-library-status"><span className="robot-library-meta">
                  <span>{sourceLabel(trajectory.source)}</span><span>{n(shownDuration, 2)} s</span>
                  {composed && <span>{t('sequence.count', { n: robot.sequence!.segments.length })}</span>}
                  {hit && <span className="robot-library-conflict">{t('robots.collision')}</span>}
                </span>{needsSettings && <span className="robot-library-settings-missing">{t('robots.settingsNotImported')}</span>}</div>
              </li>
            );
          })}
        </ul>
      )}
      {contextMenu && contextRobot && <RobotContextMenu name={robotIdentity(contextRobot.trajectory)} x={contextMenu.x} y={contextMenu.y}
        mirrored={mirroredIds?.has(contextRobot.trajectory.id)}
        onArrange={onArrange ? () => onArrange(contextRobot.trajectory.id) : undefined}
        onMirror={onMirror ? () => onMirror(contextRobot.trajectory.id) : undefined}
        onRemove={onRemoveFromMenu ? () => onRemoveFromMenu(contextRobot.trajectory.id) : undefined}
        onClose={() => setContextMenu(null)} />}
    </aside>
  );
}

export function RobotInspector({ robot, libraryProfiles, onApplyProfile }: RobotInspectorProps) {
  const { t, n, lang } = useI18n();
  const [unit] = useLengthUnit();
  const uid = useId();
  if (!robot) return <div className="robot-inspector-empty">{t('robots.selectPrompt')}</div>;
  const { trajectory } = robot;
  const id = trajectory.id;
  const fileGeometry = trajectory.geometrySource === 'file';
  const warnings = inspectorWarnings(trajectory.warnings);

  return (
    <section className="robot-inspector" key={id} aria-label={trajectory.name}>
      <header className="robot-inspector-heading">
        <span className="band-dot" style={{ background: robot.color }} aria-hidden="true" />
        <h2>{robotOriginalIdentity(trajectory)}</h2>
      </header>

      <section className="robot-inspector-section">
        <div className="robot-inspector-section-heading">
          <h3>{t('robots.data')}</h3>
          <span className={`robot-data-source${fileGeometry ? ' is-verified' : ' is-missing'}`}>{fileGeometry ? t('robots.fromFile') : <><Icon name="warning" size={13} />{t('robots.notUploaded')}</>}</span>
        </div>
        <p className="robot-inspector-caption">{t('robots.bumper')}</p>
        <dl className="robot-dimensions">
          <div className={`robot-dimension-card ${fileGeometry ? 'is-verified' : 'is-default'}`}><dt>{t('robots.length')}</dt><dd>{formatLength(trajectory.geometry.lengthM, unit, lang)}</dd></div>
          <div className={`robot-dimension-card ${fileGeometry ? 'is-verified' : 'is-default'}`}><dt>{t('robots.width')}</dt><dd>{formatLength(trajectory.geometry.widthM, unit, lang)}</dd></div>
          {trajectory.massKG !== undefined && <div><dt>{t('robots.mass')}</dt><dd>{n(trajectory.massKG, 0)} kg</dd></div>}
          {trajectory.holonomic !== undefined && <div><dt>{t('robots.drive')}</dt><dd>{t(trajectory.holonomic ? 'robots.driveHolonomic' : 'robots.driveDifferential')}</dd></div>}
        </dl>
        {libraryProfiles.length > 0 && (
          <div className="robot-inspector-row robot-inspector-profile">
            <span id={`${uid}-profile-label`}>{t('robots.applyProfile')}</span>
            <SelectControl
              aria-labelledby={`${uid}-profile-label`}
              value=""
              title={t('robots.applyProfileHint')}
              onValueChange={(value) => {
                if (value) onApplyProfile(id, value);
              }}
            >
              <option value="">{t('robots.profilePick')}</option>
              {libraryProfiles.map((entry) => (
                <option key={entry.id} value={entry.id} title={entry.relPath}>
                  {entry.profile.name} · {formatLengthNumber(entry.profile.geometry.lengthM, unit, lang)}×{formatLengthNumber(entry.profile.geometry.widthM, unit, lang)} {unit}
                </option>
              ))}
            </SelectControl>
          </div>
        )}
        {warnings.length > 0 && (
          <ul className="robot-inspector-warnings">{warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul>
        )}
      </section>
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
