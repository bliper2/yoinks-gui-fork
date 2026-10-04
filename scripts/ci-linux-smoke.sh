#!/bin/bash
# CI only: installs the built Linux packages and proves the browser helper
# works from each one. Run from the project root after "npm run dist:linux".
#   .deb      installed under /opt/Yoinks
#   AppImage  run in place, mounted through FUSE like on a real desktop
set -euo pipefail

root="$PWD"
home="$(mktemp -d)"
trap 'rm -rf "$home"' EXIT

# Start the real app headless in a fresh home that has a Chrome profile folder,
# wait for it to write its launcher, then run that launcher like a browser would.
check() {
  local label="$1"; shift
  rm -rf "$home/.config" && mkdir -p "$home/.config/google-chrome"
  echo "== $label: starting the app"
  HOME="$home" XDG_CONFIG_HOME="$home/.config" xvfb-run -a "$@" --no-sandbox &
  local app=$!
  local manifest="$home/.config/google-chrome/NativeMessagingHosts/com.yoinks.host.json"
  for _ in $(seq 1 60); do [ -f "$manifest" ] && break; sleep 1; done
  if [ ! -f "$manifest" ]; then echo "$label: the app never registered the helper"; find "$home" -maxdepth 4 | head -60; ps aux | grep -i yoinks | head -5; kill "$app" 2>/dev/null || true; exit 1; fi
  cat "$manifest"
  local launcher
  launcher="$(node -p "require('$manifest').path")"
  cat "$launcher"
  HOME="$home" XDG_CONFIG_HOME="$home/.config" node "$root/scripts/smoke-host.js" "$launcher"
  kill "$app" 2>/dev/null || true
  wait "$app" 2>/dev/null || true
}

sudo apt-get install -y ./release/Yoinks-*-linux-amd64.deb
check "deb" /opt/Yoinks/yoinks

sudo apt-get install -y libfuse2t64
appimage="$(ls "$root"/release/Yoinks-*-linux-x86_64.AppImage)"
chmod +x "$appimage"
check "AppImage" "$appimage"
