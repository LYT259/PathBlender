/**
 * Chat client speaking two wire protocols (report v1.4 §6.4, DSH parity):
 *  - 'openai': POST {base}/chat/completions (GLM, OpenAI, DeepSeek, Ollama,
 *    and any OpenAI-compatible gateway)
 *  - 'anthropic': POST {base}/messages with x-api-key + anthropic-version
 *    (the official Anthropic endpoint; tool calls in native tool_use form)
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
  /** Vision content (image attachments) alongside the text. */
  images?: { mimeType: string; base64: string }[];
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
  // The enable flag is the privacy gate, so it is enforced here at the one
  // place every assistant request must pass through — not left to the caller
  // to remember. Path data leaves the browser only while the user has turned
  // the assistant on (report §6.4, AGENTS.md red line 1 v1.4 addendum).
  if (!settings.enabled) throw new Error('assistant is disabled');
  const choice =
    settings.protocol === 'anthropic'
      ? await anthropicCompletion(settings, messages, opts?.signal)
      : await openaiCompletion(settings, messages, opts?.signal);
  return choice;
}

/** Effort handling for the OpenAI wire: a per-model custom level sends
 *  verbatim; the "off" (first) level of a thinkingOff model sends
 *  thinking:{type:'disabled'} instead of the effort field. */
function openaiEffortBody(settings: AISettings): Record<string, unknown> {
  const level =
    settings.effortCustom ?? (settings.effort !== 'auto' ? settings.effort : null);
  if (!level) return {};
  const entry = settings.models[settings.provider]?.find((m) => m.id === settings.model);
  if (entry?.efforts?.length && level === entry.efforts[0] && entry.thinkingOff) {
    // "off" on a thinks-by-default model (e.g. DeepSeek V4 behind a gateway)
    return { thinking: { type: 'disabled' } };
  }
  return { reasoning_effort: level };
}

async function openaiCompletion(
  settings: AISettings,
  messages: ChatMessage[],
  signal?: AbortSignal,
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
      messages: messages.map(openaiMessage),
      tools: registry.llmTools(),
      ...openaiEffortBody(settings),
    }),
    signal,
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

/** Mixed text/image user content in the OpenAI vision format. */
function openaiMessage(m: ChatMessage): ChatMessage {
  if (m.role !== 'user' || !m.images?.length) return m;
  return {
    ...m,
    content: [
      ...(m.content ? [{ type: 'text', text: m.content }] : []),
      ...m.images.map((img) => ({
        type: 'image_url',
        image_url: { url: `data:${img.mimeType};base64,${img.base64}` },
      })),
    ],
  } as unknown as ChatMessage;
}

// ---------- Anthropic native Messages API ----------

interface AnthropicBlock {
  type: string;
  [k: string]: unknown;
}

async function anthropicCompletion(
  settings: AISettings,
  messages: ChatMessage[],
  signal?: AbortSignal,
): Promise<ChatChoice> {
  const url = `${settings.baseUrl.replace(/\/$/, '')}/messages`;
  const system = messages
    .filter((m) => m.role === 'system')
    .map((m) => m.content ?? '')
    .join('\n\n');
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': settings.apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: settings.model,
      max_tokens: 4096,
      ...(system ? { system } : {}),
      messages: anthropicMessages(messages),
      tools: registry.llmTools().map((tl) => ({
        name: tl.function.name,
        description: tl.function.description,
        input_schema: tl.function.parameters,
      })),
    }),
    signal,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`AI request failed: ${res.status} ${body.slice(0, 200)}`);
  }
  const data = (await res.json()) as { content?: AnthropicBlock[]; stop_reason?: string };
  const blocks = data.content ?? [];
  const text = blocks
    .filter((b) => b.type === 'text')
    .map((b) => String(b.text ?? ''))
    .join('');
  const toolCalls = blocks
    .filter((b) => b.type === 'tool_use')
    .map((b) => ({
      id: String(b.id ?? ''),
      type: 'function' as const,
      function: {
        name: String(b.name ?? ''),
        arguments: JSON.stringify(b.input ?? {}),
      },
    }));
  return {
    message: {
      role: 'assistant',
      content: text || null,
      ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
    },
    finish_reason: data.stop_reason ?? 'stop',
  };
}

/** Internal ChatMessage[] → Anthropic messages (system lifted out, tool
 *  results folded into user turns as tool_result blocks, images native). */
function anthropicMessages(messages: ChatMessage[]): { role: 'user' | 'assistant'; content: unknown }[] {
  const out: { role: 'user' | 'assistant'; content: unknown }[] = [];
  for (const m of messages) {
    if (m.role === 'system') continue;
    if (m.role === 'assistant') {
      out.push({
        role: 'assistant',
        content: [
          ...(m.content ? [{ type: 'text', text: m.content }] : []),
          ...(m.tool_calls ?? []).map((c) => ({
            type: 'tool_use',
            id: c.id,
            name: c.function.name,
            input: JSON.parse(c.function.arguments || '{}') as unknown,
          })),
        ],
      });
      continue;
    }
    if (m.role === 'tool') {
      // Anthropic requires tool_result inside the NEXT user message.
      const block = { type: 'tool_result', tool_use_id: m.tool_call_id, content: m.content ?? '' };
      const last = out[out.length - 1];
      if (last && last.role === 'user' && Array.isArray(last.content)) last.content.push(block);
      else out.push({ role: 'user', content: [block] });
      continue;
    }
    out.push({
      role: 'user',
      content: [
        ...(m.content ? [{ type: 'text', text: m.content }] : []),
        ...(m.images ?? []).map((img) => ({
          type: 'image',
          source: { type: 'base64', media_type: img.mimeType, data: img.base64 },
        })),
      ],
    });
  }
  // Anthropic requires the first message to be from the user.
  while (out.length > 0 && out[0]!.role !== 'user') out.shift();
  return out;
}

/** Model discovery (DSH "Fetch available models"): GET {base}/models on
 *  either protocol. Returns call ids; empty when the endpoint does not
 *  publish a listing we understand (manual entry still works). */
export async function fetchAvailableModels(
  settings: Pick<AISettings, 'baseUrl' | 'apiKey' | 'protocol'>,
  signal?: AbortSignal,
): Promise<string[]> {
  const base = settings.baseUrl.replace(/\/$/, '');
  if (!base) return [];
  const res = await fetch(`${base}/models`, {
    headers:
      settings.protocol === 'anthropic'
        ? { 'x-api-key': settings.apiKey, 'anthropic-version': '2023-06-01' }
        : settings.apiKey
          ? { authorization: `Bearer ${settings.apiKey}` }
          : {},
    signal,
  });
  if (!res.ok) throw new Error(`model discovery failed: ${res.status}`);
  const data = (await res.json()) as { data?: { id?: string }[]; models?: { id?: string }[] };
  const list = data.data ?? data.models ?? [];
  return list.map((m) => m.id ?? '').filter(Boolean);
}
