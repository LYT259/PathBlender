#!/bin/zsh
# UDZO dmg via the sparse-image two-step.
#
# Since the app binary crossed ~60 MB (rendered field artwork embedded,
# 2026-10-02), the one-step `hdiutil create -srcfolder -format UDZO` began
# failing with a bogus "No space left on device" while accessing the staged
# binary — reproducible on the local machine AND GitHub's macos runner (30 GB
# and runner-scale disk actually free; the failure is in hdiutil's internal
# staging of large single files). The two-step flow (blank sparse image →
# ditto the app in → convert to UDZO) does not hit that path.
#
# Usage: scripts/make-dmg.sh <PathBlender.app> <output.dmg>
set -euo pipefail

APP="$1"
OUT="$2"
[[ -d "$APP" ]] || { echo "make-dmg: app not found: $APP" >&2; exit 1; }

STAGE="$(mktemp -d "${TMPDIR:-/tmp}/pb-dmg.XXXXXX")"
cleanup() {
  hdiutil detach "$STAGE/mnt" -force >/dev/null 2>&1 || true
  rm -rf "$STAGE"
}
trap cleanup EXIT

# Size the scratch volume from the app + 30 MB headroom, rounded to 10 MB.
SIZE_MB=$(( (($(du -sk "$APP" | cut -f1) + 30720 + 10239) / 10240) * 10 ))

hdiutil create -size "${SIZE_MB}m" -fs "HFS+" -volname PathBlender \
  -type SPARSE -ov "$STAGE/pb" >/dev/null
hdiutil attach "$STAGE/pb.sparseimage" -mountpoint "$STAGE/mnt" \
  -nobrowse -quiet
ditto "$APP" "$STAGE/mnt/PathBlender.app"
hdiutil detach "$STAGE/mnt" -quiet
rm -f "$OUT"
hdiutil convert "$STAGE/pb.sparseimage" -format UDZO -o "$OUT" -quiet
