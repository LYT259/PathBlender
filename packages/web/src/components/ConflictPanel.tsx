import { robotIdentity } from '../robot-identity';
import type { ReactNode } from 'react';
import type { CollisionInterval, FieldObstacle, ObstacleCollisionInterval, OutOfBoundsInterval, SessionTrajectory } from '@pathblender/core';
import { useI18n } from '../i18n';
import { formatLength, useLengthUnit } from '../length-units';
import { Icon } from './Icon';

interface Props {
  robots: SessionTrajectory[];
  conflicts: CollisionInterval[];
  bounds: OutOfBoundsInterval[];
  obstacleHits?: ObstacleCollisionInterval[];
  /** Obstacle definitions of the active field — the section hides on fields
   *  that carry none (custom fields, older seasons without a model). */
  obstacleDefs?: readonly FieldObstacle[];
  onJump: (t: number, robotIds?: string[]) => void;
  guide?: ReactNode;
  /** ±δ start-execution window for the worst-case rescan (§6.5-①). */
  toleranceS?: number;
  onToleranceChange?: (delta: number) => void;
}

export function ConflictPanel({ robots, conflicts, bounds, obstacleHits = [], obstacleDefs = [], onJump, guide, toleranceS = 0, onToleranceChange }: Props) {
  const { t, n, lang } = useI18n();
  const [unit] = useLengthUnit();
  const nameOf = (id: string) => {
    const robot = robots.find((r) => r.trajectory.id === id);
    return robot ? robotIdentity(robot.trajectory) : '?';
  };
  const issues = conflicts.length + bounds.length + obstacleHits.length;
  const hidden = robots.filter((r) => !r.visible).length;
  const estimated = robots.some((r) => r.trajectory.geometrySource === 'default');
  // Relation badges only once the session actually uses per-team alliances —
  // legacy single-alliance sessions see exactly the panel they saw before.
  const usesTeamAlliances = robots.some((r) => r.teamAlliance !== undefined);
  const toleranceLabel = t('checks.tolerance', { delta: n(toleranceS, 1) });
  const title = !robots.length ? 'checks.emptyTitle' : issues ? 'checks.issues' : robots.length < 2 ? 'checks.singleTitle' : 'checks.clearTitle';
  return <section className="conflict-panel" aria-label={t('conflicts.title')}>
    <div className={`check-summary ${issues ? 'has-issues' : robots.length > 1 ? 'is-clear' : ''}`}>
      <div className="check-summary-icon"><Icon name={issues ? 'warning' : robots.length > 1 ? 'check' : 'path'} size={24} /></div>
      <h2>{t(title, { n: issues })}</h2>
      {!issues && robots.length === 1 && <p>{t('checks.singleBody')}</p>}
      {hidden > 0 && <small>{t('checks.hidden', { n: hidden })}</small>}
    </div>
    {guide}
    {estimated && <p className="check-data-note"><Icon name="warning" size={15} />{t('checks.estimated')}</p>}
    {!!robots.length && <h3 className="check-section-heading">{t('conflicts.title')}<span className={`conflict-count ${conflicts.length ? 'bad' : ''}`}>{conflicts.length}</span></h3>}
    {robots.length >= 2 && (
      <label className="tolerance-row">
        <span className="tolerance-label">{toleranceLabel}</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.1}
          value={toleranceS}
          onChange={(e) => onToleranceChange?.(Number(e.target.value))}
          aria-label={toleranceLabel}
        />
        <span className="tolerance-value">±{n(toleranceS, 1)} s</span>
      </label>
    )}
    {conflicts.length > 0 && <ul className="conflict-list">{conflicts.map((c) => {
      return <li key={`${c.aId}-${c.bId}-${c.startT}-${c.kind}`} className={`conflict-item${c.kind === 'tolerance' ? ' is-tolerance' : ''}`}>
      <button className="conflict-jump" onClick={() => onJump(c.closestT, [c.aId, c.bId])} title={t('checks.jump')}>
        <span className="conflict-pair">{t('conflicts.pair', { a: nameOf(c.aId), b: nameOf(c.bId) })}
          {usesTeamAlliances && <em className={`relation-badge is-${c.relation}`}>{t(c.relation === 'teammates' ? 'conflicts.teammates' : 'conflicts.opponents')}</em>}
          {c.kind === 'tolerance' && <em className="tolerance-badge">{t('conflicts.toleranceBadge', { delta: n(c.toleranceS ?? toleranceS, 1) })}</em>}</span>
        <span className="conflict-when">{t('conflicts.item', { start: n(c.startT, 2), end: n(c.endT, 2), d: formatLength(c.minCenterDistanceM, unit, lang), x: n((c.closestA.x + c.closestB.x) / 2, 1), y: n((c.closestA.y + c.closestB.y) / 2, 1) })}</span>
        <span className="issue-action">{t('checks.jump')} →</span>
      </button>
    </li>;
    })}</ul>}
    {bounds.length > 0 && <><h3 className="check-section-heading">{t('bounds.title')}<span className="conflict-count bounds-count">{bounds.length}</span></h3><ul className="conflict-list">{bounds.map((b) => <li key={`${b.robotId}-${b.startT}`} className="conflict-item"><button className="conflict-jump bounds" onClick={() => onJump((b.startT + b.endT) / 2, [b.robotId])}><span className="conflict-pair">{nameOf(b.robotId)}</span><span className="conflict-when">{t('bounds.item', { start: n(b.startT, 2), end: n(b.endT, 2), depth: formatLength(b.maxPenetrationM, unit, lang), edge: b.edges.map((e) => t(`edges.${e}` as const)).join('/') })}</span><span className="issue-action">{t('checks.jump')} →</span></button></li>)}</ul></>}
        {obstacleDefs.length > 0 && <><h3 className="check-section-heading obstacles-heading">{t('obstacles.title')}<span className={`conflict-count obstacles-count${obstacleHits.length ? ' bad' : ''}`}>{obstacleHits.length}</span></h3><ul className="conflict-list">{obstacleHits.map((h) => <li key={`${h.robotId}-${h.obstacleId}-${h.startT}`} className="conflict-item"><button className="conflict-jump obstacles" onClick={() => onJump((h.startT + h.endT) / 2, [h.robotId])}><span className="conflict-pair">{nameOf(h.robotId)}</span><span className="conflict-when">{t('obstacles.item', { start: n(h.startT, 2), end: n(h.endT, 2), depth: formatLength(h.maxPenetrationM, unit, lang), name: obstacleDefs.find((o) => o.id === h.obstacleId)?.name ?? h.obstacleId })}</span><span className="issue-action">{t('checks.jump')} →</span></button></li>)}</ul></>}
  </section>;
}
