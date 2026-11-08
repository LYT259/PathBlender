import type { AutosaveStatus } from './autosave';

/**
 * The exact error string the Rust install command rejects with when the
 * session is dirty (pinned byte-for-byte on the Rust side). Rewording either
 * copy breaks the match — the blocked-toast test in Task 6 depends on it.
 */
export const UPDATE_BLOCKED_MARKER = 'update blocked: unsaved session';

export interface GuardState {
  pendingEdits: boolean;
  lastOutcome: AutosaveStatus | null;
}

export const initialGuardState: GuardState = { pendingEdits: false, lastOutcome: null };

/** A scene edit that autosave has not persisted yet. */
export function guardAfterEdit(state: GuardState): GuardState {
  return { ...state, pendingEdits: true };
}

/** An autosave completed: whatever was pending is now written (or the write failed). */
export function guardAfterAutosave(state: GuardState, outcome: AutosaveStatus): GuardState {
  return { pendingEdits: false, lastOutcome: outcome };
}

/** Dirty = an unpersisted edit, or an autosave that failed in both shapes. */
export function isSessionDirty(state: GuardState): boolean {
  return state.pendingEdits || state.lastOutcome === 'failed';
}

export interface SessionGuard {
  edit(): void;
  autosaveDone(outcome: AutosaveStatus): void;
  sync(): void;
}

/**
 * Holds the guard state and reports `isSessionDirty` through `send` only when
 * it differs from the last delivered value — so playback's debounce-only
 * saves (no `edit()`) never produce traffic. `lastDelivered` is set
 * optimistically before awaiting; if `send` rejects it resets to `null`, so
 * the next `sync()` re-sends instead of letting Rust keep a stale flag.
 */
export function createSessionGuard(send: (dirty: boolean) => Promise<void>): SessionGuard {
  let state = initialGuardState;
  let lastDelivered: boolean | null = null;
  const sync = (): void => {
    const dirty = isSessionDirty(state);
    if (dirty === lastDelivered) return;
    lastDelivered = dirty;
    send(dirty).catch(() => {
      lastDelivered = null;
    });
  };
  return {
    edit() {
      state = guardAfterEdit(state);
      sync();
    },
    autosaveDone(outcome: AutosaveStatus) {
      state = guardAfterAutosave(state, outcome);
      sync();
    },
    sync,
  };
}
