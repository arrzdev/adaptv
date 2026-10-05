#!/usr/bin/env bash
# The android smoke: launch, navigate, keyboard, back, on the booted emulator.
#
#   bash .github/android-smoke/smoke.sh <apk> <app-id> <out-dir>
#
# Every step leaves a screenshot and the UI tree it read in <out-dir>, pass or fail, so a
# red run shows what the screen looked like. Elements are found by their text in
# `uiautomator dump`: the WebView exposes its accessibility tree there, so a tap lands on
# the real element without knowing the layout.
set -euo pipefail

APK="$1"
APP_ID="$2"
OUT="$3"
mkdir -p "$OUT"
step=0

shot() {
  step=$((step + 1))
  adb exec-out screencap -p >"$OUT/$(printf '%02d' "$step")-$1.png"
}

dump() {
  adb shell uiautomator dump /sdcard/ui.xml >/dev/null
  adb shell cat /sdcard/ui.xml >"$OUT/ui.xml"
}

fail() {
  echo "::error::android smoke: $1"
  shot "fail" || true
  cp "$OUT/ui.xml" "$OUT/fail-ui.xml" 2>/dev/null || true
  adb shell dumpsys input_method >"$OUT/fail-input-method.txt" 2>&1 || true
  exit 1
}

# A freshly booted CI emulator often raises "System UI isn't responding" over everything;
# it is the emulator, not the app, so the smoke waits it out instead of failing on it.
dismiss_anr() {
  grep -qF "t responding" "$OUT/ui.xml" 2>/dev/null || return 1
  echo "dismissing a system ANR dialog"
  tap_on "Wait"
  sleep 2
}

# wait_for <text> [seconds]: until a node carries <text>
wait_for() {
  local deadline=$((SECONDS + ${2:-60}))
  while ((SECONDS < deadline)); do
    dump || true
    grep -qF "$1" "$OUT/ui.xml" 2>/dev/null && return 0
    dismiss_anr || sleep 2
  done
  fail "\"$1\" never appeared on screen"
}

# tap_on <text>: tap the centre of the first node whose text, content-desc or
# resource-id contains <text>
tap_on() {
  dump || fail "uiautomator dump failed"
  local xy
  xy="$(node -e '
    const xml = require("node:fs").readFileSync(process.argv[1], "utf8")
    const needle = process.argv[2]
    for (const node of xml.match(/<node [^>]*>/g) ?? []) {
      const attr = (k) => node.match(new RegExp(` ${k}="([^"]*)"`))?.[1] ?? ""
      if (![attr("text"), attr("content-desc"), attr("resource-id")].some((v) => v.includes(needle))) continue
      const [x1, y1, x2, y2] = attr("bounds").match(/\d+/g).map(Number)
      console.log(`${(x1 + x2) >> 1} ${(y1 + y2) >> 1}`)
      process.exit(0)
    }
    process.exit(1)
  ' "$OUT/ui.xml" "$1")" || fail "no node with \"$1\" to tap"
  # shellcheck disable=SC2086
  adb shell input tap $xy
}

keyboard_shown() {
  adb shell dumpsys input_method | grep -qE 'mInputShown=true|isInputViewShown=true'
}

in_foreground() {
  adb shell dumpsys activity activities | grep -E 'mResumedActivity|topResumedActivity' | grep -qF "$APP_ID/"
}

# A hardware keyboard would keep the soft one hidden; the smoke is about the soft one.
adb shell settings put secure show_ime_with_hard_keyboard 1

echo "install $APK"
adb install -r "$APK"

echo "launch"
adb shell monkey -p "$APP_ID" -c android.intent.category.LAUNCHER 1 >/dev/null
wait_for "smoke home" 120
in_foreground || fail "the app is not in the foreground after launch"
shot "launch"

echo "navigate"
tap_on "open form"
wait_for "smoke form"
shot "navigate"

echo "keyboard"
tap_on "smoke-input"
deadline=$((SECONDS + 20))
until keyboard_shown; do
  ((SECONDS < deadline)) || fail "the soft keyboard did not open on the input"
  sleep 1
done
adb shell input text adaptv
wait_for "echo:adaptv" 20
shot "keyboard"

echo "back"
# The first back closes the keyboard, the second goes back a route inside the app.
adb shell input keyevent KEYCODE_BACK
sleep 2
if keyboard_shown; then fail "back did not close the soft keyboard"; fi
adb shell input keyevent KEYCODE_BACK
wait_for "smoke home" 20
in_foreground || fail "back left the app instead of going back a route"
shot "back"

echo "android smoke passed"
