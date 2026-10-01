#!/bin/zsh
# Compile the Icon-Composer-style AppIcon.icon bundle (day + dark layers) and
# inject it into a built .app, so macOS swaps the dock/Finder icon with the
# system appearance (2026-10-01, round-14 icons: day = red base, night =
# black base).
#
# Findings baked into this pipeline (all verified live on macOS 27):
# - Tauri's bundler only ships a plain icon.icns (CFBundleIconFile), which has
#   no appearance variants; classic .appiconset luminosity entries are
#   silently flattened by actool on macOS, so they can't carry a dark icon.
# - The .icon bundle does: actool compiles it into an Assets.car whose AppIcon
#   iconstack carries Aqua + DarkAqua renditions, and macOS prefers the icon
#   named by CFBundleIconName over the legacy icns.
# - The layer MUST carry "glass": false (plus blend-mode/fill, group
#   shadow/translucency and supported-platforms, i.e. the canonical set Icon
#   Composer itself writes): with glass left on, macOS renders the stack
#   through Liquid Glass and draws a system baseplate ring around the art;
#   a minimal hand-written JSON without those keys silently loses the dark
#   specialization at compile time. Do not strip them.
#
# Run this BEFORE sealing — the caller's codesign step then covers the
# injected resources.
#
# Usage: scripts/apply-dark-icon.sh <path-to-PathBlender.app>
set -euo pipefail
cd "$(dirname "$0")/.."

APP="${1:?usage: apply-dark-icon.sh <path-to-PathBlender.app>}"
[[ -d "$APP/Contents/MacOS" ]] || { echo "apply-dark-icon.sh: not a macOS app bundle: $APP" >&2; exit 1; }

ICON_BUNDLE="packages/desktop/src-tauri/icons/AppIcon.icon"
[[ -f "$ICON_BUNDLE/icon.json" ]] || { echo "apply-dark-icon.sh: icon bundle missing: $ICON_BUNDLE" >&2; exit 1; }

# actool ships with full Xcode; the Command Line Tools alone don't have it.
if ! ACTOOL="$(xcrun --find actool 2>/dev/null)"; then
  for X in /Applications/Xcode.app /Applications/Xcode-beta.app; do
    if [[ -x "$X/Contents/Developer/usr/bin/actool" ]]; then
      export DEVELOPER_DIR="$X/Contents/Developer"
      ACTOOL="$(xcrun --find actool)"
      break
    fi
  done
fi
[[ -n "${ACTOOL:-}" ]] || { echo "apply-dark-icon.sh: actool not found (needs full Xcode, not just CLT)" >&2; exit 1; }

OUT="$(mktemp -d)"
trap 'rm -rf "$OUT"' EXIT

"$ACTOOL" "$ICON_BUNDLE" --app-icon AppIcon \
  --compile "$OUT" \
  --output-partial-info-plist "$OUT/partial.plist" \
  --minimum-deployment-target 13.0 --platform macosx --target-device mac \
  >/dev/null

CAR="$OUT/Assets.car"
[[ -s "$CAR" ]] || { echo "apply-dark-icon.sh: actool produced no Assets.car" >&2; exit 1; }

# Hard gate: the compiled catalog must actually carry a dark-appearance
# iconstack rendition, otherwise the injection would silently install a
# day-only icon.
if ASSETUTIL="$(xcrun --find assetutil 2>/dev/null)"; then
  DARK_COUNT=$("$ASSETUTIL" --info "$CAR" | grep -c 'NSAppearanceNameDarkAqua')
  [[ "$DARK_COUNT" -ge 1 ]] || { echo "apply-dark-icon.sh: Assets.car carries no dark appearance rendition" >&2; exit 1; }
fi

cp "$CAR" "$APP/Contents/Resources/Assets.car"
/usr/libexec/PlistBuddy -c 'Delete :CFBundleIconName' "$APP/Contents/Info.plist" 2>/dev/null || true
/usr/libexec/PlistBuddy -c 'Add :CFBundleIconName string AppIcon' "$APP/Contents/Info.plist"

echo "apply-dark-icon.sh: day+night AppIcon catalog injected into $APP"
