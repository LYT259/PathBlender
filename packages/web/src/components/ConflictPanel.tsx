import type { CollisionInterval, OutOfBoundsInterval, SessionTrajectory } from '@pathblender/core';
import { useI18n } from '../i18n';
import { VIEWER_ONLY } from '../viewer';
import { Icon } from './Icon';

interface Props {
  robots: SessionTrajectory[];
  conflicts: CollisionInterval[];
  bounds: OutOfBoundsInterval[];
  minSeparation?: { aId: string; bId: string; distanceM: number; t: number };
  onJump: (t: number, robotIds?: string[]) => void;
  onAdjust: (id: string) => void;
  onAutoResolve: () => void;
}

export function ConflictPanel({ robots, conflicts, bounds, minSeparation, onJump, onAdjust, onAutoResolve }: Props) {
  const { t } = useI18n();
  const nameOf = (id: string) => robots.find((r) => r.trajectory.id === id)?.trajectory.name ?? '?';
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
    {estimated && <p className="check-data-note"><Icon name="warning" size={15} />{t('checks.estimated')}</p>}
    {!!robots.length && <h3 className="check-section-heading">{t('conflicts.title')}<span className={`conflict-count ${conflicts.length ? 'bad' : ''}`}>{conflicts.length}</span></h3>}
    {conflicts.length > 0 && <ul className="conflict-list">{conflicts.map((c) => <li key={`${c.aId}-${c.bId}-${c.startT}`} className="conflict-item">
      <button className="conflict-jump" onClick={() => onJump(c.closestT, [c.aId, c.bId])} title={t('checks.jump')}>
        <span className="conflict-pair">{t('conflicts.pair', { a: nameOf(c.aId), b: nameOf(c.bId) })}</span>
        <span className="conflict-when">{t('conflicts.item', { start: c.startT.toFixed(2), end: c.endT.toFixed(2), d: c.minCenterDistanceM.toFixed(2), x: ((c.closestA.x + c.closestB.x) / 2).toFixed(1), y: ((c.closestA.y + c.closestB.y) / 2).toFixed(1) })}</span>
        <span className="issue-action">{t('checks.jump')} →</span>
      </button>
      {!VIEWER_ONLY && <div className="issue-robot-actions"><span>{t('checks.adjust')}</span>{[c.aId, c.bId].map((id) => <button className="btn small" key={id} onClick={() => { onJump(c.closestT, [c.aId, c.bId]); onAdjust(id); }}>{nameOf(id)}</button>)}</div>}
    </li>)}</ul>}
    {conflicts.length > 0 && !VIEWER_ONLY && <div className="resolve-action"><button className="btn" onClick={onAutoResolve}>{t('checks.resolve')}</button><p>{t('checks.resolveHint')}</p></div>}
    {bounds.length > 0 && <><h3 className="check-section-heading">{t('bounds.title')}<span className="conflict-count bounds-count">{bounds.length}</span></h3><ul className="conflict-list">{bounds.map((b) => <li key={`${b.robotId}-${b.startT}`} className="conflict-item"><button className="conflict-jump bounds" onClick={() => onJump((b.startT + b.endT) / 2, [b.robotId])}><span className="conflict-pair">{nameOf(b.robotId)}</span><span className="conflict-when">{t('bounds.item', { start: b.startT.toFixed(2), end: b.endT.toFixed(2), depth: b.maxPenetrationM.toFixed(2), edge: b.edges.map((e) => t(`edges.${e}` as const)).join('/') })}</span><span className="issue-action">{t('checks.jump')} →</span></button></li>)}</ul></>}
    {minSeparation && <p className="min-sep">{t('conflicts.minSep', { d: minSeparation.distanceM.toFixed(2), t: minSeparation.t.toFixed(2), a: nameOf(minSeparation.aId), b: nameOf(minSeparation.bId) })}</p>}
  </section>;
}
