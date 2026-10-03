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

const KEY = 'pb.autosave.v1';

export interface AutosavedSession {
  fieldId: string;
  field?: FieldPackage;
  robots: SessionTrajectory[];
}

/** Persist the current session; an empty session clears the slot. */
export function saveAutosave(
  sts: readonly SessionTrajectory[],
  fieldId: string,
  customField?: FieldPackage,
): void {
  try {
    if (sts.length === 0) {
      localStorage.removeItem(KEY);
      return;
    }
    localStorage.setItem(KEY, serializeSession(sts, fieldId, customField));
  } catch {
    /* quota exceeded — keep the previous autosave */
  }
}

/** Restore the last session, or null when there is nothing usable. */
export function loadAutosave(): AutosavedSession | null {
  try {
    const text = localStorage.getItem(KEY);
    if (!text) return null;
    const restored = deserializeSession(text);
    if (restored.robots.length === 0) return null;
    return restored;
  } catch {
    return null;
  }
}
