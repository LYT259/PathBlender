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
  const [showSettings, setShowSettings] = useState(!settings.enabled);
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
    setShowSettings(false);
    push({ who: 'notice', text: t('ai.connected') });
  };

  const doDisconnect = () => {
    const next = disconnectAI(settings);
    onSettings(next);
    setDraft({ provider: next.provider, baseUrl: '', model: '', apiKey: '' });
    setShowSettings(true);
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
      {showSettings ? (
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
                className="btn small"
                title={t('ai.showKey')}
                onClick={() => setShowKey((v) => !v)}
              >
                {showKey ? '🙈' : '👁'}
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
          </div>
        </div>
      ) : (
        <>
          <div className="ai-log" ref={logRef}>
            {log.length === 0 && <div className="ai-empty">{t('ai.empty')}</div>}
            {log.map((l, i) => (
              <div key={i} className={`ai-line ai-${l.who}`}>
                {l.who === 'user' ? '🧑 ' : l.who === 'assistant' ? '🤖 ' : l.who === 'action' ? '⚙ ' : '· '}
                {l.text}
              </div>
            ))}
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

          <div className="ai-switch">
            <select
              value={settings.provider}
              title={t('ai.provider')}
              onChange={(e) => {
                const id = e.target.value;
                const preset = providerPreset(id);
                const key = settings.keys[id] ?? '';
                if (!key && id !== 'ollama') {
                  setShowSettings(true);
                  return;
                }
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

          <div className="ai-row btns">
            {undoLabel && (
              <button className="btn small" onClick={onUndo}>
                ↩ {t('ai.undo')} · {undoLabel}
              </button>
            )}
            <button className="btn small" onClick={() => setShowSettings(true)}>
              {t('ai.editSettings')}
            </button>
            <button className="btn small danger" onClick={doDisconnect}>
              {t('ai.disconnect')}
            </button>
          </div>
        </>
      )}
    </aside>
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
