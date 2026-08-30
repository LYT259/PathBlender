/**
 * AI assistant settings (report v1.4 §6.4).
 *
 * Key discipline (red-line level): the API key lives in localStorage under
 * 'ghpb.ai' ONLY. It must never enter session files, share URLs, exports,
 * or logs — serializeSession/share-url structurally never see this module.
 */

export interface AISettings {
  enabled: boolean;
  /** Approval tier: standard confirms high-risk actions; full auto-approves
   *  (the harness "bypass/YOLO" mode — still whitelisted actions only). */
  permission: 'standard' | 'full';
  /** Reasoning effort hint passed as reasoning_effort (auto = omit). */
  effort: 'auto' | 'low' | 'medium' | 'high';
  /** Active provider id (see PROVIDER_PRESETS). */
  provider: string;
  baseUrl: string;
  model: string;
  apiKey: string;
  /** Saved API keys per provider — switch without re-entering. */
  keys: Record<string, string>;
}

/**
 * Provider presets (CCSwitch-style): picking a provider fills the endpoint
 * and model; every entry speaks the OpenAI-compatible protocol, so the
 * choice is simply "where your API key comes from" — a GLM key on the GLM
 * preset just works, no protocol decision needed.
 */
export interface ProviderPreset {
  id: string;
  label: string;
  baseUrl: string;
  model: string;
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
  { id: 'claude', label: 'Claude（Anthropic）', baseUrl: 'https://api.anthropic.com/v1', model: 'claude-sonnet-4-5' },
  // Official name: "OpenAI" (developers.openai.com). Codex is their coding
  // agent product, not the API provider name.
  { id: 'openai', label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  // Official provider name: 智谱 (global brand Z.ai, open platform
  // bigmodel.cn). GLM is the model series, not the provider name.
  { id: 'glm', label: '智谱（Z.ai）', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4.6' },
  { id: 'deepseek', label: 'DeepSeek（深度求索）', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
  { id: 'ollama', label: 'Ollama（本地）', baseUrl: 'http://localhost:11434/v1', model: 'qwen3:8b' },
  { id: 'custom', label: '自定义 Custom', baseUrl: '', model: '' },
];

export const DEFAULT_PROVIDER = 'glm';

export function providerPreset(id: string): ProviderPreset {
  return PROVIDER_PRESETS.find((p) => p.id === id) ?? PROVIDER_PRESETS[PROVIDER_PRESETS.length - 1]!;
}

export const DEFAULT_AI_SETTINGS: AISettings = {
  enabled: false,
  permission: 'standard',
  effort: 'auto',
  provider: DEFAULT_PROVIDER,
  baseUrl: '',
  model: '',
  apiKey: '',
  keys: {},
};

const STORAGE_KEY = 'ghpb.ai';

export function loadAISettings(): AISettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_AI_SETTINGS;
    const v = JSON.parse(raw) as Partial<AISettings>;
    const keys =
      v.keys && typeof v.keys === 'object'
        ? Object.fromEntries(
            Object.entries(v.keys).filter(([, k]) => typeof k === 'string'),
          )
        : v.apiKey
          ? { glm: v.apiKey }
          : {};
    // 2026-08 rename: the OpenAI preset used to ship under the id 'codex'.
    if (v.provider === 'codex') v.provider = 'openai';
    if (v.keys && typeof v.keys === 'object' && v.keys.codex) {
      v.keys = { ...v.keys, openai: v.keys.codex };
      delete v.keys.codex;
    }
    const permission = v.permission === 'full' ? 'full' : 'standard';
    const effort =
      v.effort === 'low' || v.effort === 'medium' || v.effort === 'high' ? v.effort : 'auto';
    return {
      enabled: Boolean(v.enabled),
      permission,
      effort,
      provider: typeof v.provider === 'string' ? v.provider : DEFAULT_PROVIDER,
      baseUrl: typeof v.baseUrl === 'string' ? v.baseUrl : '',
      model: typeof v.model === 'string' ? v.model : '',
      apiKey: typeof v.apiKey === 'string' ? v.apiKey : '',
      keys,
    };
  } catch {
    return DEFAULT_AI_SETTINGS;
  }
}

export function saveAISettings(s: AISettings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
}

/** Disable the assistant but KEEP saved keys (reconnect stays one click). */
export function disconnectAI(current: AISettings): AISettings {
  const next = { ...current, enabled: false, apiKey: '' };
  saveAISettings(next);
  return next;
}
