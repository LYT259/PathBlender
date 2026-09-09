/**
 * GHPathBlender action registrations (report v1.5 §6.4 harness discipline 1).
 *
 * Each action is a self-describing entry in a registry owned by core —
 * { name, description, parameter schema, risk, handler } — and the LLM tool
 * declarations are generated from that registry, so UI, AI, and tests
 * consume one source of truth. Risk levels drive approval tiers (§6.4
 * discipline 2): 'low' runs with an undoable summary, 'high' waits for the
 * user's explicit approval. Model output is data, never code (no eval).
 */

import { ActionRegistry, autoResolveConflicts } from '@pathblender/core';
import type { ActionContext, ActionSpec, Args } from '@pathblender/core';
import { VIEWER_ONLY } from '../viewer';

function str(a: Args, k: string): string | undefined {
  const v = a[k];
  return typeof v === 'string' ? v : undefined;
}
function num(a: Args, k: string): number | undefined {
  const v = a[k];
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}
function nameOf(ctx: ActionContext, id: string): string {
  return ctx.robots.find((r) => r.trajectory.id === id)?.trajectory.name ?? id;
}
function editableInfo(ctx: ActionContext, id: string): { kind: string; count: number } | null {
  const e = ctx.robots.find((r) => r.trajectory.id === id)?.trajectory.editable;
  if (!e) return null;
  return {
    kind: e.kind,
    count: e.kind === 'pathplanner' ? e.path.waypoints.length : e.waypoints.length,
  };
}

function spec(s: ActionSpec): ActionSpec {
  return s;
}

export const registry = new ActionRegistry();

// --- read-only queries (risk: low) ---

// Viewer deployments (the website) register only queries + annotations —
// the authoring/export actions below never get registered, so tool
// declarations, the "/" menu, and executeAction agree on one reduced set.

if (!VIEWER_ONLY) registry.register(
  spec({
    name: 'auto_resolve_conflicts',
    description:
      'One-click mediation: add the smallest start delays (0.25 s steps) that clear every collision, delaying the earlier-starting robot of each pair. Prefer this over manual set_start_delay when the user asks for minimal fixes.',
    parameters: { type: 'object', properties: {}, required: [] },
    risk: 'low',
    handler: (ctx) => {
      const resolved = autoResolveConflicts(ctx.robots);
      const changes = resolved
        .filter((r) => {
          const before = ctx.robots.find((x) => x.trajectory.id === r.trajectory.id);
          return before && before.startDelayS !== r.startDelayS;
        })
        .map((r) => ({ name: r.trajectory.name, startDelayS: r.startDelayS }));
      if (changes.length === 0) return { ok: true, summary: 'no changes needed', result: [] };
      ctx.pushUndo('auto-resolve');
      for (const r of resolved) {
        const before = ctx.robots.find((x) => x.trajectory.id === r.trajectory.id);
        if (before && before.startDelayS !== r.startDelayS) {
          ctx.setStartDelay(r.trajectory.id, r.startDelayS);
        }
      }
      return {
        ok: true,
        summary: `delayed ${changes.length} robot(s): ${changes
          .map((c) => `${c.name} +${c.startDelayS.toFixed(2)}s`)
          .join(', ')}`,
        result: changes,
      };
    },
  }),
);

registry.register(
  spec({
    name: 'list_robots',
    description:
      'List every robot in the session: id, name, team number, alliance, start delay, source format, edited state.',
    parameters: { type: 'object', properties: {}, required: [] },
    risk: 'low',
    handler: (ctx) => ({
      ok: true,
      summary: 'listed robots',
      result: ctx.robots.map((r) => ({
        id: r.trajectory.id,
        name: r.trajectory.name,
        teamNumber: r.trajectory.teamNumber,
        alliance: r.trajectory.alliance,
        startDelayS: r.startDelayS,
        source: r.trajectory.source,
        edited: Boolean(r.trajectory.edited),
        editable: r.trajectory.editable?.kind ?? null,
      })),
    }),
  }),
);

