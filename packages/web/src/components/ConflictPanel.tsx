import type {
  CollisionInterval,
  OutOfBoundsInterval,
  SessionTrajectory,
} from '@pathblender/core';
import { useI18n } from '../i18n';
import { VIEWER_ONLY } from '../viewer';

interface Props {
  robots: SessionTrajectory[];
  conflicts: CollisionInterval[];
  bounds: OutOfBoundsInterval[];
  minSeparation?: { aId: string; bId: string; distanceM: number; t: number };
  onJump: (t: number) => void;
  /** One-click mediation: smallest start-delays that clear every conflict. */
  onAutoResolve: () => void;
}

export function ConflictPanel({
  robots,
  conflicts,
  bounds,
  onJump,
  onAutoResolve,
}: Props) {
  const { t } = useI18n();
  const nameOf = (id: string) => robots.find((r) => r.trajectory.id === id)?.trajectory.name ?? '?';

  return (
    <aside className="conflict-panel">
      <h2>
        {t('conflicts.title')}{' '}
        <span className={`conflict-count ${conflicts.length > 0 ? 'bad' : 'ok'}`}>
          {conflicts.length}
        </span>
        {conflicts.length > 0 && !VIEWER_ONLY && (
          <button className="btn small auto-resolve" onClick={onAutoResolve}>
            {t('conflicts.autoResolve')}
          </button>
        )}
      </h2>

      {conflicts.length > 0 && (
        <ul className="conflict-list">
          {conflicts.map((c, i) => (
            <li key={i} className="conflict-item">
              <button className="conflict-jump" onClick={() => onJump(c.closestT)}>
                <span className="conflict-pair">
                  {t('conflicts.pair', { a: nameOf(c.aId), b: nameOf(c.bId) })}
                </span>
                <span className="conflict-when">
                  {t('conflicts.item', {
                    start: c.startT.toFixed(2),
                    end: c.endT.toFixed(2),
                    d: c.minCenterDistanceM.toFixed(2),
                    x: ((c.closestA.x + c.closestB.x) / 2).toFixed(1),
                    y: ((c.closestA.y + c.closestB.y) / 2).toFixed(1),
                  })}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {bounds.length > 0 && (
        <>
          <h2 className="bounds-title">{t('bounds.title')}</h2>
          <ul className="conflict-list">
            {bounds.map((b, i) => (
              <li key={`b${i}`} className="conflict-item">
                <button
                  className="conflict-jump bounds"
                  onClick={() => onJump(b.startT + (b.endT - b.startT) / 2)}
                >
                  <span className="conflict-pair">
                    {nameOf(b.robotId)}
                  </span>
                  <span className="conflict-when">
                    {t('bounds.item', {
                      start: b.startT.toFixed(2),
                      end: b.endT.toFixed(2),
                      depth: b.maxPenetrationM.toFixed(2),
                      edge: b.edges
                        .map((e) => t(`edges.${e}` as const))
                        .join('/'),
                    })}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </aside>
  );
}
