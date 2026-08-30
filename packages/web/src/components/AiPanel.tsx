/**
 * AI side panel (round 9 redesign): a chat-first surface — opening shows
 * the new-conversation hero; the gear at the top-right corner opens the
 * provider settings view. No text labels on the toolbar toggle anymore
 * (sparkle icon there), matching the ChatGPT-style interaction model.
 */

import { useCallback, useRef, useState } from 'react';
import { PROVIDER_PRESETS, DEFAULT_PROVIDER, providerPreset, disconnectAI, type AISettings } from '../ai/settings';
import { runAssistantInstruction } from '../ai/assistant';
import type { AssistantEvent, ConfirmRequest } from '../ai/assistant';
import type { ActionContext } from '../ai/actions';
import { useI18n } from '../i18n';

interface Props {
  settings: AISettings;
  onSettings: (s: AISettings) => void;
  buildContext: () => ActionContext;
  undoLabel: string | null;
  onUndo: () => void;
}

interface LogEntry {
  who: 'user' | 'assistant' | 'action' | 'notice';
  text: string;
}

export function AiPanel({ settings, onSettings, buildContext, undoLabel, onUndo }: Props) {
  const { t } = useI18n();
  const [view, setView] = useState<'chat' | 'settings'>('chat');
  const [showKey, setShowKey] = useState(false);
  const [draft, setDraft] = useState(() => ({
    provider: matchProvider(settings.baseUrl, settings.model),
    baseUrl: settings.baseUrl,
    model: settings.model,
    apiKey: settings.apiKey,
  }));
  const [log, setLog] = useState<LogEntry[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<ConfirmRequest | null>(null);
  const pendingResolve = useRef<((ok: boolean) => void) | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  const push = useCallback((entry: LogEntry) => {
    setLog((l) => [...l.slice(-80), entry]);
  }, []);

  const saveSettings = () => {
    onSettings({
      enabled: true,
      provider: draft.provider,
      baseUrl: draft.baseUrl,
      model: draft.model,
      apiKey: draft.apiKey,
      keys: { ...settings.keys, [draft.provider]: draft.apiKey },
    });
    setView('chat');
    push({ who: 'notice', text: t('ai.connected') });
  };

  const doDisconnect = () => {
    const next = disconnectAI(settings);
    onSettings(next);
    setDraft({ provider: next.provider, baseUrl: '', model: '', apiKey: '' });
    setLog([]);
  };

  const confirm = (ok: boolean) => {
    if (ok) pending?.perform();
    setPending(null);
    pendingResolve.current?.(ok);
    pendingResolve.current = null;
  };

  const requestConfirmation = (req: ConfirmRequest): Promise<boolean> => {
    setPending(req);
    return new Promise<boolean>((resolve) => {
      pendingResolve.current = resolve;
    });
  };

  const send = async () => {
    const text = input.trim();
    if (!text || busy) return;
    setInput('');
    setBusy(true);
    push({ who: 'user', text });
    const onEvent = (e: AssistantEvent) => {
      const who: LogEntry['who'] =
        e.kind === 'reply' ? 'assistant' : e.kind === 'action' ? 'action' : 'notice';
      push({ who, text: e.text });
      logRef.current?.scrollTo({ top: 1e9 });
    };
    try {
      await runAssistantInstruction(text, settings, buildContext(), onEvent, requestConfirmation);
    } catch (e) {
      push({ who: 'notice', text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  // Selecting a provider (or pasting a key with one chosen) fills the
  // endpoint/model from the preset — CCSwitch behavior.
  const provider = (key: string) => {
    const preset = providerPreset(key);
    setDraft((d) => ({ ...d, provider: key, baseUrl: preset.baseUrl, model: preset.model }));
  };
  const onKeyPaste = (key: string) => {
    setDraft((d) => {
      if (key.trim().length < 8) return { ...d, apiKey: key };
      const preset = providerPreset(d.provider);
      const baseUrl = d.baseUrl || preset.baseUrl;
      const model = d.model || preset.model;
      return { ...d, apiKey: key, baseUrl, model };
    });
  };

  return (
    <aside className="ai-panel">
      <div className="ai-top">
        <span className="ai-top-sparkle" aria-hidden="true">
          <SparkleIcon />
        </span>
        <span className="ai-top-title">{t('ai.title')}</span>
        {view === 'chat' ? (
          <button
            className="ai-icon-btn"
            title={t('ai.settings')}
            aria-label={t('ai.settings')}
            onClick={() => setView('settings')}
          >
            <GearIcon />
          </button>
        ) : (
          <button
            className="ai-icon-btn"
            title={t('ai.back')}
            aria-label={t('ai.back')}
            onClick={() => setView('chat')}
          >
            <BackIcon />
          </button>
        )}
      </div>

      {view === 'settings' ? (
        <div className="ai-settings">
          <label className="ai-row">
            <span>{t('ai.provider')}</span>
            <select value={draft.provider} onChange={(e) => provider(e.target.value)}>
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
                placeholder={t('ai.keyPlaceholder')}
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
            <input type="url" value={draft.baseUrl} onChange={(e) => setDraft((d) => ({ ...d, baseUrl: e.target.value }))} />
          </label>
          <label className="ai-row">
            <span>{t('ai.model')}</span>
            <input value={draft.model} onChange={(e) => setDraft((d) => ({ ...d, model: e.target.value }))} />
          </label>
          <div className="ai-row btns">
            <button className="btn small" disabled={!draft.baseUrl || !draft.model} onClick={saveSettings}>
              {t('ai.save')}
            </button>
            {settings.enabled && (
              <button className="btn small danger" onClick={doDisconnect}>
                {t('ai.disconnect')}
              </button>
            )}
          </div>

          {settings.enabled && (
            <div className="ai-switch">
              <select
                value={settings.provider}
                title={t('ai.provider')}
                onChange={(e) => {
                  const id = e.target.value;
                  const preset = providerPreset(id);
                  const key = settings.keys[id] ?? '';
                  if (!key && id !== 'ollama') return;
                  onSettings({
                    ...settings,
                    provider: id,
                    baseUrl: preset.baseUrl,
                    model: preset.model || settings.model,
                    apiKey: key,
                    enabled: true,
                  });
                  push({ who: 'notice', text: `${t('ai.switchedTo')} ${preset.label}` });
                }}
              >
                {PROVIDER_PRESETS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {(settings.keys[p.id] ?? '') !== '' || p.id === 'ollama' ? '● ' : '○ '}
                    {p.label}
                  </option>
                ))}
              </select>
              <input
                value={settings.model}
                placeholder={t('ai.model')}
                title={t('ai.model')}
                onChange={(e) => onSettings({ ...settings, model: e.target.value })}
              />
            </div>
          )}
        </div>
      ) : (
        <>
          <div className="ai-log" ref={logRef}>
            {log.length === 0 ? (
              <div className="ai-hero">
                <SparkleIcon big />
                <div className="ai-hero-title">{t('ai.newChat')}</div>
                <div className="ai-hero-hint">{t('ai.empty')}</div>
                {!settings.enabled && (
                  <button className="btn small" onClick={() => setView('settings')}>
                    {t('ai.configure')}
                  </button>
                )}
              </div>
            ) : (
              log.map((l, i) => (
                <div key={i} className={`ai-line ai-${l.who}`}>
                  {l.text}
                </div>
              ))
            )}
          </div>

          {pending && (
            <div className="ai-confirm">
              <span>{pending.summary}</span>
              <button className="btn small" onClick={() => confirm(true)}>
                {t('ai.approve')}
              </button>
              <button className="btn small danger" onClick={() => confirm(false)}>
                {t('ai.deny')}
              </button>
            </div>
          )}

          {undoLabel && (
            <div className="ai-row btns">
              <button className="btn small" onClick={onUndo}>
                ↩ {t('ai.undo')} · {undoLabel}
              </button>
            </div>
          )}

          <div className="ai-input">
            <input
              value={input}
              placeholder={t('ai.placeholder')}
              disabled={busy || pending != null}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void send();
              }}
            />
            <button className="btn small" disabled={!input.trim() || busy} onClick={() => void send()}>
              {t('ai.send')}
            </button>
          </div>
        </>
      )}
    </aside>
  );
}

/** Four-point sparkle — the universal "AI" glyph (drawn inline, no emoji). */
export function SparkleIcon({ big }: { big?: boolean }) {
  return (
    <svg
      className={big ? 'sparkle big' : 'sparkle'}
      width={big ? 28 : 15}
      height={big ? 28 : 15}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M12 2.5l1.9 6.1 6.1 1.9-6.1 1.9L12 18.5l-1.9-6.1L4 10.5l6.1-1.9L12 2.5z" />
      <path d="M19 14.5l.95 3.05L23 18.5l-3.05.95L19 22.5l-.95-3.05L15 18.5l3.05-.95L19 14.5z" opacity="0.75" />
    </svg>
  );
}

/** Feather-style gear (MIT, feathericons.com — shape only). */
function GearIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

function BackIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M19 12H5" />
      <path d="M12 19l-7-7 7-7" />
    </svg>
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

/** Best-effort preset match for restored settings (falls back to Custom). */
function matchProvider(baseUrl: string, model: string): string {
  const hit = PROVIDER_PRESETS.find(
    (p) => p.id !== 'custom' && p.baseUrl !== '' && baseUrl.startsWith(p.baseUrl),
  );
  if (hit) return hit.id;
  if (!baseUrl && !model) return DEFAULT_PROVIDER;
  return 'custom';
}
