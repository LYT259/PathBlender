/**
 * A-B scenario comparison (§7.3-3 trigger track, landed 2026-10-04):
 * the same pair's minimum separation in two snapshots of the session —
 * "did our timing change make this pair safer or tighter?" Pairs are
 * matched by robot identity; robots appearing in only one snapshot are
 * reported as added/removed rather than compared.
 */

import type { SessionTrajectory } from '../session';
import { minimumSeparation } from './detect';

export interface AbPairDelta {
  aId: string;
  bId: string;
  /** Baseline (scenario A) minimum separation, meters. */
  baselineM: number;
  /** Current (scenario B) minimum separation, meters. */
  currentM: number;
  /** current − baseline: positive = safer (more room). */
  deltaM: number;
}

export interface AbCompare {
  pairs: AbPairDelta[];
  addedIds: string[];
  removedIds: string[];
}

export function compareScenarios(
  baseline: readonly SessionTrajectory[],
  current: readonly SessionTrajectory[],
): AbCompare {
  const minByPair = (robots: readonly SessionTrajectory[]) => {
    const out = new Map<string, { aId: string; bId: string; distanceM: number }>();
    for (let i = 0; i < robots.length; i++) {
      for (let j = i + 1; j < robots.length; j++) {
        const a = robots[i] as SessionTrajectory;
        const b = robots[j] as SessionTrajectory;
        const min = minimumSeparation([a, b]);
        const key = [a.trajectory.id, b.trajectory.id].sort().join('×');
        out.set(key, {
          aId: a.trajectory.id,
          bId: b.trajectory.id,
          distanceM: min?.distanceM ?? Number.POSITIVE_INFINITY,
        });
      }
    }
    return out;
  };

  const ids = (robots: readonly SessionTrajectory[]) => new Set(robots.map((r) => r.trajectory.id));
  const base = minByPair(baseline);
  const curr = minByPair(current);
  const pairs: AbPairDelta[] = [];
  for (const [key, b] of base) {
    const c = curr.get(key);
    if (!c) continue;
    if (!Number.isFinite(b.distanceM) && !Number.isFinite(c.distanceM)) continue;
    pairs.push({
      aId: b.aId,
      bId: b.bId,
      baselineM: b.distanceM,
      currentM: c.distanceM,
      deltaM: c.distanceM - b.distanceM,
    });
  }
  const baseIds = ids(baseline);
  const currIds = ids(current);
  return {
    pairs: pairs.sort((x, y) => x.deltaM - y.deltaM),
    addedIds: [...currIds].filter((id) => !baseIds.has(id)),
    removedIds: [...baseIds].filter((id) => !currIds.has(id)),
  };
}
