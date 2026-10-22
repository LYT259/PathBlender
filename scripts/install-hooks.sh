#!/bin/zsh
# (Re)install this repo's git hooks (needed after fresh clones — hooks live
# in .git and don't travel with the repo). Worktree-safe (2026-10-02
# acceptance finding): in a worktree `.git` is a FILE pointing at the shared
# git dir, so writing `.git/hooks/...` failed while the script still printed
# "installed" and exited 0. Resolve the real hooks dir through git, resolve
# nothing by hardcoded paths, and let any failure stop the script.
#
# 2026-10-22: the hook now resolves the MAIN tree's pre-push-check.mjs, so
# every worktree of this repository runs the same gate version and the same
# SHARED private rules (in the common git dir, installed/migrated by
# --install-rules below) instead of each worktree's own copies — the
# readme-support-entry worktree shipped without .pre-push-patterns once and
# its pushes silently ran with public rules only. The script ends with a
# readiness check (--doctor): exit 0 = READY, exit 1 = NOT READY (e.g. the
# fresh skeleton still needs [forbidden]/[self-emails] filled in by hand).
set -euo pipefail
cd "$(dirname "$0")/.."
HOOKS_DIR="$(git rev-parse --git-path hooks)"
mkdir -p "$HOOKS_DIR"
cat > "$HOOKS_DIR/pre-push" <<'EOF'
#!/bin/zsh
# PathBlender pre-push privacy gate — installed by scripts/install-hooks.sh.
# Runs the MAIN tree's checker so every worktree of this repository gets the
# same gate version and the same shared private rules; falls back to the
# pushing tree's own copy (older checkouts); refuses the push when neither
# exists — never a silent pass.
common="$(git rev-parse --git-common-dir)" || exit 2
case "$common" in
  /*) ;;
  *) common="$PWD/$common" ;;
esac
main="${common:h}"
for s in "$main/scripts/pre-push-check.mjs" "$PWD/scripts/pre-push-check.mjs"; do
  if [ -f "$s" ]; then exec node "$s" "$@"; fi
done
echo "pre-push: PathBlender privacy checker not found (main tree or this worktree) — push refused" >&2
exit 2
EOF
chmod +x "$HOOKS_DIR/pre-push"
echo "pre-push hook installed: $HOOKS_DIR/pre-push"
node scripts/pre-push-check.mjs --install-rules
exec node scripts/pre-push-check.mjs --doctor
