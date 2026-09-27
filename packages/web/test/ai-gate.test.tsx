/**
 * The assistant's enable flag has to be a gate, not a hint (report §6.4;
 * AGENTS.md red line 1 as amended in v1.4): with the assistant off — which is
 * the default, and what the "no uploads, no telemetry" promise rests on — no
 * request may leave the browser at all. Before this, `enabled` only swapped a
 * button in the panel's empty state while `send()` never consulted it.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { chatCompletion } from '../src/ai/client';
import { runAssistantInstruction } from '../src/ai/assistant';
import { DEFAULT_AI_SETTINGS, type AISettings } from '../src/ai/settings';
import { stopReminderPump } from '../src/ai/actions';
import type { ActionContext } from '../src/ai/actions';
import { I18nProvider } from '../src/i18n';
import { AiPanel } from '../src/components/AiPanel';

// A real-shaped context: the system prompt reads ctx.robots, so a bare
// object would fail before the gate is ever reached.
const ctx: ActionContext = {
  robots: [],
  conflicts: [],
  setStartDelay: () => undefined,
  setAlliance: () => undefined,
  setTeamNumber: () => undefined,
  editWaypoint: () => undefined,
  addWaypoint: () => undefined,
  removeWaypoint: () => undefined,
  removeRobot: () => undefined,
  exportRobot: () => undefined,
  pushUndo: () => undefined,
};

const settings = (over: Partial<AISettings>): AISettings => ({
  ...DEFAULT_AI_SETTINGS,
  baseUrl: 'https://api.example.com/v1',
  model: 'some-model',
  apiKey: 'sk-test',
  ...over,
});

afterEach(() => {
  cleanup();
  stopReminderPump();
  vi.unstubAllGlobals();
});

const stubFetch = () => {
  const fetchMock = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }] }),
    text: async () => '{}',
  }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
};

describe('assistant disabled = no network, enforced at the client', () => {
  it.each(['openai', 'anthropic'] as const)(
    '%s: refuses without touching fetch',
    async (protocol) => {
      const fetchMock = stubFetch();
      const s = settings({ enabled: false, protocol });
      await expect(
        chatCompletion(s, [{ role: 'user', content: 'move robot 1' }]),
      ).rejects.toThrow(/disabled/i);
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it('the agent loop inherits the refusal', async () => {
    const fetchMock = stubFetch();
    // No try/catch sits between the loop and the client, so the gate surfaces
    // as a rejection the panel reports — never as a silent nothing.
    await expect(
      runAssistantInstruction(
        'delay robot 1 by 0.5s',
        settings({ enabled: false }),
        ctx,
        () => undefined,
        async () => true,
      ),
    ).rejects.toThrow(/disabled/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('an enabled assistant does reach the endpoint (the gate is not a block-everything flag)', async () => {
    const fetchMock = stubFetch();
    await chatCompletion(settings({ enabled: true }), [{ role: 'user', content: 'hi' }]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]![0])).toBe('https://api.example.com/v1/chat/completions');
  });
});

describe('assistant disabled = the composer cannot submit', () => {
  const mount = (s: AISettings) =>
    render(
      <I18nProvider>
        <AiPanel
          settings={s}
          onSettings={() => undefined}
          buildContext={() => ctx}
          undoLabel={null}
          onUndo={() => undefined}
          onAttachFiles={() => undefined}
          onOpenSettings={() => undefined}
        />
      </I18nProvider>,
    );

  it('locks the message box and the send button', () => {
    mount(settings({ enabled: false }));
    const box = document.querySelector('textarea') as HTMLTextAreaElement;
    const send = document.querySelector('.ai-send') as HTMLButtonElement;
    expect(box.disabled).toBe(true);
    expect(send.disabled).toBe(true);
  });

  it('typing plus Enter issues no request while disabled', () => {
    const fetchMock = stubFetch();
    mount(settings({ enabled: false }));
    const box = document.querySelector('textarea') as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: 'export everything' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('the same interaction is live once enabled', () => {
    stubFetch();
    mount(settings({ enabled: true }));
    const box = document.querySelector('textarea') as HTMLTextAreaElement;
    expect(box.disabled).toBe(false);
    // The button also waits for text, so type before checking it.
    fireEvent.change(box, { target: { value: 'hello' } });
    expect((document.querySelector('.ai-send') as HTMLButtonElement).disabled).toBe(false);
  });
});