registry.register(
  spec({
    name: 'query_collisions',
    description:
      'Return the current collision report: robot pairs, time intervals, closest positions, and out-of-bounds entries.',
    parameters: { type: 'object', properties: {}, required: [] },
    risk: 'low',
    handler: (ctx) => ({
      ok: true,
      summary: `queried collisions (${ctx.conflicts.length})`,
      result: ctx.conflicts.map((c) => ({
        a: nameOf(ctx, c.aId),
        b: nameOf(ctx, c.bId),
        startT: c.startT,
        endT: c.endT,
        closest: c.closestA,
      })),
    }),
  }),
);

// --- low-risk mutations: auto-run, undoable ---

if (!VIEWER_ONLY) registry.register(
  spec({
    name: 'set_start_delay',
    description: "Set a robot's what-if start delay in seconds (0 or more). Recomputes collisions immediately.",
    parameters: {
      type: 'object',
      properties: { robotId: { type: 'string' }, seconds: { type: 'number' } },
      required: ['robotId', 'seconds'],
    },
    risk: 'low',
    handler: (ctx, a) => {
      const id = str(a, 'robotId')!;
      const seconds = num(a, 'seconds')!;
      if (seconds < 0) {
        return { ok: false, summary: 'rejected "set_start_delay" — negative delay', result: { error: 'invalid arguments' } };
      }
      ctx.pushUndo(`delay ${nameOf(ctx, id)} → ${seconds}s`);
      ctx.setStartDelay(id, seconds);
      return { ok: true, summary: `set ${nameOf(ctx, id)} start delay to ${seconds}s`, result: { done: true } };
    },
  }),
);

if (!VIEWER_ONLY) registry.register(
  spec({
    name: 'set_alliance',
    description: "Set a robot's alliance perspective ('blue' or 'red') for field normalization.",
    parameters: {
      type: 'object',
      properties: { robotId: { type: 'string' }, alliance: { type: 'string', enum: ['blue', 'red'] } },
      required: ['robotId', 'alliance'],
    },
    risk: 'low',
    handler: (ctx, a) => {
      const id = str(a, 'robotId')!;
      const alliance = str(a, 'alliance') as 'blue' | 'red';
      ctx.pushUndo(`alliance ${nameOf(ctx, id)} → ${alliance}`);
      ctx.setAlliance(id, alliance);
      return { ok: true, summary: `set ${nameOf(ctx, id)} to ${alliance}`, result: { done: true } };
    },
  }),
);

registry.register(
  spec({
    name: 'set_team_number',
    description: "Set a robot's team number annotation (digits only).",
    parameters: {
      type: 'object',
      properties: { robotId: { type: 'string' }, teamNumber: { type: 'string' } },
      required: ['robotId', 'teamNumber'],
    },
    risk: 'low',
    handler: (ctx, a) => {
      const id = str(a, 'robotId')!;
      const teamNumber = str(a, 'teamNumber')!.replace(/\D/g, '').slice(0, 5);
      ctx.pushUndo(`team # ${nameOf(ctx, id)} → ${teamNumber}`);
      ctx.setTeamNumber(id, teamNumber);
      return { ok: true, summary: `set ${nameOf(ctx, id)} team number to ${teamNumber}`, result: { done: true } };
    },
  }),
);

