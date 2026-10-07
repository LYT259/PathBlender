#!/bin/zsh
# Build → install the desktop app and REMOVE the staging copies so
# Spotlight/Launchpad only ever show the /Applications entry.
# Usage: scripts/install-desktop.sh [--no-build] [--force-tree]
set -euo pipefail
# null_glob: the dmg/app cleanup globs below legally match nothing (e.g. a
# --bundles app build leaves no dmg); without this zsh aborts the script on
# "no matches found" before rm even runs (hit 2026-10-02: install stopped
# between the updater-sign step and the /Applications swap).
setopt null_glob
cd "$(dirname "$0")/.."

NO_BUILD=0
FORCE_TREE=0
for arg in "$@"; do
  case "$arg" in
    --no-build) NO_BUILD=1 ;;
    --force-tree) FORCE_TREE=1 ;;
    *) echo "install-desktop.sh: unknown flag: $arg" >&2; exit 1 ;;
  esac
done

# --- Single-writer install lock (2026-10-02) --------------------------------
# Parallel sessions overwrote each other's /Applications swap on the same
# day. mkdir is atomic, so the second concurrent install stops here; a
# crash can leave the lock behind and the message says how to clear it.
LOCK=/tmp/pathblender-install.lock
if ! mkdir "$LOCK" 2>/dev/null; then
  echo "install-desktop.sh: another install seems to be running ($LOCK exists)." >&2
  echo "  If nothing is installing, clear it with: rmdir $LOCK" >&2
  exit 1
fi
trap 'rmdir "$LOCK" 2>/dev/null || true' EXIT

# --- Tree gate (2026-10-02) --------------------------------------------------
# A parallel session once left the main tree on an unpushed branch based on
# stale beta; a routine "pull + install" then built and shipped an app that
# missed every fix merged that day (caught only by the version string). The
# installer refuses to build from anything that is not beta at origin's tip
# — on beta, or a worktree detached exactly at origin/beta. --force-tree
# opts out for deliberate special cases.
if (( FORCE_TREE == 0 )); then
  git fetch origin beta >/dev/null 2>&1 || \
    echo "install-desktop.sh: fetch failed — checking against last-known origin/beta" >&2
  BRANCH="$(git symbolic-ref --short -q HEAD || true)"
  HEAD_SHA="$(git rev-parse HEAD)"
  BETA_SHA="$(git rev-parse origin/beta)"
  if [[ -n "$BRANCH" && "$BRANCH" != "beta" ]]; then
    echo "install-desktop.sh: REFUSING — tree is on branch '$BRANCH', not beta." >&2
    echo "  Move the work to a worktree and leave the main tree docked on beta," >&2
    echo "  or run this script from a worktree detached at origin/beta." >&2
    echo "  (--force-tree overrides deliberately)" >&2
    exit 1
  fi
  if [[ "$HEAD_SHA" != "$BETA_SHA" ]]; then
    echo "install-desktop.sh: REFUSING — HEAD $HEAD_SHA is not origin/beta ($BETA_SHA)." >&2
    echo "  git pull (on beta) first, or install from a worktree detached at origin/beta." >&2
    echo "  (--force-tree overrides deliberately)" >&2
    exit 1
  fi
  # Known build-rewritten noise is fine; anything else means
  # someone is mid-work in this tree.
  if ! git diff --quiet HEAD -- . ':(exclude)packages/web/public/sw.js' ':(exclude)packages/desktop/src-tauri/gen/schemas/capabilities.json'; then
    echo "install-desktop.sh: REFUSING — tree has changes beyond the known build noise" >&2
    echo "  (sw.js / capabilities.json). Commit or stash them first. (--force-tree overrides)" >&2
    exit 1
  fi
fi

# Sign the updater artifacts whenever the release key is on this machine
# (primary: ~/.tauri — see secrets/README.md for backup discipline).
if [[ -f "$HOME/.tauri/pathblender-updater.key" ]]; then
  export TAURI_SIGNING_PRIVATE_KEY_PATH="$HOME/.tauri/pathblender-updater.key"
  export TAURI_SIGNING_PRIVATE_KEY="$(<"$HOME/.tauri/pathblender-updater.key")"
  export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="" # key generated with empty password
fi

if (( NO_BUILD == 0 )); then
  # --bundles app: tauri's own dmg step (create-dmg fork) has grown flaky on
  # this machine (bails with a bogus ENOSPC while hdiutil works fine), and its
  # dmg wrapped the pre-seal app anyway — we regenerate the dmg ourselves below.
  # The updater artifacts (tar.gz + sig) still come out of the app bundle.
  (cd packages/desktop && npx tauri build --bundles app)
fi

BUNDLE=packages/desktop/src-tauri/target/release/bundle/macos/PathBlender.app
[[ -d "$BUNDLE" ]] || { echo "bundle not found: $BUNDLE" >&2; exit 1; }

# --- Shared packaging pipeline (2026-10-02) ----------------------------------
# Icon injection → ad-hoc seal → strict verify → updater tar.gz + sig → dmg,
# the exact same script release.yml runs in CI: every shipped artifact takes
# one path, so a locally installed app and a downloaded release build can no
# longer diverge in how they are sealed. dmg is best-effort here (hdiutil is
# intermittently flaky on this machine; CI builds the release dmg) and the
# updater signature is regenerated whenever the release key is present.
APP_VERSION="$(node -p "require('./package.json').version")"
scripts/package-desktop-artifacts.sh "$APP_VERSION" --dmg best-effort --updater auto

# Clean replace (2026-10-01): ditto onto an existing install leaves behind
# files the new build no longer ships, so the installed app drifts from the
# sealed bundle. Remove the old copy first — /Applications must match the
# sealed build exactly (user instruction: 安装新软件前把旧软件删干净).
# Near-atomic swap (2026-10-01): stage the full copy beside the target first,
# then remove the old app and move the staged one in back-to-back. Deleting
# up front left a multi-minute window with NO installed app while ditto ran —
# during a parallel-session rebuild that made Spotlight/Dock serve the stale
# day-only icon from cache (user report 2026-10-01 19:19). The swap window is
# now sub-second, too short for LaunchServices to notice.
STAGED=/Applications/.PathBlender.app.staged
rm -rf "$STAGED"
ditto "$BUNDLE" "$STAGED"
rm -rf /Applications/PathBlender.app
mv "$STAGED" /Applications/PathBlender.app
# Verify the INSTALLED copy too — ditto must preserve the seal intact.
if ! codesign --verify --deep --strict /Applications/PathBlender.app; then
  echo "install-desktop.sh: installed app failed strict verification" >&2
  rm -rf /Applications/PathBlender.app
  exit 1
fi

# Version audit (2026-10-02): the tree gate's twin. The wrong-tree incident
# was caught by exactly this comparison, done by hand — make it mechanical:
# the installed app must report the version this tree built, or the install
# is removed rather than shipped.
INSTALLED_VERSION="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' \
  /Applications/PathBlender.app/Contents/Info.plist 2>/dev/null || true)"
if [[ "$INSTALLED_VERSION" != "$APP_VERSION" ]]; then
  echo "install-desktop.sh: installed app reports '$INSTALLED_VERSION' but this tree" >&2
  echo "  built '$APP_VERSION' — removing the bad install instead of shipping it" >&2
  rm -rf /Applications/PathBlender.app
  exit 1
fi

# Delete every staged .app under bundle/ — they are Spotlight-indexed
# otherwise (the source of the duplicate search hits).
rm -rf packages/desktop/src-tauri/target/release/bundle/macos/*.app

echo "installed: /Applications/PathBlender.app (staging apps removed)"
