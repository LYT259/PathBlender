#!/bin/zsh
# Shared post-build desktop packaging pipeline — the ONE path every shipped
# artifact takes, whether built locally (install-desktop.sh) or in CI
# (release.yml). Before this script existed the two flows had drifted: CI
# re-wrapped the app after the icon injection but never sealed it, so
# release dmg/tar.gz contents failed `codesign --verify --deep --strict`
# while every locally installed copy passed. Same bytes, same gates, both
# machines.
#
# Pipeline (in order — the seal must cover the injected icon, and the
# updater archive + dmg must wrap the sealed bundle):
#   1. inject the day+night icon catalog (apply-dark-icon.sh)
#   2. strip foreign xattrs, ad-hoc codesign, strict-verify (hard gate)
#   3. regenerate PathBlender.app.tar.gz + .sig from the sealed bundle
#   4. regenerate the dmg from the sealed bundle
#
# Usage: scripts/package-desktop-artifacts.sh <version> [options]
#   --dmg required|best-effort   dmg failure aborts (CI) or warns (local:
#                                hdiutil is intermittently flaky on the
#                                dev machine; CI builds the release dmg)
#   --updater required|auto      updater signing must succeed (CI) or is
#                                skipped with a warning when no key is on
#                                the machine (local install without the
#                                release key)
# Defaults: required / required. Signing key comes from either
# TAURI_SIGNING_PRIVATE_KEY (content) or TAURI_SIGNING_PRIVATE_KEY_PATH,
# mirroring what tauri itself accepts.
set -euo pipefail
setopt null_glob
cd "$(dirname "$0")/.."

VERSION="${1:-}"
DMG_MODE=required
UPDATER_MODE=required
[[ -n "$VERSION" ]] || { echo "usage: $0 <version> [--dmg required|best-effort] [--updater required|auto]" >&2; exit 1; }
shift
while (( $# > 0 )); do
  case "$1" in
    --dmg) DMG_MODE="$2"; shift 2 ;;
    --updater) UPDATER_MODE="$2"; shift 2 ;;
    *) echo "package-desktop-artifacts.sh: unknown flag: $1" >&2; exit 1 ;;
  esac
done

APP=packages/desktop/src-tauri/target/release/bundle/macos/PathBlender.app
[[ -d "$APP" ]] || { echo "package-desktop-artifacts.sh: bundle not found: $APP" >&2; exit 1; }

# --- 1. Dark-mode icon catalog -----------------------------------------------
scripts/apply-dark-icon.sh "$APP"

# --- 2. Seal + strict verification -------------------------------------------
# Tauri's macOS bundler leaves the app linker-signed only (no
# _CodeSignature/CodeResources), which fails strict verification. Re-sign
# ad-hoc (standing no-Apple-account decision) so the seal covers the
# injected Assets.car too.
xattr -cr "$APP"
codesign --force --deep --sign - "$APP"
if ! codesign --verify --deep --strict "$APP"; then
  echo "package-desktop-artifacts.sh: strict codesign verification FAILED" >&2
  exit 1
fi

# --- 3. Updater archive from the sealed bundle -------------------------------
# The tar.gz tauri produced during build wraps the PRE-seal app; regenerate
# it (and its signature) so the feed never points at an unsealed build.
UPDATER="$APP.tar.gz"
# Resolve the absolute path BEFORE the `cd packages/desktop` subshells below
# ($PWD shifts inside them) — npx needs the tauri CLI from the workspace.
UPDATER_ABS="$PWD/$UPDATER"
if [[ -n "${TAURI_SIGNING_PRIVATE_KEY:-}" || -n "${TAURI_SIGNING_PRIVATE_KEY_PATH:-}" ]]; then
  rm -f "$UPDATER" "$UPDATER.sig"
  (cd "$(dirname "$UPDATER")" && tar -czf "$(basename "$UPDATER")" "$(basename "$APP")")
  if [[ -n "${TAURI_SIGNING_PRIVATE_KEY:-}" ]]; then
    (cd packages/desktop && npx tauri signer sign "$UPDATER_ABS")
  else
    # env -u: the content-form env (if also set) conflicts with --private-key-path.
    (cd packages/desktop && env -u TAURI_SIGNING_PRIVATE_KEY \
      npx tauri signer sign --private-key-path "$TAURI_SIGNING_PRIVATE_KEY_PATH" \
      --password "${TAURI_SIGNING_PRIVATE_KEY_PASSWORD:-}" "$UPDATER_ABS")
  fi
elif [[ "$UPDATER_MODE" == auto ]]; then
  echo "warn: no updater signing key on this machine — keeping tauri's build-time updater artifacts (unsigned re-wrap skipped)" >&2
else
  echo "package-desktop-artifacts.sh: updater signing required but no key (set TAURI_SIGNING_PRIVATE_KEY or _PATH)" >&2
  exit 1
fi

# --- 4. dmg from the sealed bundle -------------------------------------------
DMG="$(dirname "$APP")/PathBlender_${VERSION}_aarch64.dmg"
rm -f "$(dirname "$APP")"/*.dmg
if ! scripts/make-dmg.sh "$APP" "$DMG"; then
  rm -f "$DMG"
  if [[ "$DMG_MODE" == best-effort ]]; then
    echo "warn: local dmg skipped (hdiutil flaky here; CI builds the release dmg)" >&2
  else
    echo "package-desktop-artifacts.sh: dmg creation failed" >&2
    exit 1
  fi
fi

echo "packaged: sealed app + updater artifacts + dmg for v$VERSION"
