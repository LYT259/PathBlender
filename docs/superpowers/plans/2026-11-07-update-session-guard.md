# Update Session Guard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Block desktop update installs while the working session has changes not captured by a successful autosave, with the gate enforced in the Rust shell's `install_update` — before anything the Windows installer can take over — while clean sessions behave exactly as today.

**Architecture:** The main window owns the session, so it owns the dirty computation: a pure state machine fed by `saveAutosave`'s new return value reports `dirty` to a Rust-managed `AtomicBool` via a new `set_update_guard` command. `install_update` checks that flag **before** it takes `PendingUpdate` (a blocked attempt leaves the stashed update in place, so a retry needs no re-check). All three install entry points — the preferences "Install and relaunch" button, the channel-switch one-hop check in the main window, and any future caller — flow through the same Rust command, so the gate is an execution-layer gate, not a hidden button (red book §7.1 update safety gate; the §16(v1.56) lesson that a missing menu item is not a missing capability). Dirty means only: a scene edit not yet persisted by autosave, or an autosave write that failed in both shapes. A non-empty session with a healthy autosave and a playing session are NOT dirty — the playhead `t` is debounce-only (600 ms) and is accepted-stale by design, so the debounce path never marks dirty.

**Tech Stack:** TypeScript/React (npm workspaces, `@pathblender/web`, vitest + jsdom + @testing-library), Rust/Tauri v2 (`pathblender-desktop`, tauri-plugin-updater), i18n dictionaries (45 `.ts` files: `en.ts` + 44 translations).

**Spec:** `PathBlender_红皮书.md` §7.1（分发与安装体验——更新安全门：「编辑会话进行中禁止重启」，v1.9 入册；v1.56 执行层设闸纪律）. The red book is private to the main tree, so the work-package requirements are reproduced here verbatim:

- 覆盖渠道切换、偏好安装按钮、Rust `install_update` 在 Windows 安装器接管前的执行层门。
- 脏仅指草稿未入自动保存或 autosave 写入失败，非空会话/播放不误判。
- Rust managed `AtomicBool` fail-closed，先查 guard 再 take `PendingUpdate`。
- JS 上报与 blocked 提示，干净行为不变。
- 计划包含纯函数、autosave 返回值、Web/Rust 接口、i18n、jsdom 与 Rust 测试、release 构建。
- 红皮书刚清理了旧界面功能，不要重新介绍它们（不要在代码、注释或文案中复活已删除的功能）。

## Global Constraints

- Workspace: this worktree of the repository, branch `feat/update-session-guard`, based on `origin/beta@7fed5404`. Never commit on `beta`; do not push (the coordinating session owns PR/merge).
- Pure-frontend red line: no backend, no telemetry. The guard is desktop-shell state only; the web/browser build must stay inert (`IS_DESKTOP` guard; the `@tauri-apps/api/core` dynamic-import pattern used at `App.tsx:208`).
- Every user-visible string goes through the i18n dictionaries. A new key must land in **all 45** dictionary files (`packages/web/src/i18n/*.ts`): `Record<MessageKey, string>` makes absence a compile error, and `packages/web/test/i18n.test.ts` enforces key parity and non-blank values.
- After every task: repo-wide `npm run typecheck` clean and the touched test suites green. Each task is its own commit with an English conventional-commit message.
- Rust changes ship in the binary: besides `cargo test`, a full `cargo build --release` must pass before the branch is done (AGENTS.md binary-layer discipline).
- Tests assert behavior, not implementation. Never fabricate sample files, real-machine results, or real feed interactions — the external-verification limits below are stated facts, not gaps to paper over.
- Do not modify `PathBlender_红皮书.md`, `AGENTS.md`, or the engineering log from this branch; version bump + 40-language release notes + three-platform verification happen in the standard beta merge flow, not in these tasks.

## Review Focus

