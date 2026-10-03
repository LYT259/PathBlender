#!/bin/zsh
# (Re)install this repo's git hooks (needed after fresh clones — hooks live
# in .git and don't travel with the repo). Worktree-safe (2026-10-02
# acceptance finding): in a worktree `.git` is a FILE pointing at the shared
# git dir, so writing `.git/hooks/...` failed while the script still printed
# "installed" and exited 0. Resolve the real hooks dir through git, resolve
# nothing by hardcoded paths, and let any failure stop the script.
set -euo pipefail
cd "$(dirname "$0")/.."
HOOKS_DIR="$(git rev-parse --git-path hooks)"
mkdir -p "$HOOKS_DIR"
# The hook resolves pre-push-check.mjs from the pushing worktree's root at
# RUN time (git runs hooks with cwd = the working-tree root), so one shared
# hook serves every worktree with that worktree's own scripts.
printf '#!/bin/zsh\nexec node "$PWD/scripts/pre-push-check.mjs" "$@"\n' > "$HOOKS_DIR/pre-push"
chmod +x "$HOOKS_DIR/pre-push"
echo "pre-push hook installed: $HOOKS_DIR/pre-push"
