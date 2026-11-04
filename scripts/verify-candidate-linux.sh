#!/usr/bin/env bash
set -euo pipefail
export GDK_BACKEND=x11 WEBKIT_DISABLE_COMPOSITING_MODE=1 LIBGL_ALWAYS_SOFTWARE=1 WEBKIT_DISABLE_DMABUF_RENDERER=1
B="$PWD/packages/desktop/src-tauri/target/release/bundle"
openbox > candidate-linux-openbox.log 2>&1 &
sleep 2
pgrep -x openbox > /dev/null
smoke() {
  local label="$1"; shift
  "$@" > "candidate-linux-$label.log" 2>&1 &
  sleep 15
  pgrep -f pathblender-desktop > /dev/null
  xdotool search --onlyvisible --name PathBlender > /dev/null
  import -window root "candidate-linux-$label.png"
  test "$(identify -format '%wx%h' "candidate-linux-$label.png")" = 1600x900
  read -r mean std < <(convert "candidate-linux-$label.png" -colorspace gray -format '%[fx:int(mean*255)] %[fx:int(standard_deviation*255)]\n' info:)
  test "$mean" -gt 1 && test "$std" -gt 1
  pkill -f pathblender-desktop
  sleep 3
}
# Fresh disposable runner: actually install the DEB and run the installed binary.
set -- "$B"/deb/*.deb
test "$#" -eq 1
PACKAGE=$(dpkg-deb -f "$1" Package)
sudo apt-get install -y "$1"
test -n "$(dpkg -L "$PACKAGE" | sed -n '/\/NOTICE.md$/p')"
smoke deb /usr/bin/pathblender-desktop
set -- "$B"/appimage/*.AppImage
test "$#" -eq 1
smoke appimage "$1" --appimage-extract-and-run
# RPM expands on Debian; no unsupported rpm installation into the host database.
mkdir -p "$RUNNER_TEMP/candidate-rpm"
set -- "$B"/rpm/*.rpm
test "$#" -eq 1
rpm2cpio "$1" > "$RUNNER_TEMP/candidate-rpm/payload.cpio" 2> candidate-linux-rpm-extract.log || true
test -s "$RUNNER_TEMP/candidate-rpm/payload.cpio"
(cd "$RUNNER_TEMP/candidate-rpm" && cpio -idm --quiet < payload.cpio)
test -f "$RUNNER_TEMP/candidate-rpm/usr/lib/PathBlender/NOTICE.md" || test -n "$(find "$RUNNER_TEMP/candidate-rpm" -name NOTICE.md -print -quit)"
smoke rpm "$RUNNER_TEMP/candidate-rpm/usr/bin/pathblender-desktop"