1. **A blocked install must not consume `PendingUpdate`** — a reasonable user retries by clicking again after saving, without re-checking the feed. Pinned by Task 5 (`gate_then_take` order test: dirty + pending present → `Err` and the pending is still there).
2. **A playing or non-empty session must not be misjudged dirty** — the playhead debounce (600 ms) resets every frame during playback, so wiring the debounce as "pending edit" would block updates for an entire playback. Pinned by Task 6 (playback + debounce-window tests assert no `{ dirty: true }` report ever fires).
3. **Autosave failure must be sticky and recoverable** — a quota-refused write is dirty until some later save succeeds; a clean report after a failed save would silently re-arm data loss. Pinned by Task 1 (`'failed'` only when both shapes refused) and Task 2/6 (sticky-then-recovered transitions).
4. **Sentinel drift between Rust and JS** — the JS classifier matches a substring of the Rust error string; if either side rewords it, blocked installs decay into generic failures. Pinned by exact-string tests in Task 4 (JS) and Task 5 (Rust).
5. **A lost guard report must not wedge the flag** — if `set_update_guard` rejects, the dedupe cache must reset so the next state change re-reports; otherwise one dropped IPC call leaves Rust believing a stale value forever. Pinned by Task 2 (send-rejection resets `lastDelivered`).

## External verification limits (state these; do not fake them)

- The real Windows NSIS takeover (installer exits the app mid-`install_update`) cannot be exercised from this machine; the gate's position before `download_and_install` is pinned by contract tests only. Real Windows behavior is verified by the repo's Windows smoke workflow at merge time.
- No test here downloads a real update, contacts a real feed, or performs a real relaunch — `invoke` is mocked (web) and the updater plugin is not driven (Rust unit tests only).
- Real storage-quota failures are simulated with stubs; no fabricated "real device" results.
- The 42 non-en/zh translations are AI-drafted like the rest of the dictionaries; they follow the repo's existing language-review process.

---

### Task 1: `saveAutosave` returns a status

**Files:**
- Modify: `packages/web/src/autosave.ts:90-113` (`saveAutosave`)
- Test: `packages/web/test/autosave.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `export type AutosaveStatus = 'saved' | 'cleared' | 'failed';` in `autosave.ts`, and `saveAutosave(...): AutosaveStatus` — `'saved'` when either shape wrote, `'cleared'` when the session is empty (the slot is removed or was already unusable), `'failed'` when both writes were refused. Existing callers may ignore the return (no behavior change).

- [ ] **Step 1: Write the failing tests** (append to the existing `describe` in `autosave.test.ts`)

```ts
it('reports saved when the full shape fits', () => {
  expect(saveAutosave(robots(), 'rebuilt-2026')).toBe('saved');
});

it('reports saved when only the library-stripped shape fits', () => {
  // Reuse the withLibrary + refusals=1 spy setup from the existing quota test:
  // first setItem throws, the stripped retry writes.
  expect(saveAutosave(withLibrary(), 'rebuilt-2026')).toBe('saved');
});

it('reports failed when both shapes are refused', () => {
  // refusals = ∞ spy: every setItem throws.
  expect(saveAutosave(robots(), 'rebuilt-2026')).toBe('failed');
});

