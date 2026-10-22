#!/usr/bin/env bash
# new-worktree — create a dev worktree with cloned dependencies.
#
# Encodes the house ritual ("main tree stays parked on beta"): the main tree must
# stay parked on beta, so every change — features, fixes, docs, experiments —
# happens in its own worktree. This script creates it in one step:
#
#   scripts/new-worktree.sh <branch-name>          # base = origin/beta
#   scripts/new-worktree.sh --base <ref> <branch>  # explicit base
#   scripts/new-worktree.sh --no-deps <branch>     # skip dependency clone (docs-only)
#   scripts/new-worktree.sh --with-target <branch> # also clone src-tauri/target (~18G, cargo work only)
#
# The worktree lands under <repo-parent>/<repo-name>-worktrees/<short-name>,
# dependencies are cloned with APFS clonefile (`cp -Rc`, plain copy fallback),
# so setup takes seconds and costs almost no extra disk until files diverge.
set -euo pipefail

BASE_REF=""
NO_DEPS=false
WITH_TARGET=false
BRANCH=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --base)
      [[ $# -ge 2 ]] || { echo "error: --base needs a value" >&2; exit 1; }
      BASE_REF="$2"; shift 2 ;;
    --no-deps)    NO_DEPS=true; shift ;;
    --with-target) WITH_TARGET=true; shift ;;
    -h|--help)
      sed -n '2,17p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    -*)
      echo "error: unknown flag: $1" >&2; exit 1 ;;
    *)
      [[ -z "$BRANCH" ]] || { echo "error: unexpected extra argument: $1" >&2; exit 1; }
      BRANCH="$1"; shift ;;
  esac
done

[[ -n "$BRANCH" ]] || { echo "error: branch name required — usage: scripts/new-worktree.sh [--base <ref>] [--no-deps] <branch-name>" >&2; exit 1; }
[[ "$BRANCH" =~ ^[A-Za-z0-9._/-]+$ ]] || { echo "error: branch name looks invalid: $BRANCH" >&2; exit 1; }

# Resolve the MAIN repo root (owner of the shared .git), not the worktree the
# script happens to run from — worktrees always land beside the main tree.
GIT_COMMON_DIR="$(git rev-parse --path-format=absolute --git-common-dir)"
REPO_ROOT="$(dirname "$GIT_COMMON_DIR")"
git -C "$REPO_ROOT" show-ref --verify --quiet "refs/heads/$BRANCH" && {
  echo "error: branch already exists: $BRANCH" >&2; exit 1; }

if [[ -z "$BASE_REF" ]]; then
  if git -C "$REPO_ROOT" show-ref --verify --quiet refs/remotes/origin/beta; then
    BASE_REF="origin/beta"
  elif git -C "$REPO_ROOT" show-ref --verify --quiet refs/heads/beta; then
    BASE_REF="beta"
  else
    BASE_REF="HEAD"
  fi
fi
git -C "$REPO_ROOT" show-ref --verify --quiet "refs/remotes/$BASE_REF" || \
git -C "$REPO_ROOT" show-ref --verify --quiet "refs/heads/$BASE_REF" || \
[[ "$BASE_REF" == "HEAD" ]] || {
  echo "error: base ref not found: $BASE_REF" >&2; exit 1; }

# feat/foo-bar -> foo-bar, any remaining slashes -> dashes
SHORT_NAME="${BRANCH#*/}"
SHORT_NAME="${SHORT_NAME//\//-}"
WT_ROOT="$(dirname "$REPO_ROOT")/$(basename "$REPO_ROOT")-worktrees"
WT_DIR="$WT_ROOT/$SHORT_NAME"
[[ -e "$WT_DIR" ]] && { echo "error: path already exists: $WT_DIR" >&2; exit 1; }
mkdir -p "$WT_ROOT"

BASE_SHA="$(git -C "$REPO_ROOT" rev-parse --short "$BASE_REF")"
echo "Creating worktree for $BRANCH at $WT_DIR (base $BASE_REF @ $BASE_SHA)"
git -C "$REPO_ROOT" worktree add -b "$BRANCH" "$WT_DIR" "$BASE_REF"

if [[ "$NO_DEPS" == "true" ]]; then
  echo "Skipping dependency clone (--no-deps)."
else
  if [[ ! -d "$REPO_ROOT/node_modules" ]]; then
    echo "warning: main tree has no node_modules — run 'npm ci' there first, or re-run with --no-deps" >&2
  fi
  clone_dep() {
    local src="$1" dst="$2" label="$3"
    [[ -d "$src" ]] || { echo "  (no $label in main tree, skipping)"; return 0; }
    echo "  cloning $label ..."
    if ! cp -Rc "$src" "$dst" 2>/dev/null; then
      echo "  (cp -Rc unavailable, falling back to plain copy)" >&2
      cp -R "$src" "$dst"
    fi
  }
  clone_dep "$REPO_ROOT/node_modules" "$WT_DIR/node_modules" "node_modules (root)"
  for pkg_dir in "$REPO_ROOT"/packages/*/; do
    [[ -d "$pkg_dir/node_modules" ]] && \
      clone_dep "$pkg_dir/node_modules" "$WT_DIR/packages/$(basename "$pkg_dir")/node_modules" "node_modules ($(basename "$pkg_dir"))"
  done
  if [[ "$WITH_TARGET" == "true" ]]; then
    clone_dep "$REPO_ROOT/packages/desktop/src-tauri/target" "$WT_DIR/packages/desktop/src-tauri/target" "src-tauri/target (cargo)"
  else
    echo "  (skipping src-tauri/target — pass --with-target only for Rust work)"
  fi
fi

echo ""
echo "Worktree ready:"
echo "  cd $WT_DIR"
echo "Branch: $BRANCH  (base: $BASE_REF @ $BASE_SHA)"
echo "The main tree stays parked on beta — commit and work only inside this directory."

# Privacy-gate readiness (2026-10-22): hooks and the shared private rules
# live in the COMMON git dir, so this worktree inherits them automatically —
# but say so explicitly, and surface a NOT READY state instead of letting the
# first push discover it. Never fails the worktree creation itself.
if [[ -f "$WT_DIR/scripts/pre-push-check.mjs" ]]; then
  if ! (cd "$WT_DIR" && node scripts/pre-push-check.mjs --doctor); then
    echo "warning: privacy gate NOT READY in this worktree — follow the NOT READY lines above before pushing" >&2
  fi
fi
