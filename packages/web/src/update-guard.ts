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
 * Holds the guard state and reports `isSessionDirty` through `send`, deduped
 * against the value Rust is known to hold — so playback's debounce-only
 * saves (no `edit()`) never produce traffic. Reports are SERIALIZED: one
 * `send` in flight at a time, each queued value dispatched only after the
 * previous one settles. Concurrent sends would let a requested [false,
 * true] ARRIVE as true-then-stale-false, leaving Rust clean for a dirty
 * session while the cache believed `true` was delivered — fail-open
 * (independent-review finding). Serialization makes arrival order equal
 * request order by construction. A rejected send resets both caches so the
 * next sync re-sends; there is deliberately no automatic retry loop.
 */
export function createSessionGuard(send: (dirty: boolean) => Promise<void>): SessionGuard {
  let state = initialGuardState;
  /** Value Rust is known to hold (last acknowledged send); null = unknown. */
  let delivered: boolean | null = null;
  /** Value the in-flight (or settled) report asked Rust to hold. */
  let desired: boolean | null = null;
  let inFlight = false;

  const sync = (): void => {
    if (inFlight) return; // the queued value dispatches when the current send settles
    const dirty = isSessionDirty(state);
    if (dirty === delivered && delivered !== null) return;
    if (dirty === desired) return;
    desired = dirty;
    inFlight = true;
    send(dirty)
      .then(() => {
        delivered = dirty;
      })
      .catch(() => {
        delivered = null;
        desired = null;
      })
      .finally(() => {
        inFlight = false;
        if (desired !== null) sync(); // dispatch a value queued mid-flight
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
