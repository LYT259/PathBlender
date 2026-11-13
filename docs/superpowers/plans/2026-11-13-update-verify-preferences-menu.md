# update-verify: open Preferences through the native Help menu (2026-11-13)

Branch `fix/update-verify-preferences-menu` · base `beta.21@d38bdc01` · task `task:update-verify-preferences-menu`

## Failure being fixed

Real dispatch run 43390027355 (from `v0.1.10-beta.20`, 2026-11-13T08:01Z):
beta.20 installed and launched fine, then the drive step failed —
`Ctrl+, did not open Preferences — falling back to the native menu item`
(08:03:03) and `Preferences window never opened` (08:03:44). The updater never
took over because the drive never reached the channel switch.

## Root cause (source-verified, not a focus/timing guess)

The `Ctrl+,` shortcut does not exist on Windows at all:

- `packages/web/src/menu-spec.ts:117` — the `preferences` item with the
  `CmdOrCtrl+,` accelerator lives in the app menu, which is `macOnly: true`.
- `packages/desktop/src-tauri/src/lib.rs` `build_menu_from_spec` skips
  `mac_only` sections on non-macOS, so the Windows native menu has **no
  Preferences item and no accelerator** (its top-level menus are File / Edit /
  View / Playback / Help).
- `packages/web/src/App.tsx:997` — the web global keydown handler returns
  early on any `ctrlKey`/`metaKey`; plain `,` is bound to "step robot back".
  So `SendKeys "^,"` is a no-op on Windows regardless of focus.

The old fallback looked for a top-level `Check for updates` element under the
main window's UIA subtree; a Win32 menu dropdown is not exposed as an
invokable descendant of the app window until the menu is expanded (run 43390027355:
15s search found nothing, then the 25s window wait expired).

## The real Windows UI path

`Help → Check for updates` (menu-spec.ts:238, `isDesktop`-gated):
`pb-menu-check-update` → `openPreferencesOnUpdates` (App.tsx:1591) →
`invoke('open_preferences', { updates: true })` → Rust `open_prefs(app, true)`
creates the `Preferences` window already on its Updates section.
Secondary: `Help → About PathBlender` (helpItems `about`, App.tsx:1598) opens
the plain Preferences window.

## Change (workflow-driven only — no product change)

In `.github/workflows/update-verify.yml`, drive step:

1. Drop the dead `Ctrl+,` SendKeys attempt (provably a no-op on Windows).
2. Add `Open-MainMenu` helper: find the `Help` menu-bar item under the main
   window, expand it (ExpandCollapse, Invoke and LegacyIAccessible
   DoDefaultAction in that order), then locate the dropdown item — under the
   expanded item first, then under the desktop root (Win32 dropdowns are
   #32768 popups parented to the root).
3. Invoke `Check for updates` → wait for the `Preferences` window; if that
   fails, retry the menu for `About PathBlender` (plain window; the existing
   Updates-tab click still lands it on Updates) before failing.
4. Log each step's outcome and the discovered top-level menu names to the
   step log and `update-log.txt` (diagnosable without screenshots).
5. Everything downstream is untouched: Updates tab click, channel combobox →
   Beta → Save, consume-first/45s-cadence prefs two-step, oldPid takeover
   watch, file-version and relaunch gates, artifacts `if: always()`.

## Contract tests (RED first)

`packages/web/test/release-pipeline.test.ts`:

- no `SendKeys "^,"` in the drive step; Preferences is opened via the Help
  menu (`Expand` on the Help item precedes the `Check for updates` search);
- the `About PathBlender` second menu attempt exists after the first;
- menu discovery is logged (Write-Host + update-log.txt) before invoking;
- the existing probe-count contract (`Get-Process -Id $oldPid` × 5) must stay
  exactly 5 — the opener change must not add or remove takeover probes.

## Gates

`npm run typecheck` · `npm test` (full) · YAML parse of the workflow ·
push → PR bot (`op run`) → three-platform Beta gate → real
`gh workflow run update-verify.yml --ref fix/update-verify-preferences-menu
-f from_tag=v0.1.10-beta.20` dispatch must show the actual takeover.
