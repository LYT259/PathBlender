/**
 * AI assistant tests — fully mocked network (no key, no real provider).
 * Covers the §6.4 safety model: whitelist-only actions, manual schema
 * validation, confirmation gate for export/remove, undo snapshots, and the
 * key-discipline guarantee (never in sessions / share URLs).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { executeAction } from '../src/ai/actions';
import type { ActionContext } from '../src/ai/actions';
import { runAssistantInstruction } from '../src/ai/assistant';
import type { AssistantEvent, ConfirmRequest } from '../src/ai/assistant';
import { DEFAULT_AI_SETTINGS, loadAISettings, saveAISettings } from '../src/ai/settings';
import { autoResolveConflicts, detectCollisions, makeSession, parseGhostAuto, serializeSession } from '@pathblender/core';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SAMPLES = resolve(__dirname, '../../../samples');
const read = (rel: string) => readFileSync(resolve(SAMPLES, rel), 'utf-8');

function makeCtx(overrides: Partial<ActionContext> = {}): ActionContext & {
  calls: Record<string, unknown[][]>;
} {
  const calls: Record<string, unknown[][]> = {};
  const rec = (name: string) => (...args: unknown[]) => {
    (calls[name] ??= []).push(args);
  };
  const traj = parseGhostAuto(read('ghostauto/straight_run.ghostauto'), 's');
  const robot = makeSession(traj, 0);
  const ctx: ActionContext & { calls: typeof calls } = {
    robots: [robot],
    conflicts: [],
    setStartDelay: rec('setStartDelay'),
    setAlliance: rec('setAlliance'),
    setTeamNumber: rec('setTeamNumber'),
    editWaypoint: rec('editWaypoint'),
    addWaypoint: rec('addWaypoint'),
    removeWaypoint: rec('removeWaypoint'),
    removeRobot: rec('removeRobot'),
    exportRobot: rec('exportRobot'),
    pushUndo: rec('pushUndo'),
    calls,
    ...overrides,
  };
  return ctx;
}

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('action whitelist + validation', () => {
  it('rejects unknown actions without running anything', () => {
    const ctx = makeCtx();
    const r = executeAction('runJavaScript', { code: 'steal()' }, ctx);
    expect(r.ok).toBe(false);
    expect(Object.keys(ctx.calls)).toHaveLength(0);
  });

  it('rejects malformed arguments (missing id, negative delay)', () => {
    const ctx = makeCtx();
    expect(executeAction('set_start_delay', { seconds: 1 }, ctx).ok).toBe(false);
    expect(executeAction('set_start_delay', { robotId: 'x', seconds: -3 }, ctx).ok).toBe(false);
    expect(executeAction('set_alliance', { robotId: 'x', alliance: 'green' }, ctx).ok).toBe(false);
    expect(ctx.calls.setStartDelay).toBeUndefined();
  });

  it('executes valid commands and pushes an undo snapshot first', () => {
    const ctx = makeCtx();
    const id = ctx.robots[0]!.trajectory.id;
    const r = executeAction('set_start_delay', { robotId: id, seconds: 0.5 }, ctx);
    expect(r.ok).toBe(true);
    expect(ctx.calls.pushUndo).toHaveLength(1);
    expect(ctx.calls.setStartDelay).toEqual([[id, 0.5]]);
  });
});

describe('AI analysis includes hidden robots', () => {
  function crossingRobots() {
    return [
      makeSession(parseGhostAuto(read('ghostauto/straight_run.ghostauto'), 'straight'), 0),
      { ...makeSession(parseGhostAuto(read('ghostauto/stop_and_score.ghostauto'), 'crossing'), 1), visible: false },
    ];
  }

  it('queries the whole session even when the supplied collision cache omitted hidden paths', () => {
    const robots = crossingRobots();
    const expected = detectCollisions(robots);
    expect(expected.length).toBeGreaterThan(0);
    const ctx = makeCtx({ robots, conflicts: detectCollisions(robots.filter((r) => r.visible)) });
    expect(ctx.conflicts).toHaveLength(0);

    const result = executeAction('query_collisions', {}, ctx);
    expect(result.ok).toBe(true);
    expect(result.result).toHaveLength(expected.length);
    expect(result.result).toEqual(expect.arrayContaining([
      expect.objectContaining({ a: robots[0]!.trajectory.name, b: robots[1]!.trajectory.name }),
    ]));
    expect(robots.map((r) => r.visible)).toEqual([true, false]);
    expect(Object.keys(ctx.calls)).toHaveLength(0);
  });

  it('resolves the same conflicts as the visible session while preserving display choices and source state', () => {
    const robots = crossingRobots();
    const expected = autoResolveConflicts(robots.map((r) => ({ ...r, visible: true })));
    const ctx = makeCtx({ robots, conflicts: detectCollisions(robots) });

    const result = executeAction('auto_resolve_conflicts', {}, ctx);
    expect(result.ok).toBe(true);
    expect(ctx.calls.pushUndo).toEqual([['auto-resolve']]);
    expect(ctx.calls.setStartDelay).toEqual(expected
      .filter((r, index) => r.startDelayS !== robots[index]!.startDelayS)
      .map((r) => [r.trajectory.id, r.startDelayS]));
    const applied = robots.map((r) => {
      const update = ctx.calls.setStartDelay?.find(([id]) => id === r.trajectory.id);
      const delay = update?.[1];
      return { ...r, startDelayS: typeof delay === 'number' ? delay : r.startDelayS };
    });
    expect(detectCollisions(applied)).toHaveLength(0);
    expect(applied.map((r) => r.visible)).toEqual([true, false]);
    expect(robots.map((r) => r.startDelayS)).toEqual([0, 0]);
    expect(robots.map((r) => r.visible)).toEqual([true, false]);
  });
});

describe('assistant loop (mocked provider)', () => {
  const settings = { ...DEFAULT_AI_SETTINGS, enabled: true, baseUrl: 'https://fake.test/v1', model: 'test' };

  function mockProvider(responses: unknown[]) {
    let call = 0;
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => responses[Math.min(call++, responses.length - 1)],
    }));
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  it('runs tool calls end-to-end and reports the final reply', async () => {
    const id = 'robot-1';
    const ctx = makeCtx({
      robots: [{ ...makeCtx().robots[0]!, trajectory: { ...makeCtx().robots[0]!.trajectory, id } }],
    });
    mockProvider([
      // round 1: model asks to set a delay
      { choices: [{ message: { role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'set_start_delay', arguments: JSON.stringify({ robotId: id, seconds: 0.5 }) } }] }, finish_reason: 'tool_calls' }] },
      // round 2: done
      { choices: [{ message: { role: 'assistant', content: 'Delayed it by 0.5 s.' }, finish_reason: 'stop' }] },
    ]);
    const events: AssistantEvent[] = [];
    await runAssistantInstruction('clear the collision', settings, ctx, (e) => events.push(e), async () => true);
    expect(ctx.calls.setStartDelay).toEqual([[id, 0.5]]);
    expect(events.some((e) => e.kind === 'action' && e.text.includes('0.5'))).toBe(true);
    expect(events.at(-1)?.kind).toBe('reply');
  });

  it('export/remove wait for explicit user approval', async () => {
    const id = 'robot-1';
    const base = makeCtx();
    const ctx = makeCtx({
      robots: [{ ...base.robots[0]!, trajectory: { ...base.robots[0]!.trajectory, id } }],
    });
    mockProvider([
      { choices: [{ message: { role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'export_file', arguments: JSON.stringify({ robotId: id, format: 'path' }) } }] }, finish_reason: 'tool_calls' }] },
      { choices: [{ message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }] },
    ]);
    const confirmations: ConfirmRequest[] = [];
    const events: AssistantEvent[] = [];
    await runAssistantInstruction(
      'export it',
      settings,
      ctx,
      (e) => events.push(e),
      async (req) => {
        confirmations.push(req);
        return false; // user denies
      },
    );
    expect(confirmations).toHaveLength(1);
    expect(ctx.calls.exportRobot).toBeUndefined(); // denied → never ran
    expect(events.some((e) => e.text.includes('denied by user'))).toBe(true);
  });
});

describe('key discipline (§6.4 red line)', () => {
  it('the API key never appears in session files', () => {
    saveAISettings({ ...DEFAULT_AI_SETTINGS, enabled: true, baseUrl: 'https://x', model: 'm', apiKey: 'sk-SECRET-KEY' });
    const traj = parseGhostAuto(read('ghostauto/straight_run.ghostauto'), 's');
    const text = serializeSession([makeSession(traj, 0)], 'rebuilt-2026');
    expect(text).not.toContain('SECRET');
    expect(text).not.toContain('apiKey');
    expect(text).not.toContain('ghpb.ai');
  });

  it('settings live in their own localStorage key and round-trip', () => {
    saveAISettings({ ...DEFAULT_AI_SETTINGS, enabled: true, baseUrl: 'https://x/v1', model: 'm', apiKey: 'k' });
    const back = loadAISettings();
    expect(back.apiKey).toBe('k');
    const stored = localStorage.getItem('ghpb.ai');
    expect(stored).toContain('"apiKey":"k"');
    // No other storage key exists — settings are fully isolated.
    expect(localStorage.getItem('ghpb.lang')).toBeNull();
  });
});
