#!/usr/bin/env bash
# Build the PathBlender AppImage, working around the tauri bundler's
# appimagetool hang: let `tauri build --bundles appimage` run until the
# AppDir is staged (linuxdeploy finished), detect the pack-stage stall,
# kill the bundler, then pack the AppDir with a standalone appimagetool.
#
# Usage: scripts/build-appimage.sh [repo-root]
# Env:   APPIMAGETOOL=path/to/appimagetool.AppImage  (optional override)
#        STALL_SECS=120                            (stall threshold, sec)
# Requires: npm, rust/cargo, the usual webkit2gtk build deps, libfuse2.
set -euo pipefail

ROOT="${1:-$(cd "$(dirname "$0")/.." && pwd)}"
STALL_SECS="${STALL_SECS:-120}"
# Cargo target dir when building from packages/desktop (the default:
# src-tauri/target, no workspace-level redirection in this repo).
# tauri names the AppDir after the product (PathBlender.AppDir) — glob it
# so the script survives casing/name changes.
APPDIR="$(ls -d "$ROOT"/packages/desktop/src-tauri/target/release/bundle/appimage/*.AppDir 2>/dev/null | head -1 || true)"
OUT="$ROOT/packages/desktop/src-tauri/target/PathBlender-x86_64.AppImage"
LOG=/tmp/pb-appimage-bundle.log

say() { printf '[appimage] %s\n' "$*"; }

# --- locate (or extract) a standalone appimagetool ------------------------
find_tool() {
  local c plugin tmpd
  for c in "${APPIMAGETOOL:-}" /tmp/appimagetool-x86_64.AppImage \
           "$HOME/.cache/pathblender/appimagetool-prefix/AppRun"; do
    if [ -n "$c" ] && [ -x "$c" ]; then printf '%s' "$c"; return 0; fi
  done
  # Extract the embedded mini appimagetool AppImage from the linuxdeploy
  # plugin tauri already cached. The plugin carries it as the
  # "appimagetool-prefix" directory (AppRun + usr/...); AppRun is the tool.
  plugin="$(find "$HOME/.cache/tauri" -maxdepth 1 -type f -name 'linuxdeploy-plugin-appimage-x86_64.AppImage' 2>/dev/null | head -1)"
  [ -z "$plugin" ] && plugin="$(find "$HOME/.cache" -type f -name 'linuxdeploy-plugin-appimage-x86_64.AppImage' 2>/dev/null | head -1)"
  [ -z "$plugin" ] && return 1
  tmpd="$(mktemp -d)"
  (cd "$tmpd" && ARCH=x86_64 "$plugin" --appimage-extract appimagetool-prefix >/dev/null 2>&1 || true)
  if [ -x "$tmpd/squashfs-root/appimagetool-prefix/AppRun" ]; then
    mkdir -p "$HOME/.cache/pathblender"
    rm -rf "$HOME/.cache/pathblender/appimagetool-prefix"
    mv "$tmpd/squashfs-root/appimagetool-prefix" "$HOME/.cache/pathblender/"
    rm -rf "$tmpd"
    printf '%s' "$HOME/.cache/pathblender/appimagetool-prefix/AppRun"
    return 0
  fi
  rm -rf "$tmpd"
  return 1
}

TOOL="$(find_tool)" || {
  echo "error: no standalone appimagetool available (set APPIMAGETOOL=...)" >&2
  exit 1
}
say "appimagetool: $TOOL"

# --- run tauri build until the pack-stage stall ----------------------------
cd "$ROOT/packages/desktop"
rm -f "$LOG"
npx tauri build --bundles appimage >"$LOG" 2>&1 &
BPID=$!
stalled=0
while kill -0 "$BPID" 2>/dev/null; do
  sleep 15
  kill -0 "$BPID" 2>/dev/null || break
  # Only probe for a stall once the bundler reached the appimage stage.
  pgrep -f 'appimagetool|linuxdeploy' >/dev/null 2>&1 || continue
  m1="$(stat -c %Y "$APPDIR" 2>/dev/null || date +%s)"
  s1="$(stat -c %s "$LOG" 2>/dev/null || printf 0)"
  sleep "$STALL_SECS"
  kill -0 "$BPID" 2>/dev/null || break
  m2="$(stat -c %Y "$APPDIR" 2>/dev/null || date +%s)"
  s2="$(stat -c %s "$LOG" 2>/dev/null || printf 0)"
  if [ "$m1" = "$m2" ] && [ "$s1" = "$s2" ] && grep -qi appimage "$LOG"; then
    stalled=1
    say "pack-stage stall detected — killing bundler"
    pkill -P "$BPID" 2>/dev/null || true
    kill "$BPID" 2>/dev/null || true
    sleep 2
    pkill -f 'tauri build' 2>/dev/null || true
    break
  fi
done

# If tauri completed on its own (bundler fixed upstream), its AppImage is
# already at the standard path — just report it.
TAURI_OUT="$(ls "$ROOT"/packages/desktop/src-tauri/target/release/bundle/appimage/*.AppImage 2>/dev/null | head -1 || true)"
if [ "$stalled" != 1 ] && [ -n "$TAURI_OUT" ] && [ -s "$TAURI_OUT" ]; then
  say "bundler completed on its own: $TAURI_OUT"
  exit 0
fi

# Re-glob the AppDir here, not only at script start: on a fresh tree the
# directory is staged by linuxdeploy during the build, so the startup glob
# resolves nothing and the stall-recovery pack below would run with an
# empty path (2026-10-03 verification run).
APPDIR="$(ls -d "$ROOT"/packages/desktop/src-tauri/target/release/bundle/appimage/*.AppDir 2>/dev/null | head -1 || true)"
[ -d "$APPDIR" ] || { echo "error: AppDir missing at $APPDIR" >&2; exit 1; }
say "packing $APPDIR (squashfs compression takes several minutes)"
ARCH=x86_64 NO_STRIP=true timeout 540 "$TOOL" "$APPDIR" "$OUT"
[ -s "$OUT" ] || { echo "error: pack produced no output" >&2; exit 1; }
say "built: $OUT ($(wc -c <"$OUT") bytes)"
