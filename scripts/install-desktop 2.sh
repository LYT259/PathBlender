#!/bin/zsh
# Build → install the desktop app and REMOVE the staging copies so
# Spotlight/Launchpad only ever show the /Applications entry.
# Usage: scripts/install-desktop.sh [--no-build]
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ "${1:-}" != "--no-build" ]]; then
  (cd packages/desktop && npx tauri build)
fi

BUNDLE=packages/desktop/src-tauri/target/release/bundle/macos/PathBlender.app
[[ -d "$BUNDLE" ]] || { echo "bundle not found: $BUNDLE" >&2; exit 1; }

ditto "$BUNDLE" /Applications/PathBlender.app

# Delete every staged .app under bundle/ — they are Spotlight-indexed
# otherwise (the source of the duplicate search hits).
rm -rf packages/desktop/src-tauri/target/release/bundle/macos/*.app

echo "installed: /Applications/PathBlender.app (staging apps removed)"
