#!/usr/bin/env bash
set -euo pipefail
VERSION=$(node -p "require('./package.json').version")
DMG="packages/desktop/src-tauri/target/universal-apple-darwin/release/bundle/dmg/PathBlender_${VERSION}_universal.dmg"
MNT="$RUNNER_TEMP/candidate-mount"
INSTALL="$RUNNER_TEMP/candidate-apps"
mkdir -p "$INSTALL"
hdiutil attach -readonly -nobrowse -mountpoint "$MNT" "$DMG"
trap 'hdiutil detach "$MNT" >/dev/null 2>&1 || true' EXIT
ditto "$MNT/PathBlender.app" "$INSTALL/PathBlender.app"
APP="$INSTALL/PathBlender.app"
codesign --verify --deep --strict "$APP"
test "$(plutil -extract CFBundleShortVersionString raw "$APP/Contents/Info.plist")" = "$VERSION"
EXE=$(plutil -extract CFBundleExecutable raw "$APP/Contents/Info.plist")
lipo "$APP/Contents/MacOS/$EXE" -verify_arch arm64
lipo "$APP/Contents/MacOS/$EXE" -verify_arch x86_64
open "$APP"
sleep 20
pgrep -f "$APP/Contents/MacOS/$EXE" > /dev/null
screencapture -x "$PWD/candidate-macos.png"
pkill -f "$APP/Contents/MacOS/$EXE"
