/**
 * One-click conflict mediation (report v1.4 §6.3 mediation editing, user
 * request 2026-08-28): start-delay local search, one collision pair at a
 * time. For the focused pair, each step simulates delaying either robot by
 * one step and commits the option that leaves fewer conflicts involving the
 * pair. On a plateau (no single step helps — e.g. a double-entered path)
 * it keeps delaying the longer trajectory so the two active windows
 * eventually separate; if that drive exceeds the per-robot ceiling the
 * pair is declared unsolvable and the plateau's delays are rolled back so
 * a hopeless pair never degrades the rest of the plan. The best state seen
 * is returned. Deterministic; the Agent action calls the same function.
 */

import { detectCollisions } from './collision/detect';
import { activeEndT } from './session';
import type { SessionTrajectory } from './session';
import type { CollisionInterval } from './collision/detect';

/** Delay increment per retry, seconds (report: what-if granularity). */
const STEP_S = 0.25;
/** Default delay ceiling, seconds — the current season's Autonomous Period
 *  (2026 REBUILT). Callers mediating an older season's plan should pass that
 *  season's `FieldPackage.autoPeriodS` (15 s through 2025): a delay past the
 *  Autonomous Period is pointless by construction. */
export const MAX_DELAY_S = 20;
/** Safety bound on total steps. */
const MAX_ROUNDS = 4000;
/** Stop early after this many rounds without a new global best. */
const STALL_ROUNDS = 250;

const pairKey = (a: string, b: string) => [a, b].sort().join('|');
const duration = (r: SessionTrajectory) => activeEndT(r) - r.startDelayS;
const involves = (c: CollisionInterval, a: string, b: string) =>
  c.aId === a || c.bId === a || c.aId === b || c.bId === b;

export function autoResolveConflicts(
  robots: readonly SessionTrajectory[],
  autoPeriodS: number = MAX_DELAY_S,
): SessionTrajectory[] {
  const maxDelayS = autoPeriodS;
  let cur = robots.map((r) => ({ ...r }));
  const unsolvable = new Set<string>();
  const plateauStart = new Map<string, SessionTrajectory[]>();

  const visible = (rs: SessionTrajectory[]) => rs.filter((r) => r.visible);
  const detect = (rs: SessionTrajectory[]) => detectCollisions(visible(rs));

  let best = cur;
  let bestCount = detect(cur).length;
  let stalled = 0;

  for (let round = 0; round < MAX_ROUNDS; round++) {
    if (stalled++ > STALL_ROUNDS) break;
    const all = detect(cur);
    if (all.length === 0) break;
    if (all.length < bestCount) {
      best = cur;
      bestCount = all.length;
      stalled = 0;
    }
    const c = all.find((x) => !unsolvable.has(pairKey(x.aId, x.bId)));
    if (!c) break; // only unsolvable pairs remain
    const aId = c.aId;
    const bId = c.bId;
    const key = pairKey(aId, bId);
    const a = cur.find((r) => r.trajectory.id === aId);
    const b = cur.find((r) => r.trajectory.id === bId);
    if (!a || !b) break;

    const pairCount = (rs: SessionTrajectory[]) =>
      detectCollisions(visible(rs)).filter((x) => involves(x, aId, bId)).length;

    const step = (target: SessionTrajectory) =>
      cur.map((r) =>
        r.trajectory.id === target.trajectory.id
          ? { ...r, startDelayS: Math.min(maxDelayS, r.startDelayS + STEP_S) }
          : r,
      );

    const options = [a, b]
      .filter((x) => x.startDelayS < maxDelayS)
      .map((cand) => ({ next: step(cand), pc: pairCount(step(cand)) }));
    const before = pairCount(cur);

    if (options.length > 0) {
      options.sort((x, y) => x.pc - y.pc);
      const bestOpt = options[0]!;
      if (bestOpt.pc < before) {
        cur = bestOpt.next; // a helpful step — take it
        continue;
      }
    }

    // Plateau: push the longer trajectory's window past the shorter one.
    if (!plateauStart.has(key)) plateauStart.set(key, cur);
    const longer = duration(a) >= duration(b) ? a : b;
    if (longer.startDelayS >= maxDelayS) {
      // Hopeless by delay alone — undo this pair's plateau and move on.
      const snap = plateauStart.get(key);
      if (snap) cur = snap;
      unsolvable.add(key);
      continue;
    }
    cur = step(longer);
  }
  const finalCount = detect(cur).length;
  return finalCount <= bestCount ? cur : best;
}
