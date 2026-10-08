/**
 * Action-word interpretation for the playback callout (2026-10-08).
 *
 * A marker file records only "name + instant": no duration, no end, no
 * mechanism ownership. This module supplies the missing semantics from a
 * vocabulary table agreed with the team (durations cross-checked against
 * the three robot codebases), so the callout can answer "what is this
 * robot doing right now" as a SET of parallel actions instead of a single
 * latest marker:
 *
 * - paired words resolve to exact intervals — stop_intake ends intake,
 *   stop_feed ends feed (the file itself carries begin AND end);
 * - same-mechanism groups replace (stow_intake succeeds intake — the
 *   rollers change goal; shoot succeeds pre_aim — the shooter fires);
 *   different groups coexist (intake keeps running while pre_aim warms);
 * - one-shot moves (blocker positions, extension positions, stop
 *   commands) flash for their real durations, then drop off;
 * - unknown words default to sustained, each in its own group — other
 *   teams' vocabularies stay readable, they just never fade.
 *
 * Word matching is format-tolerant: case and separators (-, _, space, .)
 * are normalized away, so a team's Stop-Intake, STOP_INTAKE, stop intake
 * and stopIntake all behave identically.
 */

import { activeEndT, type SessionTrajectory } from './session';
import { sequenceEventTimes } from './auto-sequence';

/** Display lifetime of a marker name. */
export type ActionKind = 'sustained' | 'instant' | 'end';

export interface ActionWord {
  kind: ActionKind;
  /** Mechanism the word belongs to; a new sustained word in a group replaces the previous one. */
  group: string;
  /** Instant words: seconds the flash stays on screen. */
  flashS?: number;
}

/**
 * The team vocabulary, 15 words across the three 2026 robots, keyed by
 * normalized name. Durations from the codebases: shoot/pass are 4–5 s
 * deadline routines; feeder runs with the shot; blockers ride a 2 s
 * WaitCommand budget; extension goals settle in ~1 s; stop commands are
 * withTimeout(0.1) but flash for a 1 s visibility floor.
 */
const ACTION_WORDS: Record<string, ActionWord> = {
  // Intake mechanism (rollers): goals replace within the group.
  intake: { kind: 'sustained', group: 'intake' },
  outtake: { kind: 'sustained', group: 'intake' },
  stowintake: { kind: 'sustained', group: 'intake' },
  stopintake: { kind: 'end', group: 'intake', flashS: 1 },
  // Feeder: a feed/stop_feed pair brackets the feeding window exactly.
  feed: { kind: 'sustained', group: 'feed' },
  stopfeed: { kind: 'end', group: 'feed', flashS: 1 },
  // Shooter firing modes (turret + flywheel tracking routines).
  preaim: { kind: 'sustained', group: 'shooter' },
  shoot: { kind: 'sustained', group: 'shooter' },
  pass: { kind: 'sustained', group: 'shooter' },
  // Hood trench-guard: runs whenever the robot threads the trench, in
  // parallel with whatever the shooter is doing (its own mechanism).
  align: { kind: 'sustained', group: 'hood' },
  // Extension positions: goal moves, settle then hold — flash the move.
  deployextension: { kind: 'instant', group: 'extension', flashS: 1 },
  feedextension: { kind: 'instant', group: 'extension', flashS: 1 },
  // Blocker positions: servo travel rides a 2 s command budget.
  openblocker: { kind: 'instant', group: 'blocker', flashS: 2 },
  closeblocker: { kind: 'instant', group: 'blocker', flashS: 2 },
  halfopenblocker: { kind: 'instant', group: 'blocker', flashS: 2 },
};

/** Case- and separator-insensitive lookup key: Stop-Intake → stopintake. */
export function normalizeActionWord(name: string): string {
  return name.trim().toLowerCase().replace(/[\s\-_.\u2014\u2013]+/g, '');
}

const FLOOR_FLASH_S = 1;

export interface ActiveAction {
  name: string;
  /** Global-clock time the action fired. */
  t: number;
  /**
   * Global-clock time the action ends: the next same-group event (an
   * end-word or a replacement — exact, from the file), the end of the
   * route for actions nothing ever closes (plan A, 2026-10-08: the auto's
   * own end is the honest bound), or the flash window for one-shot moves.
   */
  endsAt: number;
}

/**
 * The actions this robot is performing at global time t, as a set: every
 * sustained group still open (started at or before t, not yet ended or
 * replaced) plus one-shot moves still inside their flash window, each with
 * the seconds it has left. Names come back verbatim from the markers;
 * empty before anything fires.
 */
export function activeActionsAt(st: SessionTrajectory, t: number): ActiveAction[] {
  // t=0 is the enable instant — nothing can have happened yet, so the
  // callout stays empty there even for t=0 markers (user request
  // 2026-10-08); they appear the moment playback moves past zero.
  if (t <= 0) return [];
  const events = [...sequenceEventTimes(st)].sort((a, b) => a.t - b.t);
  const groups = new Map<string, { name: string; t: number }>();
  const flashes: { name: string; t: number; until: number }[] = [];
  for (const event of events) {
    if (event.t > t + 1e-9) break;
    const word = ACTION_WORDS[normalizeActionWord(event.name)];
    if (!word) {
      // Unknown vocabulary: sustained, its own group — parallel-safe.
      groups.set(`word:${normalizeActionWord(event.name)}`, event);
      continue;
    }
    if (word.kind === 'sustained') {
      groups.set(word.group, event);
    } else {
      // 'end' clears its group; both 'end' and 'instant' flash briefly.
      if (word.kind === 'end') groups.delete(word.group);
      flashes.push({ name: event.name, t: event.t, until: event.t + Math.max(word.flashS ?? FLOOR_FLASH_S, FLOOR_FLASH_S) });
    }
  }
  // When does each open group end? The first same-group event still in
  // the future (an end-word or a replacement — both carry the group), or
  // the end of the route when nothing ever closes it.
  const endsByKey = new Map<string, number>();
  for (const event of events) {
    if (event.t <= t + 1e-9) continue;
    const word = ACTION_WORDS[normalizeActionWord(event.name)];
    const key = word ? word.group : `word:${normalizeActionWord(event.name)}`;
    if (!endsByKey.has(key)) endsByKey.set(key, event.t);
  }
  const routeEnd = activeEndT(st);
  // Slot order = first-open order (a replacing event keeps its group's
  // slot), flashes append in fire order — the badge never reorders mid-play.
  const out: ActiveAction[] = [...groups.entries()].map(([key, event]) => ({
    name: event.name,
    t: event.t,
    endsAt: endsByKey.get(key) ?? routeEnd,
  }));
  for (const flash of flashes) {
    if (t <= flash.until + 1e-9) out.push({ name: flash.name, t: flash.t, endsAt: flash.until });
  }
  return out;
}
