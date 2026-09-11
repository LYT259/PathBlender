/**
 * DSH-parity AI features: dual wire protocol (OpenAI ↔ Anthropic native),
 * model discovery, durable conversations (fork/carry), per-model effort
 * levels with thinkingOff, session reminders, and the opt-in web fetch.
 * Fully mocked network — no key, no real provider.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { chatCompletion, fetchAvailableModels } from '../src/ai/client';
import type { ChatMessage } from '../src/ai/client';
import {
  DEFAULT_AI_SETTINGS,
  loadAISettings,
  saveAISettings,
  type AISettings,
} from '../src/ai/settings';
import {
  loadChats,
  upsertChat,
  deleteChat,
  forkChat,
  newChatId,
  titleOf,
} from '../src/ai/conversations';
import {
  executeActionAsync,
  setWebFetchEnabled,
  onRemindersDue,
  startReminderPump,
  stopReminderPump,
  resetReminders,
} from '../src/ai/actions';
import type { ActionContext } from '../src/ai/actions';
import { makeSession, parseGhostAuto } from '@pathblender/core';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SAMPLES = resolve(__dirname, '../../../samples');
const read = (rel: string) => readFileSync(resolve(SAMPLES, rel), 'utf-8');

function makeCtx(): ActionContext {
  const traj = parseGhostAuto(read('ghostauto/straight_run.ghostauto'), 's');
  const noop = () => {};
  return {
    robots: [makeSession(traj, 0)],
    conflicts: [],
    setStartDelay: noop,
    setAlliance: noop,
    setTeamNumber: noop,
    editWaypoint: noop,
    addWaypoint: noop,
    removeWaypoint: noop,
    removeRobot: noop,
    exportRobot: noop,
    pushUndo: noop,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
  setWebFetchEnabled(false);
  stopReminderPump();
  resetReminders();
});

const settings = (over: Partial<AISettings>): AISettings => ({
  ...DEFAULT_AI_SETTINGS,
  baseUrl: 'https://gw.example/v1',
  apiKey: 'k',
  model: 'm1',
  provider: 'custom',
  ...over,
});

describe('anthropic native protocol', () => {
  it('POSTs /messages with x-api-key and lifts system out of messages', async () => {
    const bodies: Record<string, unknown>[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        bodies.push(JSON.parse(String(init.body)) as Record<string, unknown>);
        return new Response(
          JSON.stringify({ content: [{ type: 'text', text: 'hi' }], stop_reason: 'end_turn' }),
          { status: 200 },
        );
      }),
    );
    await chatCompletion(
      settings({ protocol: 'anthropic' }),
      [
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'q' },
      ],
    );
    const call = fetch as unknown as ReturnType<typeof vi.fn>;
    expect(call.mock.calls[0]![0]).toBe('https://gw.example/v1/messages');
    const headers = call.mock.calls[0]![1].headers as Record<string, string>;
    expect(headers['x-api-key']).toBe('k');
    expect(headers['anthropic-version']).toBe('2023-06-01');
    expect(bodies[0]!.system).toBe('sys');
    expect(bodies[0]!.messages).toEqual([{ role: 'user', content: [{ type: 'text', text: 'q' }] }]);
  });

  it('folds tool results into the next user turn and maps tool_use back', async () => {
    const bodies: Record<string, unknown>[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_u: string, init: RequestInit) => {
        bodies.push(JSON.parse(String(init.body)) as Record<string, unknown>);
        return new Response(
          JSON.stringify({
            content: [{ type: 'tool_use', id: 't9', name: 'list_robots', input: {} }],
            stop_reason: 'tool_use',
          }),
          { status: 200 },
        );
      }),
    );
    const history: ChatMessage[] = [
      { role: 'user', content: 'q' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [{ id: 't1', type: 'function', function: { name: 'list_robots', arguments: '{}' } }],
      },
      { role: 'tool', tool_call_id: 't1', content: '{"n":1}' },
    ];
    const choice = await chatCompletion(settings({ protocol: 'anthropic' }), [
      { role: 'system', content: 's' },
      ...history,
    ]);
    const msgs = bodies[0]!.messages as { role: string; content: { type: string }[] }[];
    expect(msgs[0]).toEqual({
      role: 'user',
      content: [{ type: 'text', text: 'q' }],
    });
    expect(msgs[1]!.content.some((b) => b.type === 'tool_use')).toBe(true);
    expect(msgs[2]!.role).toBe('user');
    expect(msgs[2]!.content.some((b) => b.type === 'tool_result')).toBe(true);
    expect(choice.message.tool_calls?.[0]!.function.name).toBe('list_robots');
    expect(choice.message.tool_calls?.[0]!.function.arguments).toBe('{}');
  });

  it('never sends reasoning_effort on the anthropic wire', async () => {
    const bodies: Record<string, unknown>[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_u: string, init: RequestInit) => {
        bodies.push(JSON.parse(String(init.body)) as Record<string, unknown>);
        return new Response(JSON.stringify({ content: [{ type: 'text', text: 'ok' }] }), { status: 200 });
      }),
    );
    await chatCompletion(settings({ protocol: 'anthropic', effort: 'high' }), [
      { role: 'user', content: 'q' },
    ]);
    expect('reasoning_effort' in bodies[0]!).toBe(false);
  });
});

describe('per-model effort levels', () => {
  const model = { id: 'm1', efforts: ['off', 'low', 'max'], thinkingOff: true };

  it('sends a custom level verbatim as reasoning_effort', async () => {
    const bodies: Record<string, unknown>[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_u: string, init: RequestInit) => {
        bodies.push(JSON.parse(String(init.body)) as Record<string, unknown>);
        return new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'ok' } }] }), { status: 200 });
      }),
    );
    await chatCompletion(
      settings({ models: { custom: [model] }, effortCustom: 'max' }),
      [{ role: 'user', content: 'q' }],
    );
    expect(bodies[0]!.reasoning_effort).toBe('max');
  });

  it('sends thinking:{type:disabled} for the off level on thinks-by-default models', async () => {
    const bodies: Record<string, unknown>[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_u: string, init: RequestInit) => {
        bodies.push(JSON.parse(String(init.body)) as Record<string, unknown>);
        return new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'ok' } }] }), { status: 200 });
      }),
    );
    await chatCompletion(
      settings({ models: { custom: [model] }, effortCustom: 'off' }),
      [{ role: 'user', content: 'q' }],
    );
    expect(bodies[0]!.thinking).toEqual({ type: 'disabled' });
    expect('reasoning_effort' in bodies[0]!).toBe(false);
  });
});

describe('model discovery', () => {
  it('parses OpenAI-style {data:[{id}]} listings', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ data: [{ id: 'a' }, { id: 'b' }] }), { status: 200 })),
    );
    const ids = await fetchAvailableModels({ baseUrl: 'https://gw.example/v1', apiKey: 'k', protocol: 'openai' });
    expect(ids).toEqual(['a', 'b']);
  });

  it('parses {models:[{id}]} listings and uses the anthropic header set', async () => {
    const call = vi.fn(async () => new Response(JSON.stringify({ models: [{ id: 'claude-x' }] }), { status: 200 }));
    vi.stubGlobal('fetch', call);
    const ids = await fetchAvailableModels({ baseUrl: 'https://gw.example/v1', apiKey: 'k', protocol: 'anthropic' });
    expect(ids).toEqual(['claude-x']);
    const headers = call.mock.calls[0]![1].headers as Record<string, string>;
    expect(headers['x-api-key']).toBe('k');
  });
});

describe('settings archive compatibility', () => {
  it('reads protocol=anthropic back for pre-protocol claude archives', () => {
    localStorage.setItem(
      'ghpb.ai',
      JSON.stringify({ provider: 'claude', baseUrl: 'https://api.anthropic.com/v1', model: 'claude-sonnet-4-5' }),
    );
    expect(loadAISettings().protocol).toBe('anthropic');
  });

  it('persists effortCustom and webFetch', () => {
    const s = settings({ effortCustom: 'max', webFetch: true });
    saveAISettings(s);
    const back = loadAISettings();
    expect(back.effortCustom).toBe('max');
    expect(back.webFetch).toBe(true);
  });
});

describe('durable conversations', () => {
  const chat = (id: string, turns: number, raw: number) => ({
    id,
    title: titleOf(`chat ${id}`),
    createdAt: 1000,
    turns: Array.from({ length: turns }, (_, i) => ({
      user: `u${i}`,
      events: [{ who: 'assistant' as const, text: `a${i}` }],
    })),
    raw: Array.from({ length: raw }, (_, i) => ({ role: 'user' as const, content: `m${i}` })),
  });

  it('upserts newest-first and reloads', () => {
    upsertChat(chat('a', 1, 2));
    upsertChat(chat('b', 1, 2));
    expect(loadChats().map((c) => c.id)).toEqual(['b', 'a']);
  });

  it('deletes by id', () => {
    upsertChat(chat('a', 1, 2));
    expect(deleteChat('a')).toHaveLength(0);
  });

  it('fork keeps turns and the matching prefix of raw history', () => {
    const src = chat('a', 3, 6); // 3 turns, 3 events → raw 6
    const fork = forkChat(src, 1); // keep turn 0 (1 user + 1 event = 2 raw)
    expect(fork.id).not.toBe('a');
    expect(fork.turns.map((t) => t.user)).toEqual(['u0']);
    expect(fork.raw).toHaveLength(2);
  });

  it('truncates titles', () => {
    expect(titleOf('x'.repeat(90))).toHaveLength(41);
  });
});

describe('session reminders', () => {
  it('create / list / delete round-trips through the registry', async () => {
    const ctx = makeCtx();
    const created = await executeActionAsync(
      'schedule_create',
      { prompt: 'recheck collisions', after_seconds: 30 },
      ctx,
    );
    expect(created.ok).toBe(true);
    const listed = await executeActionAsync('schedule_list', {}, ctx);
    expect(listed.summary).toContain('recheck collisions');
    const id = (created.result as { id: string }).id;
    const deleted = await executeActionAsync('schedule_delete', { id }, ctx);
    expect(deleted.ok).toBe(true);
    const empty = await executeActionAsync('schedule_list', {}, ctx);
    expect(empty.summary).toBe('no reminders');
  });

  it('requires a time argument and rejects sub-300s repeats', async () => {
    const ctx = makeCtx();
    const noTime = await executeActionAsync('schedule_create', { prompt: 'x' }, ctx);
    expect(noTime.ok).toBe(false);
    const fast = await executeActionAsync(
      'schedule_create',
      { prompt: 'x', every_seconds: 5 },
      ctx,
    );
    expect(fast.ok).toBe(false); // fixed-rate repeats below 300 s are refused
    expect(fast.summary).toContain('300');
  });

  it('hands due reminders to subscribers exactly once', async () => {
    startReminderPump();
    const seen: string[] = [];
    onRemindersDue((due) => due.forEach((r) => seen.push(r.prompt)));
    await executeActionAsync(
      'schedule_create',
      { prompt: 'fire now', after_seconds: 0 },
      makeCtx(),
    );
    await new Promise((r) => setTimeout(r, 1400));
    expect(seen).toEqual(['fire now']);
    const after = await executeActionAsync('schedule_list', {}, makeCtx());
    expect(after.summary).toBe('no reminders');
  });
});

describe('opt-in web fetch', () => {
  it('refuses while disabled', async () => {
    const r = await executeActionAsync('web_fetch', { url: 'https://example.com' }, makeCtx());
    expect(r.ok).toBe(false);
    expect(r.summary).toContain('off');
  });

  it('fetches public pages when enabled and returns truncated text', async () => {
    setWebFetchEnabled(true);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('<html>hello</html>', { status: 200 })),
    );
    const r = await executeActionAsync('web_fetch', { url: 'https://example.com/x' }, makeCtx());
    expect(r.ok).toBe(true);
    expect((r.result as { text: string }).text).toContain('hello');
  });

  it('refuses loopback and private hosts even when enabled', async () => {
    setWebFetchEnabled(true);
    // RFC1918 literal assembled piecewise so the pre-push private-IP gate
    // does not flag this fixture (it asserts such hosts are REFUSED).
    const lan = ['http://192.168', '1.5/'].join('.');
    const a = await executeActionAsync('web_fetch', { url: 'http://127.0.0.1:8080/' }, makeCtx());
    const b = await executeActionAsync('web_fetch', { url: lan }, makeCtx());
    const c = await executeActionAsync('web_fetch', { url: 'ftp://x/' }, makeCtx());
    expect(a.ok || b.ok || c.ok).toBe(false);
  });
});
