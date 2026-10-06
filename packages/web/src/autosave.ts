/**
 * Launch-to-launch continuity: the working session is silently
 * persisted (localStorage, best-effort) and restored on the next
 * launch, so reopening the app lands where the user left it — robots,
 * field, delays, and (via its own pref) the 2D/3D choice. Without this,
 * a user who quit in 3D reopened to the welcome page and read it as
 * "3D is not remembered" (user report 2026-10-02).
 *
 * Failure model: quota overflows, corrupt blobs, old formats — every
 * path just falls back to the welcome screen; nothing here may throw.
 */

import {
  deserializeSession,
  serializeSession,
  type FieldPackage,
  type SessionTrajectory,
} from '@pathblender/core';
import { isExampleRobot } from './example-robot';

const KEY = 'pb.autosave.v1';

/**
 * Workspace state that rides along with the session but is not part of the
 * shareable .pb schema (user request 2026-10-04: "reopen exactly where I
 * left"). Stored as an extra `ui` key next to the serialized session — old
 * autosaves and .pb files without it restore with defaults, and the core
 * deserializer ignores unknown keys, so the format stays compatible both
 * ways.
 */
export interface SessionUiState {
  selectedId?: string | null;
  t?: number;
  playbackRange?: 'full' | 'paths';
}

export interface AutosavedSession {
  fieldId: string;
  field?: FieldPackage;
  robots: SessionTrajectory[];
  ui?: SessionUiState;
}

/** Read the optional `ui` key from a serialized session blob, sanitized. */
export function readSessionUi(text: string): SessionUiState | undefined {
  try {
    const ui = (JSON.parse(text) as { ui?: unknown }).ui;
    if (!ui || typeof ui !== 'object') return undefined;
    const raw = ui as Record<string, unknown>;
    const out: SessionUiState = {};
    if (typeof raw.selectedId === 'string') out.selectedId = raw.selectedId;
    if (typeof raw.t === 'number' && Number.isFinite(raw.t) && raw.t >= 0) out.t = raw.t;
    if (raw.playbackRange === 'full' || raw.playbackRange === 'paths') out.playbackRange = raw.playbackRange;
    return Object.keys(out).length > 0 ? out : undefined;
  } catch {
    return undefined;
  }
}

/** The slot's own serialization: compact text, and no route library for
 * robots whose library the restore path regenerates anyway. The shareable .pb
 * file keeps its pretty print and its full libraries — only this slot shrinks. */
function autosaveText(
  sts: readonly SessionTrajectory[],
  fieldId: string,
  customField: FieldPackage | undefined,
  ui: SessionUiState | undefined,
  stripAllLibraries: boolean,
): string {
  const text = serializeSession(sts, fieldId, customField, {
    pretty: false,
    omitRouteOptions: stripAllLibraries ? () => true : isExampleRobot,
  });
  if (!ui) return text;
  const file = JSON.parse(text) as Record<string, unknown>;
  file.ui = ui;
  return JSON.stringify(file);
}

/**
 * Persist the current session; an empty session clears the slot.
 *
 * Two shapes, biggest first. A refused write used to be swallowed here, and
 * that silence is what broke launch-to-launch continuity: the welcome demo's
 * 22-route library made the payload 7.2 M characters, every browser storage
 * quota rejected it, and the user reopened to an empty welcome page (user
 * report 2026-10-06). The fallback drops user route libraries too; if even
 * that is refused, it says so rather than losing the session without a trace.
 */
export function saveAutosave(
  sts: readonly SessionTrajectory[],
  fieldId: string,
  customField?: FieldPackage,
  ui?: SessionUiState,
): void {
  if (sts.length === 0) {
    try {
      localStorage.removeItem(KEY);
    } catch {
      /* nothing to recover — the slot was already unusable */
    }
    return;
  }
  for (const stripAllLibraries of [false, true]) {
    try {
      localStorage.setItem(KEY, autosaveText(sts, fieldId, customField, ui, stripAllLibraries));
      return;
    } catch {
      /* quota: retry with the smaller shape */
    }
  }
  console.warn('[pathblender] autosave rejected — this session will not come back after quit');
}

/** Restore the last session, or null when there is nothing usable. */
export function loadAutosave(): AutosavedSession | null {
  try {
    const text = localStorage.getItem(KEY);
    if (!text) return null;
    const restored = deserializeSession(text);
    if (restored.robots.length === 0) return null;
    return { ...restored, ui: readSessionUi(text) };
  } catch {
    return null;
  }
}
