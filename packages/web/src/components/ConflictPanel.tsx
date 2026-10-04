import { robotIdentity } from '../robot-identity';
import type { ReactNode } from 'react';
import type { CollisionInterval, OutOfBoundsInterval, SessionTrajectory } from '@pathblender/core';
import { useI18n } from '../i18n';
import { formatLength, useLengthUnit } from '../length-units';
import { VIEWER_ONLY } from '../viewer';
import { Icon } from './Icon';

interface Props {
  robots: SessionTrajectory[];
  conflicts: CollisionInterval[];
  bounds: OutOfBoundsInterval[];
  minSeparation?: { aId: string; bId: string; distanceM: number; t: number };
  onJump: (t: number, robotIds?: string[]) => void;
  guide?: ReactNode;
  /** ±δ start-execution window for the worst-case rescan (§6.5-①). */
  toleranceS?: number;
  onToleranceChange?: (delta: number) => void;
}

export function ConflictPanel({ robots, conflicts, bounds, minSeparation, onJump, guide, toleranceS = 0, onToleranceChange }: Props) {
  const { t } = useI18n();
  const [unit] = useLengthUnit();
  const nameOf = (id: string) => {
    const robot = robots.find((r) => r.trajectory.id === id);
    return robot ? robotIdentity(robot.trajectory) : '?';
  };
  const issues = conflicts.length + bounds.length;
  const hidden = robots.filter((r) => !r.visible).length;
  const estimated = robots.some((r) => r.trajectory.geometrySource === 'default');
  const title = !robots.length ? 'checks.emptyTitle' : issues ? 'checks.issues' : robots.length < 2 ? 'checks.singleTitle' : 'checks.clearTitle';
  const body = !robots.length ? 'checks.emptyBody' : robots.length < 2 ? 'checks.singleBody' : 'checks.clearBody';
  return <section className="conflict-panel" aria-label={t('conflicts.title')}>
    <div className={`check-summary ${issues ? 'has-issues' : robots.length > 1 ? 'is-clear' : ''}`}>
      <div className="check-summary-icon"><Icon name={issues ? 'warning' : robots.length > 1 ? 'check' : 'path'} size={24} /></div>
      <h2>{t(title, { n: issues })}</h2>
      {!issues && <p>{t(body)}</p>}
      {!!robots.length && <small>{t('workspace.analysisScope', { n: robots.length })}</small>}
      {hidden > 0 && <small>{t('checks.hidden', { n: hidden })}</small>}
    </div>
    {guide}
    {estimated && <p className="check-data-note"><Icon name="warning" size={15} />{t('checks.estimated')}</p>}
    {!!robots.length && <h3 className="check-section-heading">{t('conflicts.title')}<span className={`conflict-count ${conflicts.length ? 'bad' : ''}`}>{conflicts.length}</span></h3>}
    {robots.length >= 2 && (
      <label className="tolerance-row">
        <span className="tolerance-label">{t('checks.tolerance')}</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.1}
          value={toleranceS}
          onChange={(e) => onToleranceChange?.(Number(e.target.value))}
          aria-label={t('checks.tolerance')}
        />
        <span className="tolerance-value">±{toleranceS.toFixed(1)} s</span>
      </label>
    )}
    {conflicts.length > 0 && <ul className="conflict-list">{conflicts.map((c) => <li key={`${c.aId}-${c.bId}-${c.startT}-${c.kind}`} className={`conflict-item${c.kind === 'tolerance' ? ' is-tolerance' : ''}`}>
      <button className="conflict-jump" onClick={() => onJump(c.closestT, [c.aId, c.bId])} title={t('checks.jump')}>
        <span className="conflict-pair">{t('conflicts.pair', { a: nameOf(c.aId), b: nameOf(c.bId) })}{c.kind === 'tolerance' && <em className="tolerance-badge">{t('conflicts.toleranceBadge', { delta: c.toleranceS ?? toleranceS })}</em>}</span>
        <span className="conflict-when">{t('conflicts.item', { start: c.startT.toFixed(2), end: c.endT.toFixed(2), d: formatLength(c.minCenterDistanceM, unit), x: ((c.closestA.x + c.closestB.x) / 2).toFixed(1), y: ((c.closestA.y + c.closestB.y) / 2).toFixed(1) })}</span>
        <span className="issue-action">{t('checks.jump')} →</span>
      </button>
    </li>)}</ul>}
    {bounds.length > 0 && <><h3 className="check-section-heading">{t('bounds.title')}<span className="conflict-count bounds-count">{bounds.length}</span></h3><ul className="conflict-list">{bounds.map((b) => <li key={`${b.robotId}-${b.startT}`} className="conflict-item"><button className="conflict-jump bounds" onClick={() => onJump((b.startT + b.endT) / 2, [b.robotId])}><span className="conflict-pair">{nameOf(b.robotId)}</span><span className="conflict-when">{t('bounds.item', { start: b.startT.toFixed(2), end: b.endT.toFixed(2), depth: formatLength(b.maxPenetrationM, unit), edge: b.edges.map((e) => t(`edges.${e}` as const)).join('/') })}</span><span className="issue-action">{t('checks.jump')} →</span></button></li>)}</ul></>}
    {minSeparation && <p className="min-sep">{t('conflicts.minSep', { d: formatLength(minSeparation.distanceM, unit), t: minSeparation.t.toFixed(2), a: nameOf(minSeparation.aId), b: nameOf(minSeparation.bId) })}</p>}
  </section>;
}
