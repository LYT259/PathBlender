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
#   5. verify the app + mounted dmg carry the seal, icons and legal notices
#
# Usage: scripts/package-desktop-artifacts.sh <version> [options]
#   --dmg required|best-effort   dmg failure aborts (CI) or warns (local:
#                                hdiutil is intermittently flaky on the
#                                dev machine; CI builds the release dmg)
#   --updater required|auto      updater signing must succeed (CI) or is
#                                skipped with a warning when no key is on
#                                the machine (local install without the
#                                release key)
#   --target universal-apple-darwin  package and verify both Mac architectures
# Defaults: required / required. Signing key comes from either
# TAURI_SIGNING_PRIVATE_KEY (content) or TAURI_SIGNING_PRIVATE_KEY_PATH,
# mirroring what tauri itself accepts.
set -euo pipefail
setopt null_glob
cd "$(dirname "$0")/.."

VERSION="${1:-}"
DMG_MODE=required
UPDATER_MODE=required
TARGET=""
[[ -n "$VERSION" ]] || { echo "usage: $0 <version> [--dmg required|best-effort] [--updater required|auto]" >&2; exit 1; }
shift
while (( $# > 0 )); do
  case "$1" in
    --dmg) DMG_MODE="$2"; shift 2 ;;
    --updater) UPDATER_MODE="$2"; shift 2 ;;
    --target) TARGET="$2"; shift 2 ;;
    *) echo "package-desktop-artifacts.sh: unknown flag: $1" >&2; exit 1 ;;
  esac
done

case "$DMG_MODE:$UPDATER_MODE" in
  (required:required|required:auto|best-effort:required|best-effort:auto) ;;
  (*) echo "package-desktop-artifacts.sh: invalid packaging mode" >&2; exit 1 ;;
esac
case "$TARGET" in
  ("") BUNDLE=packages/desktop/src-tauri/target/release/bundle; DMG_ARCH=aarch64 ;;
  (universal-apple-darwin) BUNDLE=packages/desktop/src-tauri/target/universal-apple-darwin/release/bundle; DMG_ARCH=universal ;;
  (*) echo "package-desktop-artifacts.sh: unsupported target: $TARGET" >&2; exit 1 ;;
esac
APP="$BUNDLE/macos/PathBlender.app"
[[ -d "$APP" ]] || { echo "package-desktop-artifacts.sh: bundle not found: $APP" >&2; exit 1; }

verify_legal_notices() {
  local app="$1" relative
  for relative in LICENSE NOTICE.md licenses/FRCDesignApp-MIT.txt; do
    [[ -f "$app/Contents/Resources/$relative" ]] || {
      echo "package-desktop-artifacts.sh: missing legal notice: $app/Contents/Resources/$relative" >&2
      return 1
    }
  done
}
verify_legal_notices "$APP"

verify_architectures() {
  [[ "$TARGET" == universal-apple-darwin ]] || return 0
  local app="$1" executable
  executable=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "$app/Contents/Info.plist")
  verify_arch() {
    lipo "$app/Contents/MacOS/$executable" -verify_arch "$1" || {
      echo "package-desktop-artifacts.sh: Universal bundle is missing $1" >&2; return 1
    }
  }
  verify_arch arm64 && verify_arch x86_64
}
verify_architectures "$APP"

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
  # Only ONE key form may reach the signer: install-desktop.sh exports BOTH
  # (content + path), and the tauri CLI turns each env var into an implicit
  # flag — together they abort with "--private-key cannot be used with
  # --private-key-path" (local install, 2026-10-02). env -u whichever form
  # we are NOT using. Path form wins when both exist (matches the original
  # install-desktop.sh behavior).
  if [[ -n "${TAURI_SIGNING_PRIVATE_KEY_PATH:-}" ]]; then
    (cd packages/desktop && env -u TAURI_SIGNING_PRIVATE_KEY \
      npx tauri signer sign --private-key-path "$TAURI_SIGNING_PRIVATE_KEY_PATH" \
      --password "${TAURI_SIGNING_PRIVATE_KEY_PASSWORD:-}" "$UPDATER_ABS")
  else
    (cd packages/desktop && env -u TAURI_SIGNING_PRIVATE_KEY_PATH \
      npx tauri signer sign "$UPDATER_ABS")
  fi
elif [[ "$UPDATER_MODE" == auto ]]; then
  echo "warn: no updater signing key on this machine — keeping tauri's build-time updater artifacts (unsigned re-wrap skipped)" >&2
else
  echo "package-desktop-artifacts.sh: updater signing required but no key (set TAURI_SIGNING_PRIVATE_KEY or _PATH)" >&2
  exit 1
fi

# --- 4. dmg from the sealed bundle -------------------------------------------
# Output goes to bundle/dmg/ — the path release.yml collects from. v0.1.6-
# beta.22 shipped the PRE-seal dmg because this script wrote to bundle/macos/
# while the workflow collected tauri's own untouched dmg from bundle/dmg/.
# The whole dmg dir is rebuilt so no stale tauri-era image can survive.
DMG_DIR="$(dirname "$(dirname "$APP")")/dmg"
rm -f "$(dirname "$APP")"/*.dmg
rm -rf "$DMG_DIR"
mkdir -p "$DMG_DIR"
DMG="$DMG_DIR/PathBlender_${VERSION}_${DMG_ARCH}.dmg"
if ! scripts/make-dmg.sh "$APP" "$DMG"; then
  rm -f "$DMG"
  if [[ "$DMG_MODE" == best-effort ]]; then
    echo "warn: local dmg skipped (hdiutil flaky here; CI builds the release dmg)" >&2
  else
    echo "package-desktop-artifacts.sh: dmg creation failed" >&2
    exit 1
  fi
fi

# --- 5. Verify the dmg that will actually be downloaded ----------------------
# The beta.22 release looked green because nothing ever OPENED the uploaded
# image. Mount the finished dmg and hard-gate on the seal, dark-mode icon
# catalog and legal notices before anyone can collect it (same checks the
# local install gate runs on /Applications).
if [[ -f "$DMG" ]]; then
  MNT="$(mktemp -d)/pb-dmg-verify"
  if ! hdiutil attach -nobrowse -readonly -mountpoint "$MNT" "$DMG" >/dev/null 2>&1; then
    echo "package-desktop-artifacts.sh: cannot mount the finished dmg to verify it" >&2
    exit 1
  fi
  set +e
  codesign --verify --deep --strict "$MNT/PathBlender.app"
  SEAL_RC=$?
  [[ -f "$MNT/PathBlender.app/Contents/Resources/Assets.car" ]]
  ICON_RC=$?
  verify_architectures "$MNT/PathBlender.app"
  ARCH_RC=$?
  verify_legal_notices "$MNT/PathBlender.app"
  LEGAL_RC=$?
  set -e
  hdiutil detach "$MNT" >/dev/null 2>&1 || true
  if (( SEAL_RC != 0 )); then
    echo "package-desktop-artifacts.sh: dmg content failed strict codesign verification" >&2
    exit 1
  fi
  if (( ICON_RC != 0 )); then
    echo "package-desktop-artifacts.sh: dmg content is missing the day+night icon catalog (Assets.car)" >&2
    exit 1
  fi
  if (( ARCH_RC != 0 )); then
    echo "package-desktop-artifacts.sh: dmg content is not Universal" >&2
    exit 1
  fi
  if (( LEGAL_RC != 0 )); then
    echo "package-desktop-artifacts.sh: dmg content is missing required legal notices" >&2
    exit 1
  fi
fi

echo "packaged: sealed app + updater artifacts + verified dmg for v$VERSION"
