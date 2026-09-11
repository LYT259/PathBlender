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
  /** Model list per provider (call id / display name / context size). */
  models: Record<string, ModelEntry[]>;
  /** Wire protocol: 'openai' (chat/completions, the default) or 'anthropic'
   *  (native /v1/messages — the official Anthropic endpoint needs it). */
  protocol: 'openai' | 'anthropic';
  /** Custom effort level picked from the active model's efforts[] list —
   *  takes precedence over `effort` when set (cleared on model switch). */
  effortCustom?: string;
  /** Opt-in read-only web_fetch action (default off — red-line: explicit
   *  data-flow consent before any extra network feature). */
  webFetch?: boolean;
}

/**
 * Provider presets (CCSwitch-style): picking a provider fills the endpoint
 * and model. Most presets speak the OpenAI-compatible protocol; Anthropic's
 * official endpoint only speaks its native Messages API, so that preset
 * declares protocol 'anthropic'.
 */
export interface ProviderPreset {
  id: string;
  label: string;
  baseUrl: string;
  model: string;
  protocol: 'openai' | 'anthropic';
}

/** A configured model (CC Switch style): call id, display name, context. */
export interface ModelEntry {
  /** API call name (e.g. glm-4.6). */
  id: string;
  /** Display name override (e.g. 旗舰). */
  name?: string;
  /** Context window in k tokens (drives the composer gauge). */
  ctxK?: number;
  /** Declares image input — attachments send as vision content (DSH-style
   *  modality claim: the model refuses images unless this is set). */
  vision?: boolean;
  /** Custom reasoning-effort levels sent verbatim as reasoning_effort.
   *  Empty/off entry = send nothing (stops only endpoints that think on
   *  request); see thinkingOff for models that think by default. */
  efforts?: string[];
  /** DeepSeek-style models that think unless told not to: selecting the
   *  first (off) effort level sends thinking:{type:'disabled'} instead. */
  thinkingOff?: boolean;
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
  { id: 'claude', label: 'Claude（Anthropic）', baseUrl: 'https://api.anthropic.com/v1', model: 'claude-sonnet-4-5', protocol: 'anthropic' },
  // Official name: "OpenAI" (developers.openai.com). Codex is their coding
  // agent product, not the API provider name.
  { id: 'openai', label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini', protocol: 'openai' },
  // Official provider name: 智谱 (global brand Z.ai, open platform
  // bigmodel.cn). GLM is the model series, not the provider name.
  { id: 'glm', label: '智谱（Z.ai）', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4.6', protocol: 'openai' },
  { id: 'deepseek', label: 'DeepSeek（深度求索）', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat', protocol: 'openai' },
  { id: 'ollama', label: 'Ollama（本地）', baseUrl: 'http://localhost:11434/v1', model: 'qwen3:8b', protocol: 'openai' },
  { id: 'custom', label: '自定义 Custom', baseUrl: '', model: '', protocol: 'openai' },
];

export const DEFAULT_PROVIDER = 'glm';

export function providerPreset(id: string): ProviderPreset {
  return PROVIDER_PRESETS.find((p) => p.id === id) ?? PROVIDER_PRESETS[PROVIDER_PRESETS.length - 1]!;
}

/** Every provider starts with its preset model as the first list entry. */
function seedModels(): Record<string, ModelEntry[]> {
  return Object.fromEntries(
    PROVIDER_PRESETS.filter((p) => p.id !== 'custom').map((p) => [p.id, [{ id: p.model }]]),
  );
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
  models: seedModels(),
  protocol: 'openai',
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
    const provider = typeof v.provider === 'string' ? v.provider : DEFAULT_PROVIDER;
    // Pre-protocol archives: the official Anthropic preset has always needed
    // its native Messages API — read that back for the claude provider.
    const protocol: AISettings['protocol'] =
      v.protocol === 'anthropic' || (v.protocol == null && provider === 'claude')
        ? 'anthropic'
        : 'openai';
    const models =
      v.models && typeof v.models === 'object' && !Array.isArray(v.models)
        ? Object.fromEntries(
            Object.entries(v.models as Record<string, unknown>).map(([k, val]) => [
              k,
              (Array.isArray(val) ? val : []).filter(
                (m): m is ModelEntry =>
                  typeof m === 'object' && m !== null && typeof (m as ModelEntry).id === 'string',
              ),
            ]),
          )
        : {};
    // Seed providers that have no list yet with their preset default.
    const seed = seedModels();
    for (const [id, list] of Object.entries(seed)) {
      if (!models[id]?.length) models[id] = list;
    }
    return {
      enabled: Boolean(v.enabled),
      permission,
      effort,
      protocol,
      effortCustom: typeof v.effortCustom === 'string' ? v.effortCustom : undefined,
      webFetch: v.webFetch === true,
      provider: typeof v.provider === 'string' ? v.provider : DEFAULT_PROVIDER,
      baseUrl: typeof v.baseUrl === 'string' ? v.baseUrl : '',
      model: typeof v.model === 'string' ? v.model : '',
      apiKey: typeof v.apiKey === 'string' ? v.apiKey : '',
      keys,
      models,
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
