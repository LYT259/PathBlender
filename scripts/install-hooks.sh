#!/bin/zsh
# (Re)install this repo's git hooks (needed after fresh clones — hooks live
# in .git and don't travel with the repo).
cd "$(dirname "$0")/.."
printf '#!/bin/zsh\nexec node "$(dirname "$0")/../../scripts/pre-push-check.mjs" "$@"\n' > .git/hooks/pre-push
chmod +x .git/hooks/pre-push
echo "pre-push hook installed"
