/**
 * AI side panel (round 9 redesign): a chat-first surface — opening shows
 * the new-conversation hero; the gear at the top-right corner opens the
 * provider settings view. No text labels on the toolbar toggle anymore
 * (sparkle icon there), matching the ChatGPT-style interaction model.
 */

import { useCallback, useRef, useState } from 'react';
import { PROVIDER_PRESETS, DEFAULT_PROVIDER, providerPreset, disconnectAI, type AISettings, type ModelEntry } from '../ai/settings';
import { runAssistantInstruction } from '../ai/assistant';
import { registry } from '../ai/actions';
import type { AssistantEvent, ConfirmRequest } from '../ai/assistant';
import type { ActionContext } from '../ai/actions';
import { useI18n } from '../i18n';
import type { MessageKey } from '../i18n/en';

interface Props {
  settings: AISettings;
  onSettings: (s: AISettings) => void;
  buildContext: () => ActionContext;
  undoLabel: string | null;
  onUndo: () => void;
  /** "+" attachment: route picked path files into the session import. */
  onAttachFiles: (files: FileList | File[]) => void;
  /** Gear pressed: the app opens Preferences at the AI section. */
  onOpenSettings: () => void;
}

interface LogEntry {
  who: 'user' | 'assistant' | 'action' | 'notice';
  text: string;
}

