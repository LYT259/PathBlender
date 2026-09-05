/**
 * AI settings (the single Preferences entry, round 12): provider, key,
 * endpoint, per-provider model list (CC Switch style), test connection.
 * Extracted from the old AiPanel settings view — the panel itself is now
 * chat-only; its gear opens Preferences which renders this section.
 */

import { useState } from 'react';
import {
  PROVIDER_PRESETS,
  providerPreset,
  type AISettings,
  type ModelEntry,
} from '../ai/settings';
import { useI18n } from '../i18n';

interface Props {
  settings: AISettings;
  onSettings: (s: AISettings) => void;
}

export function AiSettingsSection({ settings, onSettings }: Props) {
  const { t } = useI18n();
  const [showKey, setShowKey] = useState(false);
  const [testing, setTesting] = useState<'idle' | 'busy' | 'ok' | 'fail'>('idle');
  const [draft, setDraft] = useState(() => ({
    provider: settings.provider,
    baseUrl: settings.baseUrl,
    apiKey: settings.apiKey,
  }));

  const pickProvider = (key: string) => {
    const preset = providerPreset(key);
    const first = (settings.models[key] ?? [{ id: preset.model }])[0]?.id ?? preset.model;
    setDraft((d) => ({ ...d, provider: key, baseUrl: preset.baseUrl, apiKey: settings.keys[key] ?? d.apiKey }));
    onSettings({ ...settings, provider: key, baseUrl: preset.baseUrl, model: first, apiKey: settings.keys[key] ?? settings.apiKey, enabled: true });
  };

  const onKeyPaste = (key: string) => {
    setDraft((d) => {
      if (key.trim().length < 8) return { ...d, apiKey: key };
      const preset = providerPreset(d.provider);
      const baseUrl = settings.baseUrl || preset.baseUrl;
      const model = settings.model || preset.model;
      onSettings({ ...settings, apiKey: key, baseUrl, model, enabled: true });
      return { ...d, apiKey: key };
    });
  };

  const saveEndpoint = () => {
    onSettings({ ...settings, baseUrl: draft.baseUrl });
  };

  const testConnection = async () => {
    setTesting('busy');
    try {
      const res = await fetch(`${settings.baseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(settings.apiKey ? { authorization: `Bearer ${settings.apiKey}` } : {}),
        },
        body: JSON.stringify({ model: settings.model, messages: [{ role: 'user', content: 'ping' }], max_tokens: 1 }),
      });
      setTesting(res.ok ? 'ok' : 'fail');
    } catch {
      setTesting('fail');
    }
  };

  const setModelField = (idx: number, patch: Partial<ModelEntry>) => {
    const list = settings.models[settings.provider] ?? [];
    onSettings({
      ...settings,
      models: {
        ...settings.models,
        [settings.provider]: list.map((m, j) => (j === idx ? { ...m, ...patch } : m)),
      },
    });
  };

  return (
    <>
      <label className="ai-row">
        <span>{t('ai.provider')}</span>
        <select value={settings.provider} onChange={(e) => pickProvider(e.target.value)}>
          {PROVIDER_PRESETS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
      </label>

      <label className="ai-row">
        <span>{t('ai.apiKey')}</span>
        <span className="ai-key-row">
          <input
            type={showKey ? 'text' : 'password'}
            autoComplete="off"
            placeholder="sk-…"
            value={draft.apiKey}
            onChange={(e) => onKeyPaste(e.target.value)}
          />
          <button
            type="button"
            className="ai-icon-btn"
            title={t('ai.showKey')}
            onClick={() => setShowKey((v) => !v)}
          >
            {showKey ? <EyeOffIcon /> : <EyeIcon />}
          </button>
        </span>
      </label>

      <label className="ai-row">
        <span>{t('ai.baseUrl')}</span>
        <input
          type="url"
          value={draft.baseUrl}
          onChange={(e) => setDraft((d) => ({ ...d, baseUrl: e.target.value }))}
          onBlur={saveEndpoint}
        />
      </label>

      <div className="ai-models">
        <div className="ai-models-head">
          <span>{t('ai.models')}</span>
          <button
            className="btn small"
            onClick={() =>
              onSettings({
                ...settings,
                models: {
                  ...settings.models,
                  [settings.provider]: [
                    ...(settings.models[settings.provider] ?? []),
                    { id: '' },
                  ],
                },
              })
            }
          >
            + {t('ai.addModel')}
          </button>
        </div>
        {(settings.models[settings.provider] ?? []).map((m, i) => {
          const list = settings.models[settings.provider] ?? [];
          const active = settings.model === m.id;
          return (
            <div className={`ai-model-row ${active ? 'active' : ''}`} key={i}>
              <button
                className="ai-model-pick"
                title={t('ai.useModel')}
                onClick={() => onSettings({ ...settings, model: m.id, enabled: true })}
              >
                ●
              </button>
              <input className="m-id" placeholder={t('ai.modelId')} value={m.id}
                onChange={(e) => setModelField(i, { id: e.target.value })} />
              <input className="m-name" placeholder={t('ai.modelName')} value={m.name ?? ''}
                onChange={(e) => setModelField(i, { name: e.target.value })} />
              <input className="m-ctx" placeholder="128" inputMode="numeric" value={m.ctxK ?? ''}
                onChange={(e) => setModelField(i, { ctxK: e.target.value === '' ? undefined : Number(e.target.value) || undefined })}
                title={t('ai.ctxK')} />
              <button className="robot-remove" title={t('robots.remove')}
                onClick={() => onSettings({ ...settings, models: { ...settings.models, [settings.provider]: list.filter((_, j) => j !== i) } })}>
                ✕
              </button>
            </div>
          );
        })}
      </div>

      <div className="ai-row btns">
        <button className="btn small" disabled={!settings.baseUrl} onClick={() => void testConnection()}>
          {testing === 'idle' ? t('ai.test') : testing === 'ok' ? t('ai.testOk') : testing === 'fail' ? t('ai.testFail') : t('ai.testing')}
        </button>
        {settings.enabled && (
          <button
            className="btn small danger"
            onClick={() => {
              const next = { ...settings, enabled: false, apiKey: '' };
              onSettings(next);
              setDraft({ provider: next.provider, baseUrl: '', apiKey: '' });
            }}
          >
            {t('ai.disconnect')}
          </button>
        )}
      </div>
    </>
  );
}

/** Feather-style eye / eye-off (MIT, feathericons.com — shape only). */
function EyeIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}
function EyeOffIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
      <path d="M1 1l22 22" />
    </svg>
  );
}