if (!VIEWER_ONLY) registry.register(
  spec({
    name: 'adjust_waypoint',
    description:
      'Move a waypoint (or a bezier control point) of an editable robot to a new field position in meters. PathPlanner sources regenerate timing; Choreo sources remap geometry and keep timing.',
    parameters: {
      type: 'object',
      properties: {
        robotId: { type: 'string' },
        index: { type: 'number' },
        x: { type: 'number' },
        y: { type: 'number' },
        kind: { type: 'string', enum: ['anchor', 'prevControl', 'nextControl'] },
      },
      required: ['robotId', 'index', 'x', 'y'],
    },
    risk: 'low',
    handler: (ctx, a) => {
      const id = str(a, 'robotId')!;
      const index = num(a, 'index')!;
      const x = num(a, 'x')!;
      const y = num(a, 'y')!;
      const kind = (str(a, 'kind') ?? 'anchor') as 'anchor' | 'prevControl' | 'nextControl';
      const info = editableInfo(ctx, id);
      if (!info) {
        return { ok: false, summary: `${nameOf(ctx, id)} has no editable waypoints`, result: { error: 'not editable' } };
      }
      if (index < 0 || index >= info.count) {
        return { ok: false, summary: `waypoint index ${index} out of range (0..${info.count - 1})`, result: { error: 'index out of range' } };
      }
      if (info.kind === 'choreo' && kind !== 'anchor') {
        return { ok: false, summary: 'Choreo paths only have anchors', result: { error: 'no control points' } };
      }
      ctx.pushUndo(`waypoint ${index} of ${nameOf(ctx, id)} → (${x.toFixed(2)}, ${y.toFixed(2)})`);
      ctx.editWaypoint(id, index, { x, y }, kind);
      return { ok: true, summary: `moved ${nameOf(ctx, id)} waypoint ${index} to (${x.toFixed(2)}, ${y.toFixed(2)})`, result: { done: true } };
    },
  }),
);

if (!VIEWER_ONLY) registry.register(
  spec({
    name: 'add_waypoint',
    description: 'Insert a new waypoint after the given index (midpoint of that segment).',
    parameters: {
      type: 'object',
      properties: { robotId: { type: 'string' }, afterIndex: { type: 'number' } },
      required: ['robotId', 'afterIndex'],
    },
    risk: 'low',
    handler: (ctx, a) => {
      const id = str(a, 'robotId')!;
      const afterIndex = num(a, 'afterIndex')!;
      if (!editableInfo(ctx, id)) {
        return { ok: false, summary: `${nameOf(ctx, id)} has no editable waypoints`, result: { error: 'not editable' } };
      }
      ctx.pushUndo(`add waypoint to ${nameOf(ctx, id)}`);
      ctx.addWaypoint(id, afterIndex);
      return { ok: true, summary: `added waypoint after ${afterIndex} on ${nameOf(ctx, id)}`, result: { done: true } };
    },
  }),
);

if (!VIEWER_ONLY) registry.register(
  spec({
    name: 'remove_waypoint',
    description: 'Remove the waypoint at the given index (a path always keeps at least 2).',
    parameters: {
      type: 'object',
      properties: { robotId: { type: 'string' }, index: { type: 'number' } },
      required: ['robotId', 'index'],
    },
    risk: 'low',
    handler: (ctx, a) => {
      const id = str(a, 'robotId')!;
      const index = num(a, 'index')!;
      if (!editableInfo(ctx, id)) {
        return { ok: false, summary: `${nameOf(ctx, id)} has no editable waypoints`, result: { error: 'not editable' } };
      }
      ctx.pushUndo(`remove waypoint from ${nameOf(ctx, id)}`);
      ctx.removeWaypoint(id, index);
      return { ok: true, summary: `removed waypoint ${index} from ${nameOf(ctx, id)}`, result: { done: true } };
    },
  }),
);

// --- high-risk actions: user approval before running ---

if (!VIEWER_ONLY) registry.register(
  spec({
    name: 'export_file',
    description: 'Download a derived adjusted copy of a robot as .path, .traj, or .ghostauto. Requires user confirmation.',
    parameters: {
      type: 'object',
      properties: { robotId: { type: 'string' }, format: { type: 'string', enum: ['path', 'traj', 'ghostauto'] } },
      required: ['robotId', 'format'],
    },
    risk: 'high',
    handler: (ctx, a) => {
      const id = str(a, 'robotId')!;
      const format = str(a, 'format') as 'path' | 'traj' | 'ghostauto';
      ctx.exportRobot(id, format);
      return { ok: true, summary: `exported ${nameOf(ctx, id)} as .${format}`, result: { done: true } };
    },
  }),
);

