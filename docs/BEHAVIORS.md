# adaptv — behaviors it fixes (and how to test them)

The cross-platform bugs adaptv already solves, **how** each is done (where in the code), and **how you
verify** it's working. Pairs with [`TESTING.md`](TESTING.md) (the six-target discipline) and
[`capacitor-internals.md`](capacitor-internals.md) (deep native details + version pins).

## The six targets

adaptv ships one codebase to six runtimes; the hard bugs live where they diverge.

| # | Target | What it is |
|---|--------|-----------|
| 1 | Desktop browser | Chrome/Safari on the Mac |
| 2 | Mobile browser — iOS | Safari in the iOS Simulator |
| 3 | Mobile browser — Android | Chrome in the emulator |
| 4 | Standalone PWA — iOS | Add-to-Home-Screen in the sim |
| 5 | Standalone PWA — Android | Add-to-Home-Screen / Install in the emulator |
| 6 | Native — iOS + Android | Capacitor WebView (`.ipa` / `.apk`) |

Rule of thumb: `app:` styles apply to **installed** (standalone **or** native); `web:` to a **browser tab**.

---

## Behavior catalogue

### 1. "Installed app?" is answered correctly everywhere
- **Problem:** a Capacitor WebView reports `display-mode: browser`, so any `display-mode: standalone`
  check silently takes the *web* branch on native (wrong safe-area, history, splash).
- **How:** `src/utils/platform.ts` — `isNativePlatform` / `isInstalledApp` / `getOS` off the Capacitor
  global (no import → web builds need nothing). A pre-paint script stamps
  `html[data-adaptv-platform="native|standalone|web"]` + `data-adaptv-os` before first frame.
- **Test:** on native (6), `document.documentElement.dataset.adaptvPlatform === "native"`. Safe-area /
  splash / memory-history branches all resolve to the installed path.

### 2. `app:` / `web:` style variants
- **Problem:** `@media (display-mode: …)` can't tell a native WebView from a browser tab.
- **How:** `src/styles/utils.css` — `app:` = standalone media query **OR** `data-adaptv-platform=native`;
  `web:` = `data-adaptv-platform=web` only (attribute-scoped, so native is excluded).
- **Test:** an element with `web:hidden app:block` is hidden in a tab (1–3), shown when installed (4–6).

### 3. Splash — installed-only, colour-driven, theme-aware, no double
- **Problem:** double-splash (OS splash + React splash showing the mascot twice), a splash that ignores
  the app's dark/light preference, a browser tab flashing a splash, Android 12 forcing a launcher icon.
- **How:**
  - Policy: React splash renders only when **installed**; a browser tab gets no splash unless
    `splashScreenInBrowser`. Gated by the critical-CSS splash gate keyed on the platform stamp.
  - The React splash **self-unmounts** (returns `null` when ready) — `RoutingShell` just mounts it.
  - **…except on a not-found, where `RoutingShell` retires it.** A not-found boundary (root, since
    `notFoundMode: "root"`) short-circuits the outlet, so no layout route mounts and the app's ready
    signal — which lives in one — can never fire. adaptv mounts the splash, so adaptv takes it down; the
    decision is latched, so navigating back out of a 404 doesn't replay it. → `DECISIONS.md` B28.
  - Native mask is **colour-driven**, not an image: Android launch theme + `colors.xml` /
    `colors-night.xml`; iOS `AdaptvSplash` colour asset + a solid launch storyboard. Mascot lives *only*
    in the React splash → appears once.
  - `splashMaskMode`: `preferences` (follows `useTheme`) / `system` / `light` / `dark`. For
    `preferences`, the CLI writes a per-app night override (Android `UiModeManager` in a adaptv-owned
    `MainActivity`; iOS `AppDelegate.overrideUserInterfaceStyle`) so the splash tracks the app theme, not
    the device — on the **next** launch (1-launch, no "open twice").
  - Android-12 system splash: transparent `windowSplashScreenAnimatedIcon` → flat colour, no icon.
  - Code: `bin/adaptv.mjs` (`patchAndroidSplash` / `patchIosTheme` / `resolveSplashMask`),
    `src/capabilities/splash.ts`, `src/capabilities/native-theme.ts`, `src/shell/critical-css.ts`.
- **Test:** cold-start installed (4–6): solid mask colour → React splash fades the mascot in on the same
  colour → app (mascot once). Toggle the app to dark on a light device → the mask is dark next launch,
  and vice-versa. Browser tab (1–3): page loads instantly, no splash. (iOS storyboard's *first* pre-app
  frame follows the device for adaptive masks — a single-frame OS limit; a fixed mask has no such frame.)
  Cold-start installed straight into a URL that does not exist: the 404 is up and **tappable**, with no
  `[data-adaptv-splash]` left in the DOM (query the count, not visibility — on web a leftover splash is
  `display: none` and still covering).

### 4. Keyboard avoidance + hybrid drawer (the autofocus race)
- **Problem:** opening a drawer with an `autoFocus` field — the async `Keyboard.addListener` lost the
  race against the field's immediate `keyboardWillShow`, so the sheet stayed stuck behind the keyboard.
- **How:** `src/capabilities/keyboard.ts` — `initNativeKeyboard()` attaches the OS listeners **eagerly at
  app start** (in the shell), and `subscribeNativeKeyboard` delivers the current state synchronously.
  `useKeyboard` skips the whole `visualViewport` heuristic on native and uses the exact OS height.