it('reports cleared when the session empties — even if removeItem throws', () => {
  const owner = Object.hasOwn(localStorage, 'removeItem') ? localStorage : Storage.prototype;
  const rm = vi.spyOn(owner, 'removeItem').mockImplementation(() => { throw new DOMException('quota', 'QuotaExceededError'); });
  try {
    expect(saveAutosave([], 'rebuilt-2026')).toBe('cleared');
  } finally { rm.mockRestore(); }
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd packages/web && npx vitest run test/autosave.test.ts`
Expected: FAIL — `saveAutosave` returns `undefined`, so each `toBe(...)` fails (TypeScript may also flag the comparison on `void`).

- [ ] **Step 3: Implement in `autosave.ts`**

Add `export type AutosaveStatus = 'saved' | 'cleared' | 'failed';` and change the signature to return it: empty-session path returns `'cleared'` (both inside and after the catch), the loop returns `'saved'` after a successful `setItem`, and after the second refusal return `'failed'` (keep the existing `console.warn` line — the warn and the return are the same event).

- [ ] **Step 4: Run to verify they pass**

Run: `cd packages/web && npx vitest run test/autosave.test.ts`
Expected: PASS (whole file, including the existing tests — they ignore the return).

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/autosave.ts packages/web/test/autosave.test.ts
git commit -m "feat: autosave writes report saved/cleared/failed status"
```

---

### Task 2: Pure session-guard state machine and Rust-error sentinel

**Files:**
- Create: `packages/web/src/update-guard.ts`
- Test: `packages/web/test/update-guard.test.ts`

**Interfaces:**
- Consumes: `AutosaveStatus` from `./autosave` (Task 1).
- Produces (all in `update-guard.ts`, later used by Tasks 4 and 6):
  - `export const UPDATE_BLOCKED_MARKER = 'update blocked: unsaved session';` — must equal the Rust error string byte-for-byte (pinned in Task 5).
  - `export interface GuardState { pendingEdits: boolean; lastOutcome: AutosaveStatus | null; }`
  - `export const initialGuardState: GuardState = { pendingEdits: false, lastOutcome: null };`
  - `export function guardAfterEdit(state: GuardState): GuardState;`
  - `export function guardAfterAutosave(state: GuardState, outcome: AutosaveStatus): GuardState;`
  - `export function isSessionDirty(state: GuardState): boolean;` — `pendingEdits || lastOutcome === 'failed'`.
  - `export interface SessionGuard { edit(): void; autosaveDone(outcome: AutosaveStatus): void; sync(): void; }`
  - `export function createSessionGuard(send: (dirty: boolean) => Promise<void>): SessionGuard;` — holds the state; `edit()`/`autosaveDone()` apply the transitions then `sync()`; `sync()` sends `isSessionDirty(state)` only when it differs from the last **delivered** value, sets `lastDelivered` optimistically before awaiting, and resets `lastDelivered = null` when that `send` rejects so the next `sync()` re-sends. Initial state has never been delivered, so the first `sync()` sends `{ dirty: false }` (a restored or empty session is clean).

- [ ] **Step 1: Write the failing tests** (`update-guard.test.ts`)

```ts
import { describe, expect, it, vi } from 'vitest';
import { createSessionGuard, guardAfterAutosave, guardAfterEdit, initialGuardState, isSessionDirty, UPDATE_BLOCKED_MARKER } from '../src/update-guard';

describe('pure transitions', () => {
  it('initial state is clean (mount-time restore or welcome page)', () => {
    expect(isSessionDirty(initialGuardState)).toBe(false);
  });
  it('an edit pending its save is dirty', () => {
    expect(isSessionDirty(guardAfterEdit(initialGuardState))).toBe(true);
  });
  it('a successful save after an edit is clean again', () => {
    expect(isSessionDirty(guardAfterAutosave(guardAfterEdit(initialGuardState), 'saved'))).toBe(false);
  });
  it('an emptied session is clean', () => {
    expect(isSessionDirty(guardAfterAutosave(guardAfterEdit(initialGuardState), 'cleared'))).toBe(false);
  });
  it('a failed autosave is dirty and stays dirty across edits', () => {
    const failed = guardAfterAutosave(guardAfterEdit(initialGuardState), 'failed');
    expect(isSessionDirty(failed)).toBe(true);
    expect(isSessionDirty(guardAfterEdit(failed))).toBe(true);
    expect(isSessionDirty(guardAfterAutosave(failed, 'cleared'))).toBe(false); // recovery clears
  });
});

describe('createSessionGuard', () => {
  it('first sync delivers the clean state', async () => {
    const send = vi.fn(() => Promise.resolve());
    createSessionGuard(send).sync();
    expect(send).toHaveBeenCalledExactlyOnceWith(false);
  });
  it('sends dirty once for edit + failed save, and clean again on recovery', async () => {
    const send = vi.fn(() => Promise.resolve());
    const g = createSessionGuard(send);
    g.edit();                 // pending → dirty → send(true)
    g.autosaveDone('failed'); // still dirty → no send
    g.sync();                 // no change → no send
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(true);
    g.autosaveDone('saved');  // dirty → clean → send(false)
    expect(send).toHaveBeenNthCalledWith(2, false);
  });
  it('a rejected send resets the cache so the next sync re-sends', async () => {
    const send = vi.fn((_d: boolean) => Promise.reject(new Error('ipc gone')));
    const g = createSessionGuard(send);
    g.edit();                 // sends true (rejected)
    g.autosaveDone('saved');  // sends false (rejected)
    g.sync();                 // must re-send — the last delivered value is unknown
    expect(send.mock.calls.map((c) => c[0])).toEqual([true, false, false]);
  });
  it('the blocked marker string is pinned for the Rust side', () => {
    expect(UPDATE_BLOCKED_MARKER).toBe('update blocked: unsaved session');
  });
});
```

(Adjust the second test to call `g.sync()` explicitly before `g.edit()` if you prefer deterministic call ordering — the assertion then reads `[false, true]`.)

- [ ] **Step 2: Run to verify they fail**

Run: `cd packages/web && npx vitest run test/update-guard.test.ts`
Expected: FAIL — module `../src/update-guard` does not exist.

- [ ] **Step 3: Implement `update-guard.ts`**

Pure functions as specified above. `createSessionGuard` keeps `state` and `lastDelivered: boolean | null` in closure; transitions are the pure functions; `sync()` compares, sends, and handles rejection as specified. No imports beyond the `AutosaveStatus` type.

- [ ] **Step 4: Run to verify they pass**

Run: `cd packages/web && npx vitest run test/update-guard.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/update-guard.ts packages/web/test/update-guard.test.ts
git commit -m "feat: pure session-guard state machine for update gating"
```

---

### Task 3: i18n key `updates.blocked` in all dictionaries

**Files:**
- Modify: `packages/web/src/i18n/en.ts:250` (insert after `'updates.failed'`), and the same position in **all 44 sibling dictionaries** (`packages/web/src/i18n/*.ts` except `en.ts`).

**Interfaces:**
- Produces: `'updates.blocked'` — used by Task 6 (main-window toast) and Task 7 (preferences status line). Exact copy:
  - en: `'updates.blocked': 'Update paused — the latest session changes are not saved yet. Try again in a moment.',`
  - zh: `'updates.blocked': '已暂停更新——会话的最新改动尚未保存，请稍后重试。',`
  - The other 43 languages: one concise sentence with the same meaning, matching each dictionary's established tone and typographic conventions (see neighboring `updates.*` entries).

- [ ] **Step 1: Add the key to `en.ts` only, then run the parity test to see it fail**

Run: `cd packages/web && npx vitest run test/i18n.test.ts`
Expected: FAIL — every non-en dictionary is missing `updates.blocked` (and `tsc` would flag the `Record<MessageKey, string>` hole; the vitest failure is the visible red).

- [ ] **Step 2: Add the translated key to all 44 sibling dictionaries**

Place it directly after each file's `updates.failed` entry. Do not reorder or reformat neighboring lines.

- [ ] **Step 3: Run to verify they pass**

Run: `cd packages/web && npx vitest run test/i18n.test.ts && cd .. && npm run typecheck -w @pathblender/web --if-present`
Expected: PASS — parity and no-blank checks green; typecheck clean.

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/i18n
git commit -m "feat: add updates.blocked message to all 45 dictionaries"
```

---

### Task 4: JS blocked classification in `update-check.ts`

**Files:**
- Modify: `packages/web/src/update-check.ts` (`UpdateEvent`, `runUpdateCheck`, `installPendingUpdate`)
- Test: `packages/web/test/update-check.test.ts`

**Interfaces:**
- Consumes: `UPDATE_BLOCKED_MARKER` from `./update-guard` (Task 2).
- Produces:
  - `UpdateEvent` gains `| { kind: 'blocked' }`.
  - `runUpdateCheck`: an `install_update` rejection whose message contains the marker emits `{ kind: 'blocked' }` and returns **without** `relaunch()` and without `'failed'`; any other rejection still falls through to `'failed'` (existing behavior).
  - `installPendingUpdate(): Promise<'installed' | 'blocked'>` — marker rejection resolves `'blocked'` (no relaunch); other rejections still reject; success relaunches best-effort and resolves `'installed'`.
  - Rust contract consumed: `Err("update blocked: unsaved session")` from `install_update`.

- [ ] **Step 1: Write the failing tests** (append to `update-check.test.ts`)

```ts
it('maps the blocked sentinel to a blocked event — no relaunch, no failed', async () => {
  invoke.mockResolvedValueOnce({ version: '0.2.0' })
       .mockRejectedValueOnce(new Error('update blocked: unsaved session'));
  expect(await events('stable')).toEqual([
    { kind: 'found', version: '0.2.0' },
    { kind: 'blocked' },
  ]);
  expect(relaunch).not.toHaveBeenCalled();
});

it('a non-sentinel install failure is still failed', async () => {
  invoke.mockResolvedValueOnce({ version: '0.2.0' }).mockRejectedValueOnce(new Error('disk'));
  expect(await events('stable')).toEqual([{ kind: 'found', version: '0.2.0' }, { kind: 'failed' }]);
});

it('installPendingUpdate resolves blocked on the sentinel (no relaunch)', async () => {
  invoke.mockRejectedValueOnce('update blocked: unsaved session'); // Tauri rejects with the raw string
  await expect(installPendingUpdate()).resolves.toBe('blocked');
  expect(relaunch).not.toHaveBeenCalled();
});

it('installPendingUpdate still rejects on other errors', async () => {
  invoke.mockRejectedValueOnce(new Error('disk'));
  await expect(installPendingUpdate()).rejects.toThrow('disk');
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd packages/web && npx vitest run test/update-check.test.ts`
Expected: FAIL — `'blocked'` is not a valid `UpdateEvent`, `installPendingUpdate` resolves `undefined`.

- [ ] **Step 3: Implement**

Add a private `function errorIsBlocked(e: unknown): boolean { return String(e).includes(UPDATE_BLOCKED_MARKER); }`. In `runUpdateCheck`, wrap only the `install_update` invocation: on rejection, `errorIsBlocked` → `onEvent({ kind: 'blocked' }); return;`, else rethrow (outer catch → `'failed'`). Same classification inside `installPendingUpdate`, returning the outcome literal. Leave the `check_update` semantics untouched.

- [ ] **Step 4: Run to verify they pass**

Run: `cd packages/web && npx vitest run test/update-check.test.ts`
Expected: PASS — including all pre-existing cases (clean flows byte-identical).

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/update-check.ts packages/web/test/update-check.test.ts
git commit -m "feat: classify blocked update installs as a distinct outcome"
```

---

### Task 5: Rust execution-layer gate in `install_update`

**Files:**
- Modify: `packages/desktop/src-tauri/src/lib.rs` (`install_update` at :74-88, `PendingUpdate` at :37, `run()` registration at :574-586, tests mod at :718-736)
- Test: same file, `#[cfg(test)] mod tests`

**Interfaces:**
- Produces (consumed by Task 6):
  - `const UPDATE_BLOCKED_ERR: &str = "update blocked: unsaved session";` — byte-identical to the JS `UPDATE_BLOCKED_MARKER`.
  - `const UPDATE_SESSION_DIRTY_DEFAULT: bool = true;` — the fail-closed initial value.
  - `struct UpdateSessionGuard(AtomicBool);` managed state, initialized with `UPDATE_SESSION_DIRTY_DEFAULT` (fail-closed: installs are blocked until the page explicitly reports a clean session).
  - `#[tauri::command] fn set_update_guard(guard: State<'_, UpdateSessionGuard>, dirty: bool) -> Result<(), String>` — stores with `Ordering::SeqCst`.
  - `fn gate_then_take<T>(dirty: bool, pending: &mut Option<T>) -> Result<T, &'static str>` — if `dirty`, `Err(UPDATE_BLOCKED_ERR)` **without touching** `pending`; else `pending.take().ok_or("no update was checked")`.
  - `install_update` gains a `guard: State<'_, UpdateSessionGuard>` parameter and becomes: load the flag, `gate_then_take`, then `download_and_install` as today. The gate check precedes the take; everything after it may be interrupted by the Windows installer, so this is the last controllable moment.

- [ ] **Step 1: Write the failing tests** (append to `mod tests`)

```rust
use super::{gate_then_take, UPDATE_BLOCKED_ERR, UPDATE_SESSION_DIRTY_DEFAULT};
use std::sync::atomic::{AtomicBool, Ordering};

/// A blocked attempt must NOT consume the pending update: the retry after
/// saving reuses the stashed update without re-checking the feed.
#[test]
fn gate_blocks_before_consuming_the_pending_update() {
    let mut pending = Some("update");
    assert_eq!(gate_then_take(true, &mut pending), Err(UPDATE_BLOCKED_ERR));
    assert_eq!(pending, Some("update"));
}

#[test]
fn gate_passes_clean_sessions_through() {
    let mut pending = Some("update");
    assert_eq!(gate_then_take(false, &mut pending), Ok("update"));
    assert_eq!(pending, None);
}

#[test]
fn clean_but_unchecked_is_still_the_no_update_error() {
    let mut pending: Option<&str> = None;
    assert_eq!(gate_then_take(false, &mut pending), Err("no update was checked"));
}

/// The JS side matches on this exact string (update-guard.ts) — rewording
/// either side silently degrades blocked installs into generic failures.
#[test]
fn blocked_error_string_is_pinned_to_the_js_marker() {
    assert_eq!(UPDATE_BLOCKED_ERR, "update blocked: unsaved session");
}

/// Fail-closed: before the webview ever reports, installs are blocked.
#[test]
fn guard_defaults_to_blocked() {
    assert!(UPDATE_SESSION_DIRTY_DEFAULT);
    assert!(AtomicBool::new(UPDATE_SESSION_DIRTY_DEFAULT).load(Ordering::SeqCst));
}
```

- [ ] **Step 2: Run to verify they fail**

Run: `cargo test --manifest-path packages/desktop/src-tauri/Cargo.toml`
Expected: FAIL — compile error (`gate_then_take`, `UPDATE_BLOCKED_ERR`, `UPDATE_SESSION_DIRTY_DEFAULT` not defined). First run builds the dependency tree; that is expected, use a generous timeout.

- [ ] **Step 3: Implement in `lib.rs`**

Add the consts, struct, command, and helper. In `install_update`, replace the bare take with `gate_then_take(guard.0.load(Ordering::SeqCst), &mut *pending.0.lock().map_err(|e| e.to_string())?)` (keep the existing `download_and_install` tail unchanged). Register in `tauri::Builder`: `.manage(UpdateSessionGuard(AtomicBool::new(UPDATE_SESSION_DIRTY_DEFAULT)))` and add `set_update_guard` to `generate_handler!`. Keep the doc comments factual: the main window reports; the prefs window installs; the flag holds the last delivered value.

- [ ] **Step 4: Run to verify they pass**

Run: `cargo test --manifest-path packages/desktop/src-tauri/Cargo.toml`
Expected: PASS — new tests plus the existing `dock_icon_resource` test.

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src-tauri/src/lib.rs
git commit -m "feat: gate install_update on a fail-closed session-dirty flag"
```

---

### Task 6: App wiring — report the guard, toast blocked

**Files:**
- Modify: `packages/web/src/App.tsx:1013-1018` (immediate autosave effect), `:1024-1030` (debounced effect), `:1040-1046` (unload flush), `:1065-1076` (`checkForUpdates` toast mapping)
- Test: `packages/web/test/update-guard-app.test.tsx` (new)

**Interfaces:**
- Consumes: `createSessionGuard`, `SessionGuard` from `./update-guard` (Task 2); `AutosaveStatus`-returning `saveAutosave` (Task 1); `set_update_guard` command (Task 5); `'updates.blocked'` key (Task 3); `UpdateEvent.kind === 'blocked'` (Task 4).
- Produces: nothing consumed later.

Wiring rules (these are the whole task — do not improvise beyond them):
1. One `SessionGuard` per App instance, created lazily in a ref. Its `send` is: `if (!IS_DESKTOP) return Promise.resolve(); return import('@tauri-apps/api/core').then(({ invoke }) => invoke('set_update_guard', { dirty }));` — the dynamic-import pattern of `App.tsx:208`, keeping the browser build inert.
2. Mount effect: `guard.sync()` once — delivers the initial clean report.
3. Immediate effect (scene ops, deps `robots/fieldId/field/selectedId/playbackRange`): `guard.edit(); guard.autosaveDone(saveAutosave(...));`.
4. Debounced effect (adds `t`): **never** `guard.edit()` — a playhead-only change is accepted-stale by design and marking it would block updates for an entire playback (Review Focus 2). Only the timeout callback does `guard.autosaveDone(saveAutosave(...));`.
5. Unload flush: `guard.autosaveDone(saveAutosave(...));` — best-effort; if the report cannot deliver during unload, the last delivered value stands (fail-closed direction).
6. `checkForUpdates` toast mapping: add `else if (e.kind === 'blocked') flash(tr('updates.blocked'), 'error');` — this covers the channel-switch path too (`listenPrefs('updateChannel')` → `checkForUpdates`), because both go through `runUpdateCheck`.

- [ ] **Step 1: Write the failing tests** (`update-guard-app.test.tsx`; copy the harness setup from `packages/web/test/prefs-channel.test.tsx` — stub `window.__TAURI_INTERNALS__` **before** the lazy `App` import, and `vi.mock('@tauri-apps/api/core', () => ({ invoke: native.invoke }))` so dynamic imports resolve to the mock)

```tsx
// Helper: guardCalls() filters the mocked invoke log to the command under
// test: native.invoke.mock.calls.filter((c) => c[0] === 'set_update_guard')
// Seed helper: serialize a session (makeSession(parseGhostAuto(SAMPLE)))
// into localStorage 'pb.autosave.v1' before render, as autosave.test.ts does.

// (a) A restored, healthy session never reports dirty — non-empty ≠ dirty.
it('a restored non-empty session reports exactly one clean guard state', async () => {
  seedAutosave();
  render(<App />);
  await waitFor(() => expect(guardCalls().length).toBeGreaterThan(0));
  expect(guardCalls()).toEqual([['set_update_guard', { dirty: false }]]);
});

// (b) Playback must not be judged dirty. Seed a session, start playback via
//     the transport control (accessible name comes from the playback
//     dictionary keys — grep i18n/en.ts for the play label), advance fake
//     timers >600 ms with shouldAdvanceTime so the rAF clock still ticks,
//     and assert the playhead-only debounce produced no dirty report:
it('a playing session never reports dirty', async () => {
  seedAutosave();
  render(<App />);
  fireEvent.click(screen.getByRole('button', { name: /* play label key */ }));
  vi.advanceTimersByTime(1500);
  expect(guardCalls()).toEqual([['set_update_guard', { dirty: false }]]);
});
//     If the transport control proves undrivable in jsdom, drive a playhead-
//     only change through the timeline scrubber instead — the assertion is
//     identical (a t-only change must not add a dirty report).

// (c) Autosave failure reports dirty, then recovery reports clean.
it('a session whose autosave cannot write reports dirty, and recovers', async () => {
  const setItem = stubSetItemToThrow();       // instance-owner spy, autosave.test.ts pattern
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  seedAutosave();                              // restore effect saves at mount → 'failed'
  render(<App />);
  await waitFor(() => expect(guardCalls()).toContainEqual(['set_update_guard', { dirty: true }]));
  setItem.mockRestore(); warn.mockRestore();
  dropFile('ghostauto/straight_run.ghostauto'); // fireEvent.drop, app.e2e pattern
  await waitFor(() => expect(guardCalls().at(-1)).toEqual(['set_update_guard', { dirty: false }]));
});

// (d) A browser build (no Tauri marker) never invokes the command.
it('the browser build never reports guard state', async () => {
  render(<App />);                            // no __TAURI_INTERNALS__ stub
  dropFile('ghostauto/straight_run.ghostauto');
  await waitFor(() => screen.getByRole('region')); // app alive and interactive
  expect(guardCalls()).toEqual([]);
});
```

Write each as a real `it(...)` with those exact assertions; the comments above are the contract, the test bodies are concrete (`screen`, `fireEvent`, `waitFor` from @testing-library/react; `vi.useFakeTimers()` for (b) with `shouldAdvanceTime` so rAF playback still ticks).

- [ ] **Step 2: Run to verify they fail**

Run: `cd packages/web && npx vitest run test/update-guard-app.test.tsx`
Expected: FAIL — no `set_update_guard` call is ever made (App does not report yet).

- [ ] **Step 3: Implement the wiring in `App.tsx`**

Exactly the six rules above; no other changes. Keep comments to the why (dirty = unsaved scene edits or failed autosave; playhead is accepted-stale), one short block per site.

- [ ] **Step 4: Run to verify they pass**

Run: `cd packages/web && npx vitest run test/update-guard-app.test.tsx test/app.e2e.test.tsx test/prefs-channel.test.tsx`
Expected: PASS — new tests plus the neighboring App suites (regression check).

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/App.tsx packages/web/test/update-guard-app.test.tsx
git commit -m "feat: report session-dirty state and surface blocked updates"
```

---

### Task 7: Preferences panel — blocked status, retryable install

**Files:**
- Modify: `packages/web/src/components/PreferencesPanel.tsx:53-60` (`UpdateCheck` type), `:132-138` (`updateStatusText`), `:197-201` (`startInstall`), `:349-357` (updates JSX)
- Test: `packages/web/test/prefs-channel.test.tsx` (extend — it already mocks `update-check` and drives the two-step flow)

**Interfaces:**
- Consumes: `installPendingUpdate(): Promise<'installed' | 'blocked'>` (Task 4); `'updates.blocked'` (Task 3).
- Produces: nothing consumed later.

- [ ] **Step 1: Write the failing tests** (extend the prefs update describe)

```tsx
// Blocked install: drive check → found (the existing harness holds the
// onEvent callback), click "Install and relaunch" with the
// installPendingUpdate mock resolving 'blocked':
it('a blocked install shows the blocked status and keeps the install button', async () => {
  driveCheckToFound('0.2.0');                    // existing harness pattern
  prefsCheck.install.mockResolvedValueOnce('blocked');
  fireEvent.click(screen.getByRole('button', { name: t('prefs.installUpdate') }));
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/* updates.blocked text */));
  expect(screen.getByRole('button', { name: t('prefs.installUpdate') })).toBeEnabled();
});
// A rejected install keeps today's semantics:
it('a failed install shows the failure and drops the install button', async () => {
  driveCheckToFound('0.2.0');
  prefsCheck.install.mockRejectedValueOnce(new Error('disk'));
  fireEvent.click(screen.getByRole('button', { name: t('prefs.installUpdate') }));
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/* updates.failed text */));
  expect(screen.queryByRole('button', { name: t('prefs.installUpdate') })).toBeNull();
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd packages/web && npx vitest run test/prefs-channel.test.tsx`
Expected: FAIL — `'blocked'` is not a state the panel knows; the blocked text never renders.

- [ ] **Step 3: Implement**

Add `| { kind: 'blocked'; version: string }` to `UpdateCheck`; `updateStatusText` gains a `'blocked'` branch rendering `t('updates.blocked')`; the install button renders for `kind === 'found' || kind === 'blocked'`; `startInstall` accepts both kinds and routes `installPendingUpdate()` through `.then((outcome) => { if (outcome === 'blocked') setUpdateCheck({ kind: 'blocked', version }); }).catch(() => setUpdateCheck({ kind: 'failed' }))`, keeping the `installing` disable while in flight. No other sections change.

- [ ] **Step 4: Run to verify they pass**

Run: `cd packages/web && npx vitest run test/prefs-channel.test.tsx`
Expected: PASS — whole file, existing staging cases untouched.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/components/PreferencesPanel.tsx packages/web/test/prefs-channel.test.tsx
git commit -m "feat: show a retryable blocked state for guarded update installs"
```

---

### Task 8: Full verification sweep (no commit — tree must end clean)

- [ ] **Step 1: Repo typecheck**

Run: `npm run typecheck` (repo root)
Expected: 0 errors.

- [ ] **Step 2: Full web + core tests**

Run: `npm test`
Expected: all workspace suites pass (existing Windows-specific flakes are a known CI-only caveat; on macOS the run must be green).

- [ ] **Step 3: Rust tests + release build** (binary-layer discipline: this change ships in the binary)

Run: `cargo test --manifest-path packages/desktop/src-tauri/Cargo.toml && cargo build --release --manifest-path packages/desktop/src-tauri/Cargo.toml`
Expected: tests pass; release build completes with 0 errors.

- [ ] **Step 4: Hygiene**

Run: `git diff --check && git status`
Expected: no whitespace errors; only the seven commits from Tasks 1-7 exist on the branch, working tree clean (no `sw.js` noise — nothing here runs `vite build`). Report the external-verification limits from the plan header as-is; do not claim Windows/installer/relaunch verification.