export function AiPanel({ settings, onSettings, buildContext, undoLabel, onUndo, onAttachFiles, onOpenSettings }: Props) {
  const { t } = useI18n();
  // Settings live in Preferences (single entry); the panel is chat-only.
  const [log, setLog] = useState<LogEntry[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [menu, setMenu] = useState<'plus' | 'slash' | 'dollar' | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<ConfirmRequest | null>(null);
  const pendingResolve = useRef<((ok: boolean) => void) | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  const push = useCallback((entry: LogEntry) => {
    setLog((l) => [...l.slice(-80), entry]);
  }, []);


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

  const stop = () => {
    abortRef.current?.abort();
    abortRef.current = null;
  };

  const send = async () => {
    const text = input.trim();
    if (!text || busy) return;
    setInput('');
    setMenu(null);
    setBusy(true);
    push({ who: 'user', text });
    const onEvent = (e: AssistantEvent) => {
      const who: LogEntry['who'] =
        e.kind === 'reply' ? 'assistant' : e.kind === 'action' ? 'action' : 'notice';
      push({ who, text: e.text });
      logRef.current?.scrollTo({ top: 1e9 });
    };
    const confirmFn =
      settings.permission === 'full'
        ? async () => true // full access: auto-approve (still whitelisted actions)
        : requestConfirmation;
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      await runAssistantInstruction(text, settings, buildContext(), onEvent, confirmFn, {
        signal: controller.signal,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      push({ who: 'notice', text: controller.signal.aborted ? t('ai.stopped') : msg });
    } finally {
      abortRef.current = null;
      setBusy(false);
    }
  };


  // Rough context gauge: chars of the running conversation vs a nominal
  // 32k window (estimate — providers differ; tooltip says so).
  const ctxPct = () => {
    const chars =
      log.reduce((n, l) => n + l.text.length, 0) + input.length + 2600 /*system prompt*/;
    return Math.min(99, Math.round((chars / 3 / ctxWindow) * 100));
  };
  const activeModels = settings.models[settings.provider] ?? [];
  const activeEntry = activeModels.find((m) => m.id === settings.model);
  const modelOptions = () => {
    const ids = activeModels.map((m) => m.id).filter(Boolean);
    if (settings.model && !ids.includes(settings.model)) ids.unshift(settings.model);
    return ids;
  };
  const modelLabel = (id: string) => {
    const m = activeModels.find((x) => x.id === id);
    return m?.name ? `${m.name} (${id})` : id;
  };
  const ctxWindow = activeEntry?.ctxK ? activeEntry.ctxK * 1000 : 32000;

  return (
    <aside className="ai-panel">
      <div className="ai-top">
        <span className="ai-top-sparkle" aria-hidden="true">
          <SparkleIcon />
        </span>
        <span className="ai-top-title">{t('ai.title')}</span>
        <button
          className="ai-icon-btn"
          title={t('ai.settings')}
          aria-label={t('ai.settings')}
          onClick={onOpenSettings}
        >
          <GearIcon />
        </button>
      </div>


        <>
      <div className="ai-log" ref={logRef}>
            {log.length === 0 ? (
              <div className="ai-hero">
                <SparkleIcon big />
                <div className="ai-hero-title">{t('ai.newChat')}</div>
                {!settings.enabled && (
                  <button className="btn small" onClick={onOpenSettings}>
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

          <div className={`ai-composer ${menu ? 'menu-open' : ''}`}>
            {menu === 'plus' && (
              <div className="ai-menu">
                <button onClick={() => fileRef.current?.click()}>{t('ai.attachFile')}</button>
                <button onClick={() => folderRef.current?.click()}>{t('ai.attachFolder')}</button>
              </div>
            )}
            {menu === 'slash' && (
              <div className="ai-menu tall">
                {COMMANDS.filter((c) =>
                  c.name.toLowerCase().includes(input.replace(/^\//, '').toLowerCase()),
                ).map((c) => (
                  <button key={c.name} onClick={() => { setInput(`/${c.name} `); setMenu(null); }}>
                    <span className="ai-cmd-name">/{c.name}</span>
                    <span className="ai-cmd-desc">{c.description}</span>
                  </button>
                ))}
              </div>
            )}
            {menu === 'dollar' && (
              <div className="ai-menu">
                {SKILLS.map((sk) => (
                  <button key={sk.id} onClick={() => { setInput(sk.prompt); setMenu(null); }}>
                    <span className="ai-cmd-name">${t(sk.label)}</span>
                  </button>
                ))}
              </div>
            )}
            <textarea
              value={input}
              placeholder={t('ai.placeholder')}
              rows={2}
              disabled={busy || pending != null}
              onChange={(e) => {
                setInput(e.target.value);
                const v = e.target.value;
                if (v.startsWith('/')) setMenu('slash');
                else if (v.startsWith('$')) setMenu('dollar');
                else if (menu) setMenu(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
                if (e.key === 'Escape') setMenu(null);
              }}
            />
            <div className="ai-composer-row">
              <button
                className="ai-icon-btn"
                title={t('ai.attach')}
                aria-label={t('ai.attach')}
                onClick={() => setMenu(menu === 'plus' ? null : 'plus')}
              >
                <PlusIcon />
              </button>
              <select
                className="ai-perm"
                value={settings.permission}
                title={t('ai.permission')}
                aria-label={t('ai.permission')}
                onChange={(e) => onSettings({ ...settings, permission: e.target.value as AISettings['permission'] })}
              >
                <option value="standard">{t('ai.perm.standard')}</option>
                <option value="full">{t('ai.perm.full')}</option>
              </select>
              <span className="ai-ctx" title={t('ai.ctxNote')}>
                {ctxPct()}%
              </span>
              <select
                className="ai-model"
                value={settings.model}
                title={t('ai.model')}
                aria-label={t('ai.model')}
                onChange={(e) => onSettings({ ...settings, model: e.target.value })}
              >
                {modelOptions().map((m) => (
                  <option key={m} value={m}>{modelLabel(m)}</option>
                ))}
              </select>
              <select
                className="ai-effort"
                value={settings.effort}
                title={t('ai.effort')}
                aria-label={t('ai.effort')}
                onChange={(e) => onSettings({ ...settings, effort: e.target.value as AISettings['effort'] })}
              >
                <option value="auto">{t('ai.effort.auto')}</option>
                <option value="low">{t('ai.effort.low')}</option>
                <option value="medium">{t('ai.effort.medium')}</option>
                <option value="high">{t('ai.effort.high')}</option>
              </select>
              {busy ? (
                <button className="ai-icon-btn stop" title={t('ai.stop')} aria-label={t('ai.stop')} onClick={stop}>
                  <StopIcon />
                </button>
              ) : (
                <button
                  className="ai-send"
                  disabled={!input.trim() || pending != null}
                  aria-label={t('ai.send')}
                  title={t('ai.send')}
                  onClick={() => void send()}
                >
                  <SendIcon />
                </button>
              )}
            </div>
            <input
              ref={fileRef}
              type="file"
              multiple
              hidden
              onChange={(e) => {
                if (e.target.files?.length) onAttachFiles(e.target.files);
                e.target.value = '';
                setMenu(null);
              }}
            />
            <input
              ref={folderRef}
              type="file"
              hidden
              // @ts-expect-error non-standard but universally supported
              webkitdirectory=""
              onChange={(e) => {
                if (e.target.files?.length) onAttachFiles(e.target.files);
                e.target.value = '';
                setMenu(null);
              }}
            />
          </div>
        </>
    </aside>
  );
}

/** Whitelisted capabilities for the "/" menu (from the core registry). */
const COMMANDS = registry.llmTools().map((t) => ({
  name: t.function.name,
  description: t.function.description,
}));

/** Built-in "$" skills: one-shot instructions over the same whitelist. */
const SKILLS: { id: string; label: MessageKey; prompt: string }[] = [
  { id: 'resolve', label: 'ai.skill.resolve', prompt: '调用 auto_resolve_conflicts 消解所有碰撞，然后逐台报告新增的起步延迟。' },
  { id: 'bounds', label: 'ai.skill.bounds', prompt: '查询并汇报所有机器人的越界(out-of-bounds)时段与位置。' },
  { id: 'export', label: 'ai.skill.export', prompt: '把每一台机器人导出为 .ghostauto 文件。' },
];

function PlusIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </svg>
  );
}
function SendIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M22 2L11 13" />
      <path d="M22 2l-7 20-4-9-9-4 20-7z" />
    </svg>
  );
}
function StopIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <rect x="5" y="5" width="14" height="14" rx="2" />
    </svg>
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