registry.register(
  spec({
    name: 'remove_robot',
    description: 'Remove a robot from the session. Requires user confirmation.',
    parameters: { type: 'object', properties: { robotId: { type: 'string' } }, required: ['robotId'] },
    risk: 'high',
    handler: (ctx, a) => {
      const id = str(a, 'robotId')!;
      ctx.pushUndo(`remove ${nameOf(ctx, id)}`);
      ctx.removeRobot(id);
      return { ok: true, summary: `removed ${nameOf(ctx, id)}`, result: { done: true } };
    },
  }),
);

// --- session-local reminders (DSH Schedule, lightweight port) ---

export interface Reminder {
  id: string;
  prompt: string;
  /** Epoch ms when the reminder fires; fixed-rate reminders re-arm. */
  dueAt: number;
  /** Repeat interval in ms (>= 300 s), or absent for one-shot. */
  everyMs?: number;
}

const REMINDER_KEY = 'ghpb.aiReminders';
let reminders: Reminder[] = (() => {
  try {
    const v = JSON.parse(localStorage.getItem(REMINDER_KEY) ?? '[]') as unknown;
    return Array.isArray(v) ? (v.filter((r) => typeof r === 'object' && r !== null) as Reminder[]) : [];
  } catch {
    return [];
  }
})();
function persistReminders() {
  try {
    localStorage.setItem(REMINDER_KEY, JSON.stringify(reminders));
  } catch {
    /* session-only then */
  }
}
type ReminderListener = (due: Reminder[]) => void;
const reminderListeners = new Set<ReminderListener>();
/** The panel subscribes; due reminders are handed over exactly once. */
export function onRemindersDue(l: ReminderListener): () => void {
  reminderListeners.add(l);
  return () => {
    reminderListeners.delete(l);
  };
}
function fireDue(now: number) {
  const due = reminders.filter((r) => r.dueAt <= now);
  if (due.length === 0) return;
  const ids = new Set(due.map((r) => r.id));
  reminders = reminders
    .map((r) => (ids.has(r.id) && r.everyMs ? { ...r, dueAt: r.dueAt + r.everyMs } : r))
    .filter((r) => !ids.has(r.id) || r.everyMs);
  persistReminders();
  for (const l of [...reminderListeners]) l(due);
}
// 1 Hz reminder pump — started by the AI panel; safe to call repeatedly.
let reminderTimer: ReturnType<typeof setInterval> | null = null;
export function startReminderPump() {
  if (reminderTimer) return;
  reminderTimer = setInterval(() => fireDue(Date.now()), 1000);
}
export function stopReminderPump() {
  if (reminderTimer) clearInterval(reminderTimer);
  reminderTimer = null;
}

/** Test hook: drop all in-memory reminders (localStorage may have been
 *  cleared between tests while the module array survives). */
export function resetReminders() {
  reminders = [];
  persistReminders();
}

registry.register(
  spec({
    name: 'schedule_create',
    description:
      'Create a session-local reminder. When it is due and the assistant is idle, the prompt is delivered into this conversation as a follow-up message. No system notification is sent.',
    parameters: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'Message to deliver when due' },
        after_seconds: { type: 'number', description: 'Positive whole seconds from now' },
        every_seconds: { type: 'number', description: 'Fixed-rate repeat interval, at least 300 s' },
      },
      required: ['prompt'],
    },
    risk: 'low',
    handler: (_ctx, a) => {
      const prompt = str(a, 'prompt')?.trim();
      const after = num(a, 'after_seconds');
      const every = num(a, 'every_seconds');
      if (!prompt) return { ok: false, summary: 'schedule_create: prompt required', result: {} };
      if (after == null && every == null)
        return { ok: false, summary: 'schedule_create: after_seconds or every_seconds required', result: {} };
      if (every != null && every < 300)
        return { ok: false, summary: 'schedule_create: every_seconds must be >= 300', result: {} };
      const everyMs = every != null ? every * 1000 : undefined;
      const dueAt = Date.now() + (after != null ? after * 1000 : everyMs!);
      const r: Reminder = {
        id: `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`,
        prompt,
        dueAt,
        ...(everyMs ? { everyMs } : {}),
      };
      reminders.push(r);
      persistReminders();
      const when = new Date(r.dueAt).toLocaleTimeString();
      return {
        ok: true,
        summary: `reminder set: ${everyMs ? `every ${every}s, next` : ''} ${when} — ${prompt}`,
        result: { id: r.id, dueAt: r.dueAt },
      };
    },
  }),
);

