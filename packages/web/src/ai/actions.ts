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

registry.register(
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

registry.register(
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

registry.register(
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

registry.register(
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

registry.register(
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

registry.register(
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

registry.register(
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

// --- compatibility surface for existing consumers ---

export function executeAction(name: string, args: Args, ctx: ActionContext) {
  return registry.execute(name, args, ctx);
}

export function actionNeedsConfirmation(name: string): boolean {
  return registry.riskOf(name) === 'high';
}

export type { ActionContext };
