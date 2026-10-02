# ADR-0003: Desktop shell → web communication goes through eval-pushed DOM events

- Status: Accepted (2026-10-02)
- Scope: packages/desktop (Tauri shell) + web-side desktop wiring

## Context

The 2026-10-02 Linux verification (Ubuntu 26.04, WebKitGTK 2.52, Xvfb smoke) found
every menu-driven web action dead on fresh launches: Save Session, Export PNG,
Share, Clear, Check-for-Updates, and sometimes the native import picker. Evidence
collected with Rust-side probes and the WebKitGTK remote inspector
(`WEBKIT_INSPECTOR_HTTP_SERVER` → `Runtime.evaluate`):

- Rust menu events fire and `app.emit(…)` runs; the IPC bridge is complete
  (`__TAURI_INTERNALS__.invoke` present, manual `listen()` from the inspector works);
- on fresh launches the app's own `listen()` registrations (registered from a
  dynamically-imported `@tauri-apps/api/event` chunk inside a `useEffect`) never
  activate — no picker, no handler, no `save_file` invoke;
- in one long-lived instance the whole chain worked, i.e. the failure is a race,
  not a hard break.

Root cause class: web-side `listen()` + `import()` can silently lose the race
against page load on WebKitGTK; failures are swallowed by `void … .then(…)`
without `.catch`. The 2026-09-06 "passing" save flow never exercised this path —
it accidentally went through WebKitGTK's own blob-download dialog, which newer
WebKit versions no longer show.

## Decision

1. **Menu commands are pushed, not subscribed.** The Rust shell dispatches DOM
   `CustomEvent`s directly into the page via `webview.eval()`:
   - `ghpb-open-files` — `[name, base64]` pairs for files: launch-argument
     (open-with) files delivered on `PageLoadEvent::Finished` (once), and files
     picked by the shell-owned native import dialog.
   - `ghpb-menu-save|share|png|clear|check-update` — action triggers.
   The web side consumes them with plain `window.addEventListener`, plus a
   `window.__ghpbOpenPayload` stash consumed on mount for deliveries that
   preceded React. The same code runs in the browser build where nothing
   dispatches these events (inert).
2. **The shell owns the import picker.** File > Import opens the native dialog
   from Rust (in a dedicated `std::thread`, because blocking GTK dialogs must
   not run on the main thread or the async runtime) and pushes results through
   `ghpb-open-files`. The hidden-`<input>` click path remains for the visible
   Import button.
3. **Blocking dialogs run on a dedicated thread.** `save_file` spawns a thread
   for `blocking_save_file()` and channels the result back through `mpsc`.
4. **Tauri API imports are static** (`download.ts`, `update-check.ts`) — no
   dynamic `import()` of the API chunk remains on action paths.

Ported from the unmerged `feat/mac-sync` branch (2026-09-06 Linux acceptance),
which pioneered the eval channel for open-with and native import; this ADR
records the design for the merged implementation.

## Consequences

- Menu/open-with flows no longer depend on Tauri event listeners, eliminating
  the WebKitGTK race on macOS, Linux and Windows alike.
- `desktop-smoke.sh` (ported into `scripts/`, Linux/Xvfb) exercises the real
  flows end to end: window/paint gates, native import picker, save dialog,
  PNG dialog, open-with launch.
- Tauri `listen()`/`emit()` remains only for cross-window preference sync
  (`pref-sync.ts`), which is cosmetic if it loses the race; migrating it to the
  eval channel can follow if it ever proves flaky.
