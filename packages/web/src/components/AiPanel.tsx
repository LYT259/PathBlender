/**
 * AI side panel (round 9 redesign + DSH parity): a chat-first surface with
 * durable conversations (reopen / continue / fork / carry a summary into a
 * new chat), image attachments for vision models, per-model effort levels,
 * and session-local reminders delivered as follow-up messages when idle.
 * The gear at the top-right corner opens Preferences (AI section).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { PROVIDER_PRESETS, DEFAULT_PROVIDER, providerPreset, disconnectAI, type AISettings, type ModelEntry } from '../ai/settings';
import { runAssistantInstruction } from '../ai/assistant';
import { registry, onRemindersDue, startReminderPump, setWebFetchEnabled, type Reminder } from '../ai/actions';
import type { AssistantEvent, ConfirmRequest } from '../ai/assistant';
import type { ActionContext } from '../ai/actions';
import {
  loadChats, upsertChat, deleteChat, newChatId, titleOf, forkChat,
  type StoredChat, type StoredTurn,
} from '../ai/conversations';
import type { ChatMessage } from '../ai/client';
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
  /** Index of the turn this entry belongs to (for in-place forking). */
  turn: number;
}

interface PendingImage {
  name: string;
  mimeType: string;
  base64: string;
}

export function AiPanel({ settings, onSettings, buildContext, undoLabel, onUndo, onAttachFiles, onOpenSettings }: Props) {
  const { t } = useI18n();
  // Durable conversations: log + raw history mirror the active chat.
  const [chats, setChats] = useState<StoredChat[]>(() => loadChats());
  const [activeId, setActiveId] = useState<string | null>(null);
  const [rawHistory, setRawHistory] = useState<ChatMessage[]>([]);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [menu, setMenu] = useState<'plus' | 'slash' | 'dollar' | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [images, setImages] = useState<PendingImage[]>([]);
  const [carryNote, setCarryNote] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);
  const imageRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<ConfirmRequest | null>(null);
  const pendingResolve = useRef<((ok: boolean) => void) | null>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const busyRef = useRef(false);

  useEffect(() => {
    setWebFetchEnabled(settings.webFetch === true);
  }, [settings.webFetch]);

  // Reminder pump: due reminders become follow-up turns when idle.
  const sendRef = useRef<(text: string, viaReminder?: Reminder[]) => void>(() => {});
  useEffect(() => {
    startReminderPump();
    const off = onRemindersDue((due) => {
      if (busyRef.current) return; // delivered on the next idle tick
      const combined = due.map((r) => `⏰ ${r.prompt}`).join('\n');
      sendRef.current(combined, due);
    });
    return () => {
      off();
    };
  }, []);

  const push = useCallback((entry: LogEntry) => {
    setLog((l) => [...l.slice(-120), entry]);
  }, []);


  const confirm = (ok: boolean) => {
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

  const send = async (override?: string, viaReminder?: Reminder[]) => {
    const text = (override ?? input).trim();
    if (!text || busy) return;
    const turn = log.length > 0 ? log[log.length - 1]!.turn + 1 : 0;
    setInput('');
    setMenu(null);
    setBusy(true);
    busyRef.current = true;
    push({ who: 'user', text, turn });
    if (viaReminder?.length) {
      push({ who: 'notice', text: t('ai.reminderDelivered'), turn });
    }

    const turnEvents: StoredTurn['events'] = [];
    const onEvent = (e: AssistantEvent) => {
      const who: LogEntry['who'] =
        e.kind === 'reply' ? 'assistant' : e.kind === 'action' ? 'action' : 'notice';
      push({ who, text: e.text, turn });
      turnEvents.push({ who, text: e.text });
      logRef.current?.scrollTo({ top: 1e9 });
    };
    const confirmFn =
      settings.permission === 'full'
        ? async () => true // full access: auto-approve (still whitelisted actions)
        : requestConfirmation;
    const controller = new AbortController();
    abortRef.current = controller;

    // Vision gate: images require a model that declares them.
    if (images.length > 0 && !activeModels.find((m) => m.id === settings.model)?.vision) {
      push({ who: 'notice', text: t('ai.visionRefused'), turn });
      setImages([]);
      setBusy(false);
      busyRef.current = false;
      return;
    }
    const attached = images.map(({ mimeType, base64 }) => ({ mimeType, base64 }));
    setImages([]);

    try {
      const finalMessages = await runAssistantInstruction(
        text,
        settings,
        buildContext(),
        onEvent,
        confirmFn,
        {
          signal: controller.signal,
          history: rawHistory,
          carryNote: carryNote ?? undefined,
          images: attached.length ? attached : undefined,
        },
      );
      // Persist the turn (drop image payloads — storage discipline).
      const raw = finalMessages
        .slice(1)
        .map((m) => ({ ...m, images: undefined }))
        .filter((m) => m.role !== 'system');
      const lastReply = [...turnEvents].reverse().find((e) => e.who === 'assistant');
      const id = activeId ?? newChatId();
      const existing = loadChats().find((c) => c.id === id);
      const chat: StoredChat = existing
        ? {
            ...existing,
            turns: [...existing.turns, { user: text, events: turnEvents }],
            raw,
            summary: lastReply?.text.slice(0, 160),
          }
        : {
            id,
            title: titleOf(text),
            createdAt: Date.now(),
            turns: [{ user: text, events: turnEvents }],
            raw,
            summary: lastReply?.text.slice(0, 160),
          };
      setChats(upsertChat(chat));
      setActiveId(id);
      setRawHistory(raw);
      setCarryNote(null);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      push({ who: 'notice', text: controller.signal.aborted ? t('ai.stopped') : msg, turn });
    } finally {
      abortRef.current = null;
      setBusy(false);
      busyRef.current = false;
    }
  };
  sendRef.current = (text, due) => void send(text, due);

  const openChat = (chat: StoredChat) => {
    stop();
    setActiveId(chat.id);
    setRawHistory(chat.raw);
    setCarryNote(null);
    setLog(
      chat.turns.flatMap((turn, i) => [
        { who: 'user' as const, text: turn.user, turn: i },
        ...turn.events.map((e) => ({ who: e.who, text: e.text, turn: i })),
      ]),
    );
    setShowHistory(false);
  };

  const newConversation = () => {
    stop();
    setActiveId(null);
    setRawHistory([]);
    setLog([]);
    setCarryNote(null);
    setShowHistory(false);
  };

  const forkAt = (turn: number) => {
    const current = loadChats().find((c) => c.id === activeId);
    if (!current) return;
    const forked = forkChat(current, turn + 1);
    setChats(upsertChat(forked));
    openChat(forked);
  };

  // Rough context gauge: chars of the running conversation vs the active
  // model's declared window (fallback 32k).
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
  const effortOptions: string[] = activeEntry?.efforts?.length
    ? ['auto', ...activeEntry.efforts]
    : ['auto', 'low', 'medium', 'high'];
  const effortValue = activeEntry?.efforts?.length
    ? settings.effortCustom ?? 'auto'
    : settings.effort;

  const pickModel = (id: string) => {
    onSettings({ ...settings, model: id, effortCustom: undefined });
  };

  return (
    <aside className="ai-panel">
      <div className="ai-top">
        <span className="ai-top-sparkle" aria-hidden="true">
          <SparkleIcon />
        </span>
        <span className="ai-top-title">{t('ai.title')}</span>
        <button
          className="ai-icon-btn"
          title={t('ai.history')}
          aria-label={t('ai.history')}
          onClick={() => setShowHistory((v) => !v)}
        >
          <ClockIcon />
        </button>
        <button
          className="ai-icon-btn"
          title={t('ai.newChat')}
          aria-label={t('ai.newChat')}
          onClick={newConversation}
        >
          <NewChatIcon />
        </button>
        <button
          className="ai-icon-btn"
          title={t('ai.settings')}
          aria-label={t('ai.settings')}
          onClick={onOpenSettings}
        >
          <GearIcon />
        </button>
      </div>

      {showHistory && (
        <div className="ai-history" data-testid="ai-history">
          {chats.length === 0 && <div className="ai-history-empty">{t('ai.historyEmpty')}</div>}
          {chats.map((c) => (
            <div key={c.id} className={`ai-history-item ${c.id === activeId ? 'active' : ''}`}>
              <button className="ai-history-open" onClick={() => openChat(c)}>
                <span className="ai-history-title">{c.title}</span>
                <span className="ai-history-meta">
                  {new Date(c.createdAt).toLocaleString()}
                  {c.summary ? ` · ${c.summary.slice(0, 60)}` : ''}
                </span>
              </button>
              <button
                className="ai-icon-btn"
                title={t('ai.carry')}
                onClick={() => {
                  setCarryNote(
                    `Conversation "${c.title}" (${new Date(c.createdAt).toLocaleDateString()}) — ${c.summary ?? c.title}`,
                  );
                  newConversation();
                }}
              >
                ⇪
              </button>
              <button
                className="ai-icon-btn"
                title={t('ai.deleteChat')}
                onClick={() => {
                  setChats(deleteChat(c.id));
                  if (c.id === activeId) newConversation();
                }}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="ai-log" ref={logRef}>
        {log.length === 0 ? (
          <div className="ai-hero">
            <SparkleIcon big />
            <div className="ai-hero-title">{t('ai.newChat')}</div>
            {carryNote && <div className="ai-carry-note">{t('ai.carryOn')} · {carryNote.slice(0, 80)}…</div>}
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
              {l.who === 'user' && !busy && (
                <button
                  className="ai-fork"
                  title={t('ai.fork')}
                  onClick={() => forkAt(l.turn)}
                >
                  ⎇
                </button>
              )}
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
            <button onClick={() => imageRef.current?.click()}>{t('ai.attachImage')}</button>
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
        {images.length > 0 && (
          <div className="ai-image-chips">
            {images.map((img, i) => (
              <span key={i} className="ai-image-chip">
                🖼 {img.name}
                <button onClick={() => setImages((l) => l.filter((_, j) => j !== i))}>✕</button>
              </span>
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
            onChange={(e) => pickModel(e.target.value)}
          >
            {modelOptions().map((m) => (
              <option key={m} value={m}>{modelLabel(m)}</option>
            ))}
          </select>
          <select
            className="ai-effort"
            value={effortValue}
            title={t('ai.effort')}
            aria-label={t('ai.effort')}
            onChange={(e) => {
              const v = e.target.value;
              if (activeEntry?.efforts?.length)
                onSettings({ ...settings, effortCustom: v === 'auto' ? undefined : v });
              else onSettings({ ...settings, effort: v as AISettings['effort'] });
            }}
          >
            {effortOptions.map((lvl) => (
              <option key={lvl} value={lvl}>
                {lvl === 'auto' ? t('ai.effort.auto') : lvl}
              </option>
            ))}
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
        <input
          ref={imageRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          multiple
          hidden
          onChange={async (e) => {
            const files = [...(e.target.files ?? [])];
            e.target.value = '';
            setMenu(null);
            const read = await Promise.all(
              files.slice(0, 4).map(
                (f) =>
                  new Promise<PendingImage | null>((res) => {
                    const r = new FileReader();
                    r.onload = () => {
                      const data = String(r.result ?? '');
                      const b64 = data.slice(data.indexOf(',') + 1);
                      res({ name: f.name, mimeType: f.type || 'image/png', base64: b64 });
                    };
                    r.onerror = () => res(null);
                    r.readAsDataURL(f);
                  }),
              ),
            );
            setImages((l) => [...l, ...read.filter((x): x is PendingImage => x != null)].slice(0, 4));
          }}
        />
      </div>
    </aside>
  );
}

/** Whitelisted capabilities for the "/" menu (from the core registry). */
const COMMANDS = registry.llmTools().map((tl) => ({
  name: tl.function.name,
  description: tl.function.description,
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

/** Clock glyph for the conversation-history toggle. */
function ClockIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 3" />
    </svg>
  );
}
function NewChatIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
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
