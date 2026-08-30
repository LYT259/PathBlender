/**
 * Minimal OpenAI-compatible chat/completions client (report v1.4 §6.4).
 * Works with GLM (Ark endpoint), OpenAI, DeepSeek, and local Ollama —
 * anything speaking the OpenAI wire format with tool calling.
 *
 * The only fetch in this codebase: fired solely against the user-configured
 * base URL, only while the assistant is enabled (default off).
 */

import type { AISettings } from './settings';
import { registry } from './actions';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
}

export interface ChatChoice {
  message: {
    role: 'assistant';
    content: string | null;
    tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[];
  };
  finish_reason: string;
}

export async function chatCompletion(
  settings: AISettings,
  messages: ChatMessage[],
  opts?: { signal?: AbortSignal },
): Promise<ChatChoice> {
  const url = `${settings.baseUrl.replace(/\/$/, '')}/chat/completions`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(settings.apiKey ? { authorization: `Bearer ${settings.apiKey}` } : {}),
    },
    body: JSON.stringify({
      model: settings.model,
      messages,
      tools: registry.llmTools(),
    }),
    signal: opts?.signal,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`AI request failed: ${res.status} ${body.slice(0, 200)}`);
  }
  const data = (await res.json()) as { choices?: ChatChoice[] };
  const choice = data.choices?.[0];
  if (!choice) throw new Error('AI response contained no choices');
  return choice;
}
