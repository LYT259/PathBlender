/**
 * AI settings (the single Preferences entry, round 12): provider, key,
 * endpoint, per-provider model list (CC Switch style), test connection.
 * Extracted from the old AiPanel settings view — the panel itself is now
 * chat-only; its gear opens Preferences which renders this section.
 *
 * DSH-parity additions: model discovery (fetch the endpoint's model list
 * and tick what to add) and write-only key display (saved keys show as a
 * redacted hint until re-entered).
 */

import { useState } from 'react';
import {
  PROVIDER_PRESETS,
  providerPreset,
  type AISettings,
  type ModelEntry,
} from '../ai/settings';
import { fetchAvailableModels } from '../ai/client';
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
    apiKey: '',
  }));
  // Model discovery state: null = closed, otherwise the fetched id list.
  const [discovery, setDiscovery] = useState<
    { state: 'busy' } | { state: 'fail' } | { state: 'list'; ids: string[]; picked: Set<string>; query: string } | null
  >(null);

  const savedKey = settings.keys[settings.provider] ?? (settings.provider === draft.provider ? settings.apiKey : '');
  const keyHint = savedKey ? `••••${savedKey.slice(-4)}` : '';

  const pickProvider = (key: string) => {
    const preset = providerPreset(key);
    const first = (settings.models[key] ?? [{ id: preset.model }])[0]?.id ?? preset.model;
    setDraft((d) => ({ ...d, provider: key, baseUrl: preset.baseUrl, apiKey: '' }));
    onSettings({
      ...settings,
      provider: key,
      baseUrl: preset.baseUrl,
      protocol: preset.protocol,
      model: first,
      apiKey: settings.keys[key] ?? '',
      enabled: true,
    });
  };

  const onKeyInput = (key: string) => {
    setDraft((d) => ({ ...d, apiKey: key }));
    if (key.trim().length < 8) return;
    const preset = providerPreset(draft.provider);
    const baseUrl = settings.baseUrl || preset.baseUrl;
    const model = settings.model || preset.model;
    onSettings({ ...settings, apiKey: key, baseUrl, model, enabled: true });
  };

  const saveEndpoint = () => {
    onSettings({ ...settings, baseUrl: draft.baseUrl });
  };

  const testConnection = async () => {
    setTesting('busy');
    try {
      const res =
        settings.protocol === 'anthropic'
          ? await fetch(`${settings.baseUrl.replace(/\/$/, '')}/messages`, {
              method: 'POST',
              headers: {
                'content-type': 'application/json',
                'x-api-key': settings.apiKey,
                'anthropic-version': '2023-06-01',
              },
              body: JSON.stringify({
                model: settings.model,
                max_tokens: 1,
                messages: [{ role: 'user', content: 'ping' }],
              }),
            })
          : await fetch(`${settings.baseUrl.replace(/\/$/, '')}/chat/completions`, {
              method: 'POST',
              headers: {
                'content-type': 'application/json',
                ...(settings.apiKey ? { authorization: `Bearer ${settings.apiKey}` } : {}),
              },
              body: JSON.stringify({
                model: settings.model,
                messages: [{ role: 'user', content: 'ping' }],
                max_tokens: 1,
              }),
            });
      setTesting(res.ok ? 'ok' : 'fail');
    } catch {
      setTesting('fail');
    }
  };

  const discover = async () => {
    setDiscovery({ state: 'busy' });
    try {
      const ids = await fetchAvailableModels(settings);
      setDiscovery({ state: 'list', ids, picked: new Set<string>(), query: '' });
    } catch {
      setDiscovery({ state: 'fail' });
    }
  };

  const addPicked = () => {
    if (!discovery || discovery.state !== 'list') return;
    const existing = new Set((settings.models[settings.provider] ?? []).map((m) => m.id));
    const additions = [...discovery.picked].filter((id) => !existing.has(id)).map((id) => ({ id }));
    if (additions.length) {
      onSettings({
        ...settings,
        models: {
          ...settings.models,
          [settings.provider]: [...(settings.models[settings.provider] ?? []), ...additions],
        },
      });
    }
    setDiscovery(null);
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
            placeholder={keyHint || 'sk-…'}
            value={draft.apiKey}
            onChange={(e) => onKeyInput(e.target.value)}
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

      <label className="ai-row">
        <span>{t('ai.protocol')}</span>
        <select
          value={settings.protocol}
          onChange={(e) => onSettings({ ...settings, protocol: e.target.value as AISettings['protocol'] })}
        >
          <option value="openai">{t('ai.protocolOpenai')}</option>
          <option value="anthropic">{t('ai.protocolAnthropic')}</option>
        </select>
      </label>

      <div className="ai-models">
        <div className="ai-models-head">
          <span>{t('ai.models')}</span>
          <span className="ai-models-actions">
            <button className="btn small" disabled={!settings.baseUrl || discovery?.state === 'busy'} onClick={() => void discover()}>
              {discovery?.state === 'busy' ? t('ai.discovering') : t('ai.discover')}
            </button>
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
          </span>
        </div>

        {discovery?.state === 'fail' && <div className="ai-discover-fail">{t('ai.discoverFail')}</div>}
        {discovery?.state === 'list' && (
          <div className="ai-discover">
            <input
              className="ai-discover-search"
              placeholder={t('ai.discoverSearch')}
              value={discovery.query}
              onChange={(e) =>
                setDiscovery({ ...discovery, query: e.target.value })
              }
            />
            <div className="ai-discover-list">
              {discovery.ids
                .filter((id) => id.toLowerCase().includes(discovery.query.toLowerCase()))
                .map((id) => (
                  <label key={id} className="ai-discover-item">
                    <input
                      type="checkbox"
                      checked={discovery.picked.has(id)}
                      onChange={(e) => {
                        const next = new Set(discovery.picked);
                        if (e.target.checked) next.add(id);
                        else next.delete(id);
                        setDiscovery({ ...discovery, picked: next });
                      }}
                    />
                    {id}
                  </label>
                ))}
            </div>
            <div className="ai-row btns">
              <button className="btn small" onClick={addPicked}>
                {t('ai.addSelected')} ({discovery.picked.size})
              </button>
              <button className="btn small" onClick={() => setDiscovery(null)}>
                {t('ai.cancel')}
              </button>
            </div>
          </div>
        )}

        {(settings.models[settings.provider] ?? []).map((m, i) => {
          const list = settings.models[settings.provider] ?? [];
          const active = settings.model === m.id;
          return (
            <div className={`ai-model-row ${active ? 'active' : ''}`} key={i}>
              <div className="ai-model-line">
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
              <div className="ai-model-line sub">
                <label className="m-vision" title={t('ai.visionNote')}>
                  <input
                    type="checkbox"
                    checked={m.vision === true}
                    onChange={(e) => setModelField(i, { vision: e.target.checked || undefined })}
                  />
                  {t('ai.vision')}
                </label>
                <input
                  className="m-efforts"
                  placeholder={t('ai.efforts')}
                  title={t('ai.effortsNote')}
                  value={m.efforts?.join(',') ?? ''}
                  onChange={(e) =>
                    setModelField(i, {
                      efforts: e.target.value.trim() === '' ? undefined : e.target.value.split(',').map((s) => s.trim()).filter(Boolean),
                    })
                  }
                />
                <button
                  className={`ai-icon-btn m-think ${m.thinkingOff ? 'on' : ''}`}
                  title={t('ai.thinkingOff')}
                  onClick={() => setModelField(i, { thinkingOff: m.thinkingOff ? undefined : true })}
                >
                  T
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <label className="ai-row">
        <span>{t('ai.webFetch')}</span>
        <input
          type="checkbox"
          checked={settings.webFetch === true}
          onChange={(e) => onSettings({ ...settings, webFetch: e.target.checked || undefined })}
        />
      </label>
      <p className="prefs-note">{t('ai.webFetchNote')}</p>

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
              setDraft({ provider: next.provider, baseUrl: next.baseUrl, apiKey: '' });
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
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}
function EyeOffIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
      <path d="M1 1l22 22" />
    </svg>
  );
}