- **Test:** native (6, or the iOS sim with the software keyboard on / Android emulator with
  `hw.keyboard=no`): open a drawer whose input is `autoFocus` — the whole sheet lifts above the keyboard
  immediately, no double-shift, dismisses on scroll. Retest the web `visualViewport` path (2/4) after any
  keyboard change.

### 5. Edge-to-edge + status bar
- **Problem:** content should draw under the status bar with safe-area padding; native only.
- **How:** always edge-to-edge (opinionated) — `StatusBar.overlaysWebView: true` in the generated
  Capacitor config; the shell's safe-area utilities pad it back. `useStatusBar` drives style/background
  from the theme on native (no-op on web).
- **Test:** native (6): content under the status bar, tint matches theme, header clears the inset.

### 6. Safe-area rendering
- **Problem (Android):** `env(safe-area-inset-top)` is `0` on an installed Android PWA, so a
  `max(2rem, …)` floor forced a fade band over the header. **Also:** safe-area padding utilities lost
  tailwind-merge conflict resolution.
- **How:** `src/components/scroll-view.tsx` — the top fade band tracks the inset (`+0.5rem`), so it's a
  soft ~8px edge on Android and unchanged on iOS. `src/utils/cn.ts` registers `p-safe`/`pb-safe`/… into
  tailwind-merge's padding groups so `View safe="bottom"` beats a stray `pb-0`.
- **Test:** installed Android (5/6): the top fade sits under the status-bar strip, never over the title.
  `<View safe="bottom" className="pb-0">` keeps the safe padding. *(Shipped to chopchop in PR #91.)*

### 7. Haptics — two surfaces, because iOS web forces it
- **How:** *imperative* — `src/capabilities/haptics.ts`: native engine (`@capacitor/haptics`) on
  Capacitor, `navigator.vibrate` on Android/Chrome web. **A documented no-op on iOS web.**
  *Declarative* — `src/capabilities/haptic-tick.ts` + `useHapticTick`: mounts an invisible, full-size
  `<input type="checkbox" switch>` on a tap target so the user's **real finger** fires the system tick.
  `Button haptic={…}` routes through both, so it works on all six targets; `useVibrate` gives the
  semantic aliases over the imperative API.
- **Why two:** iOS Safari has no `navigator.vibrate` and never will (WebKit's standards position on the
  Vibration API is formally `oppose`). Its one route to the Taptic Engine is the switch tick — and
  **Apple patched programmatic `.click()` in iOS 26.5**, so it now requires an actual touch. You cannot
  synthesise a finger, so no imperative call can reach it. The mechanism is inherently declarative.
  → `DECISIONS.md` B10.
- **Limits on iOS web:** system tick only — no weights, no notification patterns, no intensity.
  Requires System Haptics enabled (undetectable). Costs one DOM node per tap target.
- **Test:** tap a `haptic` button — a tactile tick on device. **Physical hardware only**; simulators
  produce no haptics, and the iOS-web path specifically needs iOS ≥ 26.5 to be a meaningful test.

### 8. External links
- **How:** `src/components/link.tsx` routes `isExternalUrl(to)` to `ExternalLink` → system browser
  (`@capacitor/browser`) on native, a new tab on web. Internal routes keep the gesture/smart-back path.
- **Test:** a `<Link to="https://…">` opens the in-app system browser on native (6), a new tab on web.

### 9. Network status
- **How:** `src/capabilities/network.ts` — `@capacitor/network` (accurate) on native, `navigator.onLine`
  + online/offline events on web. `useNetworkStatus` reads it via `useSyncExternalStore`.
- **Test:** airplane-mode toggles the value; native reflects real reachability, web the coarse signal.

### 10. Memory history when installed
- **Problem:** the OS edge-swipe-back / hardware-back needs a browser-history entry to navigate; when
  installed there is none, so it must be inert and the app owns back.
- **How:** `src/shell/standalone-history.ts` — `standaloneMemoryHistory()` returns in-memory history when
  `isInstalledApp()` (standalone **or** native), else `undefined` (browser keeps its history).
- **Test:** installed (4–6): edge-swipe/hardware-back doesn't escape the app; in-app nav is app-controlled.
  Android hardware back navigates and exits at the root.

### 11. Web manifest — install & launch chrome
- **How:** `src/vite/manifest.ts` — `theme_color` matches the light background (no dark strip on a light
  launch splash); `android-maskable-*` icons emit `purpose: "maskable"` so the adaptive icon + generated
  splash have no white matte box.
- **Test:** install on Android (5): home-screen icon fills its shape (no white box), the launch chrome
  isn't a dark strip. *(Shipped to chopchop in PR #91.)*

### 12. Primitives — `View` / `List`
- **How:** `src/components/view.tsx` (row/center/fill/safe layout, identical everywhere),
  `src/components/list.tsx` (virtualized long lists).
- **Test:** `View` lays out identically on 1–6; `List` scrolls a long dataset smoothly on device.

---

## Status of this doc's items

All of §1–12 are **transported and green** — verified on both simulators during the chopchop session,
and the seed passes the full gate (`typecheck` 0, `test` 180/180, `biome` 0). What's *not* yet built is
tracked in the [README §status](../README.md#status--whats-done-vs-not) and [RESEARCH.md](RESEARCH.md).

## Automated gate

```bash
pnpm typecheck && pnpm biome:check && pnpm test
```
