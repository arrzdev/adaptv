# Testing adaptv across targets

adaptv ships one app to **six** runtime targets. A change to a shell/primitive/capability isn't
"done" until it behaves on all of them — they diverge exactly where the hard cross-platform bugs live
(safe-area, edge-to-edge, keyboard, gestures, splash, history/back).

## The six targets

| # | Target | How it renders | Iterate via |
|---|--------|----------------|-------------|
| 1 | **Desktop browser** | Chrome/Safari on the Mac | dev server, hot reload |
| 2 | **Mobile browser — iOS** | Safari in the iOS Simulator | dev server, hot reload |
| 3 | **Mobile browser — Android** | Chrome in the Android emulator | dev server, hot reload |
| 4 | **Standalone PWA — iOS** | Add-to-Home-Screen in the iOS sim | dev server (reinstall to re-cache) |
| 5 | **Standalone PWA — Android** | Add-to-Home-Screen in the emulator | dev server (reinstall to re-cache) |
| 6 | **Native — iOS (ipa) & Android (apk)** | Capacitor WebView | **rebuild** (`cap:ios` / `cap:android`) |

`app:` = installed (standalone **or** native) · `web:` = browser tab. Detect in JS with
`isNativePlatform()` / `isInstalledApp()` / `getOS()` from `@repo/adaptv/utils` — never `display-mode`.

## Web / standalone (targets 1–5): one dev server

```
pnpm dev                       # Vite on :7171 (see apps/frontend/ports.ts)
```

- **Desktop (1):** open `http://localhost:7171`.
- **iOS sim browser (2):** Safari in the sim → `http://localhost:7171` (the sim shares the host's localhost).
- **Android emulator browser (3):** the emulator's `localhost` is the *device*. Either browse
  `http://10.0.2.2:7171`, **or** map the port once: `adb reverse tcp:7171 tcp:7171` → then `localhost:7171` works.
- **Standalone (4/5):** in the sim/emulator browser, Add to Home Screen, launch the icon. A code change
  needs a reinstall only if the service worker cached the old shell (dev has no SW, so usually just reload).

Hot reload covers 1–5, so most iteration happens here.

## Native (target 6): rebuild required

No hot reload into an installed build — the bundle is on-device. Rebuild + redeploy:

```
# Android — needs ANDROID_HOME + JAVA_HOME (Android Studio's JBR works)
pnpm --filter @repo/frontend cap:android      # → Pixel emulator (emulator-5554)

# iOS — needs CocoaPods (`gem install cocoapods`) on PATH
pnpm --filter @repo/frontend cap:ios          # → iPhone simulator
```

Inspect the running native app:
- **Android:** `adb -s emulator-5554 exec-out screencap -p > shot.png`; focused app via `adb shell dumpsys window | grep mCurrentFocus`.
- **iOS:** `xcrun simctl io <UDID> screenshot shot.png`; `xcrun simctl launch <UDID> com.chopchop.app`.
- **Debug the WebView:** Android → `chrome://inspect`; iOS → Safari ▸ Develop ▸ Simulator.

See [`.claude/skills/stack/capacitor.md`](../../.claude/skills/stack/capacitor.md) for the version pins
(core **8.0.2**, iOS **CocoaPods** not SPM, geolocation **8.0.0**) and the `.ipa` recipe.

## What to check per target (the divergence checklist)

| Concern | Where it breaks |
|---------|-----------------|
| Safe-area / notch / home-indicator | standalone + native (env insets differ; `web:` tab has none) |
| Edge-to-edge (content under status/nav bar) | native only (StatusBar overlay); PWA can't |
| On-screen keyboard push / avoidance | native (`@capacitor/keyboard`) vs web (`visualViewport`) — **biggest divergence** |
| Splash | native shows custom; Android-PWA shows OS only; browser none |
| Back / history | native hardware-back + memory history vs browser back |
| Gestures (press, swipe, edge-swipe) | touch vs pointer vs native gesture |

## Definition of done for a adaptv change

1. Web-safe: `pnpm typecheck` · `pnpm biome:check` · web SSR build all green.
2. Verified on the target(s) the change touches — and its two *neighbours* (a fix for native keyboard
   must not regress the web `visualViewport` path).
3. Capability changes: confirmed the accessor's web fallback AND the native branch (behind `isNativePlatform()`).
