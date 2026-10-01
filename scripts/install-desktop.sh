#!/bin/zsh
# Build → install the desktop app and REMOVE the staging copies so
# Spotlight/Launchpad only ever show the /Applications entry.
# Usage: scripts/install-desktop.sh [--no-build]
set -euo pipefail
cd "$(dirname "$0")/.."

# Sign the updater artifacts whenever the release key is on this machine
# (primary: ~/.tauri — see secrets/README.md for backup discipline).
if [[ -f "$HOME/.tauri/pathblender-updater.key" ]]; then
  export TAURI_SIGNING_PRIVATE_KEY_PATH="$HOME/.tauri/pathblender-updater.key"
  export TAURI_SIGNING_PRIVATE_KEY="$(<"$HOME/.tauri/pathblender-updater.key")"
  export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="" # key generated with empty password
fi

if [[ "${1:-}" != "--no-build" ]]; then
  # --bundles app: tauri's own dmg step (create-dmg fork) has grown flaky on
  # this machine (bails with a bogus ENOSPC while hdiutil works fine), and its
  # dmg wrapped the pre-seal app anyway — we regenerate the dmg ourselves below.
  # The updater artifacts (tar.gz + sig) still come out of the app bundle.
  (cd packages/desktop && npx tauri build --bundles app)
fi

BUNDLE=packages/desktop/src-tauri/target/release/bundle/macos/PathBlender.app
[[ -d "$BUNDLE" ]] || { echo "bundle not found: $BUNDLE" >&2; exit 1; }

# --- Seal the bundle before anything ships it (2026-09-27) ----------------
# Tauri's macOS bundler leaves the app linker-signed only (no
# _CodeSignature/CodeResources), which fails `codesign --verify --deep
# --strict` ("code has no resources but signature indicates they must be
# present"). Re-sign ad-hoc per the standing no-Apple-account decision, strip
# sync-introduced xattrs first (GHPaths hit those too), and make strict
# verification a hard gate.
xattr -cr "$BUNDLE"
codesign --force --deep --sign - "$BUNDLE"
if ! codesign --verify --deep --strict "$BUNDLE"; then
  echo "install-desktop.sh: strict codesign verification FAILED" >&2
  exit 1
fi

# The updater archive tauri produced during build wraps the PRE-seal app.
# Regenerate it (and its signature) from the sealed bundle whenever the
# release key is on this machine — the updater feed must never point at an
# unsealed build.
if [[ -n "${TAURI_SIGNING_PRIVATE_KEY_PATH:-}" ]]; then
  UPDATER="$BUNDLE.tar.gz"
  rm -f "$UPDATER" "$UPDATER.sig"
  (cd "$(dirname "$BUNDLE")" && tar -czf "$(basename "$UPDATER")" "$(basename "$BUNDLE")")
  # env -u: the exported TAURI_SIGNING_PRIVATE_KEY (key content) conflicts
  # with --private-key-path; the key itself is passwordless.
  UPDATER_ABS="$PWD/$UPDATER" # resolve before the cd below ($PWD shifts inside)
  (cd packages/desktop && env -u TAURI_SIGNING_PRIVATE_KEY \
    npx tauri signer sign --private-key-path "$TAURI_SIGNING_PRIVATE_KEY_PATH" \
    --password "" "$UPDATER_ABS")
fi

# Same story for the dmg: tauri's own dmg wraps the pre-seal app. Regenerate
# it from the sealed bundle so every shipped artifact carries the seal.
APP_VERSION="$(node -p "require('./package.json').version")"
DMG="$(dirname "$BUNDLE")/PathBlender_${APP_VERSION}_aarch64.dmg"
rm -f "$DMG" "$(dirname "$BUNDLE")"/*.dmg
hdiutil create -volname PathBlender -srcfolder "$BUNDLE" -ov -format UDZO "$DMG" >/dev/null

# Clean replace (2026-10-01): ditto onto an existing install leaves behind
# files the new build no longer ships, so the installed app drifts from the
# sealed bundle. Remove the old copy first — /Applications must match the
# sealed build exactly (user instruction: 安装新软件前把旧软件删干净).
rm -rf /Applications/PathBlender.app
ditto "$BUNDLE" /Applications/PathBlender.app
# Verify the INSTALLED copy too — ditto must preserve the seal intact.
if ! codesign --verify --deep --strict /Applications/PathBlender.app; then
  echo "install-desktop.sh: installed app failed strict verification" >&2
  exit 1
fi

# Delete every staged .app under bundle/ — they are Spotlight-indexed
# otherwise (the source of the duplicate search hits).
rm -rf packages/desktop/src-tauri/target/release/bundle/macos/*.app

echo "installed: /Applications/PathBlender.app (staging apps removed)"
