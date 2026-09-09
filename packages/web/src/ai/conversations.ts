/**
 * Durable AI conversations (DSH-parity "durable sessions", lightweight):
 * chat turns persist to localStorage under 'ghpb.aiChats' so the panel can
 * reopen, continue, and fork past conversations.
 *
 * Red-line discipline: only message text is stored — keys never enter here
 * (structurally: this module never imports settings), and image attachments
 * are dropped to a text marker (no base64 blobs in storage).
 */

import type { ChatMessage } from './client';

export interface StoredTurn {
  user: string;
  /** UI stream for replay: assistant replies, action summaries, notices. */
  events: { who: 'assistant' | 'action' | 'notice'; text: string }[];
}

export interface StoredChat {
  id: string;
  title: string;
  createdAt: number;
  turns: StoredTurn[];
  /** Raw wire history (assistant/tool messages included) for continuation. */
  raw: ChatMessage[];
  /** One-line carry note for new conversations (last reply, truncated). */
  summary?: string;
}

const KEY = 'ghpb.aiChats';
const MAX_CHATS = 30;

export function loadChats(): StoredChat[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const v = JSON.parse(raw) as unknown;
    if (!Array.isArray(v)) return [];
    return v.filter(
      (c): c is StoredChat =>
        typeof c === 'object' && c !== null && typeof (c as StoredChat).id === 'string' && Array.isArray((c as StoredChat).turns),
    );
  } catch {
    return [];
  }
}

export function saveChats(chats: StoredChat[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(chats.slice(0, MAX_CHATS)));
  } catch {
    /* storage full/unavailable — conversations stay session-only */
  }
}

export function upsertChat(chat: StoredChat): StoredChat[] {
  const chats = loadChats();
  const idx = chats.findIndex((c) => c.id === chat.id);
  if (idx >= 0) chats[idx] = chat;
  else chats.unshift(chat);
  // Newest first, capped.
  chats.sort((a, b) => b.createdAt - a.createdAt);
  const next = chats.slice(0, MAX_CHATS);
  saveChats(next);
  return next;
}

export function deleteChat(id: string): StoredChat[] {
  const next = loadChats().filter((c) => c.id !== id);
  saveChats(next);
  return next;
}

export function newChatId(): string {
  return `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function titleOf(text: string): string {
  const t = text.trim().replace(/\s+/g, ' ');
  return t.length > 40 ? `${t.slice(0, 40)}…` : t;
}

/** Copy a chat up to (and excluding) turn `upto`, forking a what-if line. */
export function forkChat(chat: StoredChat, upto: number): StoredChat {
  const turns = chat.turns.slice(0, Math.max(0, upto));
  // Count the raw messages that belong to the kept turns: each turn starts
  // with its user message; keep everything before the first dropped one.
  const raw = (() => {
    if (upto >= chat.turns.length) return chat.raw;
    let kept = 0;
    for (let i = 0; i < upto; i++) kept += 1 + chat.turns[i]!.events.length;
    return chat.raw.slice(0, kept);
  })();
  return {
    id: newChatId(),
    title: `${chat.title} ⎇`,
    createdAt: Date.now(),
    turns: turns.map((t) => ({ user: t.user, events: [...t.events] })),
    raw: [...raw],
  };
}