registry.register(
  spec({
    name: 'schedule_list',
    description: 'List active session-local reminders (id, due time, prompt, cadence).',
    parameters: { type: 'object', properties: {}, required: [] },
    risk: 'low',
    handler: () => ({
      ok: true,
      summary:
        reminders.length === 0
          ? 'no reminders'
          : reminders
              .map(
                (r) =>
                  `${r.id} ${new Date(r.dueAt).toLocaleTimeString()}${r.everyMs ? ` (every ${r.everyMs / 1000}s)` : ''} — ${r.prompt}`,
              )
              .join('; '),
      result: reminders,
    }),
  }),
);

registry.register(
  spec({
    name: 'schedule_delete',
    description: 'Delete a session-local reminder by id (see schedule_list).',
    parameters: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
    },
    risk: 'low',
    handler: (_ctx, a) => {
      const id = str(a, 'id');
      const before = reminders.length;
      reminders = reminders.filter((r) => r.id !== id);
      persistReminders();
      return {
        ok: reminders.length < before,
        summary: reminders.length < before ? `deleted ${id}` : `no reminder ${id}`,
        result: { done: reminders.length < before },
      };
    },
  }),
);

// --- optional read-only web fetch (default OFF; user opt-in in settings) ---

let webFetchEnabled = false;
/** Synced from AISettings by the app — the action refuses while off. */
export function setWebFetchEnabled(on: boolean) {
  webFetchEnabled = on;
}

const BLOCKED_HOST = /^(localhost|127\.|0\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1)/i;

registry.register(
  spec({
    name: 'web_fetch',
    description:
      'Fetch one public http(s) URL (read-only, no auth) and return up to 20 KB of text. Disabled unless the user enables web fetch in Preferences ▸ AI. Subject to the browser CORS policy: endpoints that do not allow cross-origin reads fail with an error.',
    parameters: {
      type: 'object',
      properties: { url: { type: 'string' } },
      required: ['url'],
    },
    risk: 'low',
    handler: async (_ctx, a) => {
      if (!webFetchEnabled)
        return { ok: false, summary: 'web fetch is off — enable it in Preferences ▸ AI', result: {} };
      const raw = str(a, 'url');
      let u: URL;
      try {
        u = new URL(raw ?? '');
      } catch {
        return { ok: false, summary: 'web_fetch: invalid url', result: {} };
      }
      if (u.protocol !== 'https:' && u.protocol !== 'http:')
        return { ok: false, summary: 'web_fetch: only http(s)', result: {} };
      if (BLOCKED_HOST.test(u.hostname))
        return { ok: false, summary: 'web_fetch: private/loopback hosts are not allowed', result: {} };
      try {
        const res = await fetch(u, { redirect: 'follow' });
        const text = (await res.text()).slice(0, 20000);
        return {
          ok: res.ok,
          summary: `fetched ${u.host} (${res.status}, ${text.length} chars)`,
          result: { status: res.status, contentType: res.headers.get('content-type') ?? '', text },
        };
      } catch (e) {
        return {
          ok: false,
          summary: `web_fetch failed: ${e instanceof Error ? e.message : String(e)} (often CORS)`,
          result: {},
        };
      }
    },
  }),
);

// --- compatibility surface for existing consumers ---

/** Sync dispatch (all built-in non-network actions). Async handlers (e.g.
 *  web_fetch) report an error here — use executeActionAsync for those. */
export function executeAction(name: string, args: Args, ctx: ActionContext) {
  return registry.execute(name, args, ctx);
}

/** Async-aware dispatch — the assistant loop always uses this one. */
export async function executeActionAsync(name: string, args: Args, ctx: ActionContext) {
  return registry.executeAsync(name, args, ctx);
}

export function actionNeedsConfirmation(name: string): boolean {
  return registry.riskOf(name) === 'high';
}

export type { ActionContext };
