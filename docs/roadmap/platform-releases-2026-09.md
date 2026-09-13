# adaptv — platform releases, September 2026

> What Safari 27 / iOS 27, the iOS 26.1–26.6 point releases, Chrome and Android WebView 150–154,
> Android 16 QPR2 and Android 17 (API 37) mean for adaptv, **counting only what `docs/` did not already
> say**. Assembled 2026-09-13 from the primary release notes linked on every row, and read against
> `origin/main` 9f11f0d. Capacitor 8.5.0–8.5.2 is included because two of the platform changes reach
> adaptv through it.
>
> It is a roadmap file because the four rows in §0 are unbuilt work. Everything else is either a
> "no action, because …" record, kept so the question is not re-opened, or a pointer to a correction
> this change made in another doc. When §0 ships, move §2.2, §3.2, §4, §5 and §7 to
> `research/platform-releases-2026-09.md` and delete this file.

**What this machine can test.**
- Xcode 26.1.1, with iOS 16.2, 18.0 and 26.1 simulator runtimes.
- Playwright 1.61.1: Chromium 149.0.7827.55, and a macOS WebKit build (CFBundleVersion 625.1.21) on the
  same 625.1 line as Safari 27.0 (20625.1.29). Its `chromium-tip-of-tree` 151.0.7886.0 is not
  installed by default.

So Chrome 150+ is not installed here, no iOS 26.2+ simulator runtime is installed, and the local WebKit
is a desktop build with no iOS scrolling. iOS 27 needs a simulator runtime that is not installed.
"Unconfirmed" below means read in a source but not measured.

---

## 0. The work

| # | Item | Trigger | Size | Testable where |
|---|---|---|---|---|
| 1 | **Android: Capacitor 8.5.2 moves `SystemBars`' inset listener, which breaks both of adaptv's inset workarounds** (§1.1) | the bump to Capacitor ≥ 8.5.2, which #2 forces | small | Android emulator: API 28 (WebView < 140) for the listener and bars, API 37 for the probe |
| 2 | **iOS: the UIScene template turns `patchIosTheme`'s AppDelegate line into a silent no-op** (§1.2) | the first build with the Xcode 27 / iOS 27 SDK: on the pinned 8.4.3 that app **does not launch** (TN3187), so the bump to ≥ 8.5.2 must land first | small | iOS 26.1 simulator (UIScene works on iOS 13+) |
| 3 | **Physical-Android dev loop fails at target 37** (§2.1) | raising `ANDROID_SDK_LEVELS.target` to 37 | small–medium | hardware: a physical phone on Android 17 |
| 4 | **Check scroll anchoring against adaptv's own keyboard scrolls, and route navigation, on iOS 27** (§3.1, §3.2) | Safari 27 / iOS 27, dated 2026-09-14 | small | iOS 27 simulator runtime (not installed) or an iPhone on iOS 27. A partial local check is possible in the Playwright `webkit` project, which likely has anchoring on but has no iOS momentum |

---

## 1. Capacitor 8.5

adaptv pins 8.4.3 (`package.json:87`, `:90`, `:92`, `:96`). Two releases matter:
- [8.5.0](https://github.com/ionic-team/capacitor/releases/tag/8.5.0) (2026-07-31) adds UIScene.
- [8.5.2](https://github.com/ionic-team/capacitor/releases/tag/8.5.2) (2026-09-11) rewrites Android
  `SystemBars`.

### ⚠︎ 1.1 `SystemBars` 8.5.2: the listener moves to the decor view, and the JS probe hook is gone

Source: the diff of [capacitor#8535](https://github.com/ionic-team/capacitor/pull/8535), merged
2026-09-10. It closes capacitor-keyboard [#61](https://github.com/ionic-team/capacitor-keyboard/issues/61)
and [#68](https://github.com/ionic-team/capacitor-keyboard/issues/68), plus #46 and #28.

**What changes in the plugin.**
- `addJavascriptInterface(this, "CapacitorSystemBarsAndroidInterface")`, `onDOMReady()` and the
  `DOMContentLoaded` call in `native-bridge.ts` are deleted.
- `viewport-fit=cover` is now re-read on every `onPageCommitVisible`.
- The new `initialViewportFitValueHint` sets the value used before that first read.
- `setOnApplyWindowInsetsListener` moves from the WebView's **parent** to
  `getWindow().getDecorView()`.
- `insetsHandling` gains `"native"`, which injects no CSS variables. The docs say Capacitor 9
  will make it the default.

**What breaks in adaptv. Both points are read from the diff; neither has been built.**

1. **The old-WebView inset override stops replacing the plugin's listener.**
   - The generated `MainActivity` installs its own listener on WebView < 140 (`bin/lib/native.mjs:320-346`).
     The comment at `:313-317` explains how it avoids the #61/#68 collision: a View holds exactly one
     listener, so installing on the **same parent view** replaces the plugin's.
   - In 8.5.2 the plugin's listener is on the decor view, so both listeners run. The decor view is
     dispatched first. On < 140 the plugin takes its fallback branch:
     - it pads the decor view by the system bars, and by the IME height while the keyboard is up
       (8.4.3 did this only on API 35+);
     - it passes zeroed bar insets down to adaptv's listener.
   - The result on WebView 119–139, the B21 floor: the app is no longer edge-to-edge,
     `--safe-area-inset-*` are all `0`, and the view shrinks for the keyboard. That shrink is the
     double lift the comment at `:329-337` exists to prevent.
   - **Do:** install adaptv's listener on `getWindow().getDecorView()` (`:323`, `:326`), so it replaces
     the plugin's listener again. Keep it a `ViewCompat.setOnApplyWindowInsetsListener`: Keyboard
     8.0.5's `WindowInsetsAnimationCompat` callback sits on the decor (root) view (`Keyboard.java:59`, `:76`),
     and androidx drives that callback through the view's listener below API 30. This comes from
     reading androidx, not from a measurement, so check the bars and the keyboard on an API 28
     emulator.

2. **The boot re-probe becomes a no-op.**
   - `androidSystemBarsBridge()` returns `null` once the global is gone (`src/capabilities/status-bar.ts:46-53`).
     So `reprobeAndroidInsets` and `watchAndroidInsets` (`:75-83`, `:114-123`) do nothing.
   - The tests stub the deleted global (`src/capabilities/status-bar.test.ts:94-148`), so they stay green.
   - The first race in [`native-shell-plugin.md §0.1`](native-shell-plugin.md) is a probe that reads
     "no cover" before the head settles. Whether it still happens now depends on whether
     `onPageCommitVisible` fires before or after the router replaces `src/shell/head.ts:6` over the
     static tag in `src/vite/app-shell.ts:87`. That is **unconfirmed**. If it loses, JS has no way
     left to re-trigger the probe.
   - The second race is a reconcile that wipes the injected properties.
     - On WebView ≥ 140 with cover it stops mattering: wiped properties fall back to `env()`
       (`src/styles/safe-area.css:47`), which is correct there.
     - Below 140 it still matters. After point 1's fix, adaptv's own listener injects the only real
       values, and `env()` is wrong there. Today the watch recovers them by calling `onDOMReady()`,
       which requests a new inset pass. 8.5.2 leaves JS no way to request one.
   - **Do:**
     - Add `initialViewportFitValueHint: "cover"` next to `insetsHandling`
       (`src/vite/capacitor-config.ts:185`).
     - Change the watch to remember the last `--safe-area-inset-*` values it saw and write them back
       when a reconcile removes them. That needs no bridge.
     - Replace the stubbed-global tests.
     - Re-run the §0.1 measurement: Pixel emulator API 37, `adaptv preview android`, `innerHeight`
       against 923, and `--safe-area-inset-top`.
     - If the first race still loses, the fix is to keep the viewport tag in place during boot; no
       probe is left to call.

**No action on `insetsHandling`, because `"css"` is still the only correct mode.** `"native"` injects
nothing. The var-first contract needs the injected values below WebView 140, and adaptv's floor is 119
(register B21). adaptv sets the value explicitly (`src/vite/capacitor-config.ts:185`), so Capacitor 9's
change of default does not reach it.

### ⚠︎ 1.2 UIScene: required with the iOS 27 SDK, and `patchIosTheme` targets the old lifecycle

**The platform requirement.** Apple's
[TN3187](https://developer.apple.com/documentation/technotes/tn3187-migrating-to-the-uikit-scene-based-life-cycle)
says that from the major release after iOS 26, an app built with the latest SDK must adopt the UIScene
lifecycle or it will not launch. So the forcing event is the **first build with the Xcode 27 / iOS 27
SDK**, not the bump. On the pinned 8.4.3 that build fails to launch, which is worse than any no-op
below.

**What Capacitor ships.**
- [capacitor#8536](https://github.com/ionic-team/capacitor/pull/8536), in 8.5.0, describes UIScene as
  "required in iOS 27". Its templates:
  - add `SceneDelegate.swift`, which creates the `UIWindow` in `scene(_:willConnectTo:options:)`;
  - add a `UIApplicationSceneManifest` to `Info.plist`;
  - give `AppDelegate` a `configurationForConnecting` method.
- The CocoaPods template, which adaptv forces (`bin/lib/native.mjs:940-943`), only **appends** to
  `AppDelegate.swift`. So the `// Override point for customization after application launch.` marker
  and `var window: UIWindow?` are both still there.
- [capacitor#8544](https://github.com/ionic-team/capacitor/pull/8544) adds a migrator for existing
  projects.

**What breaks in adaptv. This is inferred from the template diff; it has not been built.**
- `patchIosTheme` inserts `window?.overrideUserInterfaceStyle = …` after that marker
  (`bin/lib/native.mjs:624-640`). `follow: "preferences"` is the default (`:194`, `:198`).
- Under UIScene the window belongs to `SceneDelegate`, so `AppDelegate.window` is `nil`. The line still
  compiles and does nothing. The launch UI stops following the persisted app theme, and nothing fails.

**Do, in the same change as the bump.** Bump to ≥ 8.5.2, not 8.5.0: 8.5.2 carries
[#8595](https://github.com/ionic-team/capacitor/issues/8595), which stops forwarding scene lifecycle
events to the page before it has loaded.
- Write the override into `SceneDelegate.swift` right after `makeKeyAndVisible()`.
- Remove the AppDelegate insert.
- Add `App/App/SceneDelegate.swift` to `ASSET_OUTPUTS.ios` (`bin/lib/native.mjs:668-673`) so the
  outputs guard repairs it.
- To verify on the iOS 26.1 simulator: set the app theme to dark with the system in light, then
  cold-launch.

When App Store Connect starts *requiring* the iOS 27 SDK is not in any source read here, so the
deadline is **unconfirmed**.

---

## 2. Android 17 (API 37) and Android 16 QPR2

### ⚠︎ 2.1 Local network permission: physical-device `--host` dev fails at target 37

**The platform change.**
[Behavior changes: Android 17](https://developer.android.com/about/versions/17/behavior-changes-17)
and the [local network permission guide](https://developer.android.com/privacy-and-security/local-network-permission)
say:
- Apps that target 37 need the runtime permission `ACCESS_LOCAL_NETWORK` (in the `NEARBY_DEVICES`
  group) for any LAN connection.
- WebView traffic inherits the host app's permission state.
- A blocked TCP connection usually fails with a timeout.
- Apps that target 36 or lower keep implicit access.

**Mapping to adaptv.**
- adaptv targets 36 (`src/native/android-sdk.ts:21`), so nothing breaks today.
- At 37, `--host` on a physical Android device breaks:
  - it points `server.url` at the LAN IP (`bin/adaptv.mjs:943`, `:952-954`);
  - it skips `adb reverse` in external mode (`:1015-1018`).
- The dev app never requests the permission, so its WebView times out on the dev server. The offline
  page would then report a network problem that is really a permission problem.
- The emulator path is unaffected. It loads `localhost` through `adb reverse`, which is loopback, not a
  LAN address. The guide lists no loopback rule, so that part is **unconfirmed**.

**Do, when the target goes to 37:** build step 5 of the design in
[`../decisions/positioning.md §2`](../decisions/positioning.md). It was written but never implemented:
on a physical Android device, prefer `adb reverse` over USB or adb-Wi-Fi, and use the LAN IP only when
there is no adb route. Two limits apply:
- `server.url` is one value shared by every attached platform (`bin/adaptv.mjs:907-908`). A run that
  also has a physical iPhone stays on the LAN IP for Android too. That case still needs the permission
  requested at runtime, or a refusal up front that names the permission.
- The `adb reverse` route rests on loopback being exempt, which is **unconfirmed** above.

**Testable:** hardware only. The failure only happens on a physical device, and external mode rejects
the emulator (`bin/adaptv.mjs:923-936`).

### 2.2 Checked, no action

| Change | Source | adaptv | Why no action |
|---|---|---|---|
| **Predictive back** is on by default at target 36 (Android 16), and `KEYCODE_BACK` is no longer dispatched | [behavior-changes-16](https://developer.android.com/about/versions/16/behavior-changes-16) | `src/hooks/use-android-back-button.ts:51` listens to `App` `backButton` | `@capacitor/app` registers an androidx `OnBackPressedCallback` ([`AppPlugin.java:50-66`](https://github.com/ionic-team/capacitor-plugins/blob/%40capacitor/app%408.1.0/app/android/src/main/java/com/capacitorjs/plugins/app/AppPlugin.java), tag `@capacitor/app@8.1.0`), and androidx delivers it through the new dispatcher rather than `onBackPressed`. **Unconfirmed** on an API 36 or 37 emulator in this pass. |
| At target 37, large screens (sw ≥ 600dp) **lose the opt-out** from ignored orientation and resizability | [ff-restrictions-ignored](https://developer.android.com/about/versions/17/changes/ff-restrictions-ignored) | `src/capabilities/orientation.ts:219-223` | adaptv never opted out (no `PROPERTY_COMPAT_ALLOW_RESTRICTED_RESIZABILITY` in `bin/`). The ignored lock has applied since target 36 and is already documented at that line. |
| A **`usesCleartextTraffic` deprecation** is planned | [behavior-changes-all](https://developer.android.com/about/versions/17/behavior-changes-all) | `bin/lib/live-reload.mjs:55` (`cleartext: true`, dev only) | It is "in a future release", with no version named. Migrate to a network security config (minSdk 24 supports it) when a version is announced. |
| **Android 16 QPR2** (minor SDK 36.1) | [16/qpr2](https://developer.android.com/about/versions/16/qpr2), [16/features](https://developer.android.com/about/versions/16/features) | none | The features page says the minor release does not change target API level requirements. `/16/qpr2/behavior-changes` returns 404, so no QPR2 behaviour list could be read. **Unconfirmed.** |

---

## 3. Safari 27 / iOS 27

Source: [Safari 27 release notes](https://developer.apple.com/documentation/safari-release-notes/safari-27-release-notes),
dated 2026-09-14 (27.0, 20625.1.29). The engine is shared by Safari and WKWebView, so native iOS gets
every row below on iOS 27.

### ⚠︎ 3.1 Scroll anchoring is enabled

**The change.** Scroll anchoring is enabled (171840378), with seven related fixes in the same notes (170889205,
171221075, 173456210, 173885027, 175195943, 178255628, 183145868).
WebKit history:
- [7bf2f19](https://github.com/WebKit/WebKit/commit/7bf2f197889c): "Anchoring adjustments stop momentum
  scrolls", fixed 2026-02-11.
- [08e8584](https://github.com/WebKit/WebKit/commit/08e8584f2a99): "Scroll anchoring in overflow scroll
  double-adjusts", fixed 2026-02-13.
- [3727113](https://github.com/WebKit/WebKit/commit/3727113a63a7): flipped back to `stable`, 2026-03-27.

**What it touches in adaptv.** The [spec](https://drafts.csswg.org/css-scroll-anchoring/) picks the
focused editable element as a priority anchor. adaptv scrolls exactly that element itself when the
keyboard moves:
- `src/components/drawer/drawer-keyboard.ts:224`;
- `src/components/avoid-keyboard/use-keyboard-avoidance.ts:198`.

The drawer lab's scroll-anchoring scenario ([`../design/behaviors.md:121`](../design/behaviors.md),
`:126`) does **not** test this. It sets `scroller.scrollTop` directly under a mock keyboard
(`playground/apps/frontend/src/routing/pages/lab/drawer-keyboard.page.tsx:808-867`), so there is no
focused editable and no fling. Chromium has anchored since 56, which is why nothing is expected to
break. WebKit is a separate implementation, though, and its double-adjust fix landed only this year.

**Do:** on iOS 27, open a drawer with a scroller and focus an input inside it so a real keyboard rises.
Fling the scroller, dismiss the keyboard mid-fling, and check that the focused row does not jump. In the
same run, navigate between routes in the native iOS app (§3.2 `pushState` row). Record the verdict in
`design/behaviors.md`.

**No action on `List` itself, because nothing in it drives anchoring.**
- Rows have a fixed estimated size and no `measureElement` (`src/components/list.tsx:80-85`), so the
  virtualizer never corrects `scrollTop`.
- Its moving rows change `transform` (`:129`), which suppresses an anchoring adjustment.
- There is no `overflow-anchor` anywhere in `src/`.

**Likely, not measured:** Playwright's WebKit (625.1.21) is on the same 625.1 line as Safari 27.0 and
was built after anchoring went `stable` on 2026-03-27, so the local `webkit` project likely has
anchoring on. `CSS.supports('overflow-anchor', 'auto')` there is a partial local check only, because a
desktop build has no iOS momentum or keyboard. It was not run.

### 3.2 Checked, no action

| Change | adaptv | Why no action |
|---|---|---|
| **`scrollTo` during a momentum scroll** no longer interrupts it (41949531) | `src/components/wheel-column.tsx:185`, `:201`, `:245`; `src/hooks/use-freeze-viewport.ts:193`, `:209`, `:233` | No call site scrolls during momentum. In the wheel, `:182` skips while scrolling, `:223`/`:239` wait 120ms after the last scroll event, and a row tap starts with a touch, which already stopped the fling. The `window.scrollTo` pins act on a document that never scrolls (`src/shell/shell-layout.tsx:41`, `:44`: `h-dvh overflow-hidden touch-none`). |
| **Service Worker static routing** (`InstallEvent.addRoutes`, 157951894). Chrome has had it since [123](https://developer.chrome.com/blog/service-worker-static-routing). | `src/sw/sw.static-assets.ts:21`, `src/sw/sw.cache-route.ts:74` | A `network` rule for an API path would bypass an app's own `serviceWorkers` `cacheRoute` handler. A `cache` rule for hashed assets only saves worker start-up on requests made while the worker is already awake. Workbox 7.4.1 has no API for it ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/InstallEvent/addRoutes)). Revisit only with a measurement. |
| **Registrations whose main or imported script is missing are unregistered** (174755909; 26.6: 175522651, 175522816) | `src/vite/sw-build.ts:99-104` | adaptv ships one IIFE `sw.js` with no `importScripts`. Losing a registration whose script 404s is what adaptv wants anyway. |
| **`<input type=checkbox switch>` honours appearance properties** like other controls (173487610) | `src/utils/install-vibrate-polyfill.ts:77-89` | The polyfill never sets `appearance`: it keeps the native switch and hides the label with `display: none`. Whether the tick still fires on iOS 27 is a hardware check, now in row 1 of [`owed-device-verification.md`](owed-device-verification.md). |
| **`preventDefault()` on `pointerdown` now suppresses `mousedown`/`mouseup`** on iOS (174864309) | `src/hooks/use-click-fix.ts:92-97` | adaptv never prevents `pointerdown`, and `src/` has no mouse listeners. |
| **A regression that broke `pushState` with custom URL schemes is fixed** (177547157) | `src/shell/create-adaptv-router.ts:46-48` | Memory history is opt-in (`memoryHistoryInStandalone`, default false), and nothing sets `iosScheme`, so native iOS calls `pushState` on `capacitor://localhost` at every navigation. No iOS 26.x note mentions `pushState`, so read the regression as beta-only. No code change, but route navigation is part of the §3.1 iOS 27 run. |
| **`contain: style` now applies to quote counters** (84758186) | none | Corrects [`../design/performance-boost.md:415`](../design/performance-boost.md), fixed in this change. [BCD](https://github.com/mdn/browser-compat-data/blob/main/css/properties/contain.json) records 15.4–27 as partial support that ends at 27, not as a removal. |

---

## 4. iOS 26.x point releases

Sources: Safari release notes for [26.2](https://developer.apple.com/documentation/safari-release-notes/safari-26_2-release-notes),
[26.4](https://developer.apple.com/documentation/safari-release-notes/safari-26_4-release-notes),
[26.5](https://developer.apple.com/documentation/safari-release-notes/safari-26_5-release-notes) and
[26.6](https://developer.apple.com/documentation/safari-release-notes/safari-26_6-release-notes).
Each fix is in iOS from that version onwards. adaptv's iOS floor is 15, so none of them lets code be
deleted.

| Release | Change | adaptv | Why no action |
|---|---|---|---|
| 26.2 | **`scrollend`** (158435888) | `src/components/wheel-column.tsx:223`, `:239` | The 120ms idle timers are the portable form, and the floor is below 26.2. |
| 26.4 | **Pages with `overflow: hidden` no longer scroll** from a gesture (163660111) | `src/hooks/use-freeze-viewport.ts:193`, `:209-220` | The pin and the non-passive listeners are still needed below 26.4. |
| 26.5 | **`preventDefault()` on `pointerdown` blocks scrolling** even with only passive touch listeners (173988278) | `src/hooks/use-gesture-engine.ts:392` | adaptv blocks scroll with non-passive `touchmove`, not `pointerdown`. |
| 26.6 | **Service Worker missing-script unregistration** (see §3.2) | same as §3.2 | same as §3.2 |

Testable: only 26.1 has a local runtime, so every row here is device-only.

---

## 5. Chrome and Android WebView 150–154

**The version framing moved on.** As of 2026-09-09, Android stable is 153 (153.0.8010.36), 154 is in an
early-stable rollout (154.0.8037.21, with M154 stable on 2026-09-22) and beta is 154 ([chromiumdash](https://chromiumdash.appspot.com/schedule)). The 154 release-notes page still
returns 404. Playwright's default Chromium is 149, and its tip-of-tree 151 build is not installed.

| Version | Change | adaptv | Why no action |
|---|---|---|---|
| [150](https://developer.chrome.com/release-notes/150) | **Programmatic scroll methods return Promises** | `src/components/wheel-column.tsx:201`, `src/components/drawer/drawer-keyboard.ts:224` | Chromium-only. The call sites have to keep their cross-engine form. |
| [150](https://developer.chrome.com/release-notes/150) | **`overscroll-behavior: chain`** | `src/shell/shell-layout.tsx:41`, `src/components/scroll-view.tsx:208` | It adds a value. The `none`/`contain` values adaptv uses keep their meaning. |
| [151](https://developer.chrome.com/release-notes/151) | **`local-network` / `loopback-network` permission policies** | none | They apply to Isolated Web Apps only. Android WebView LAN access follows the host app (§2.1). |
| [153](https://developer.chrome.com/release-notes/153) | **Media-query `change` events fire before animation events**, per the HTML spec | `src/hooks/use-theme.ts:119`, `:171`, `src/hooks/use-media-query.ts:36` | No adaptv code depends on the order between those listeners and animation events, and `src/` has no `transitionrun` listener. B32's half-frame lead is about browser-process IPC, not event-loop order. |
| [153](https://developer.chrome.com/release-notes/153) | **Deprecations and removals**: Protected Audience, Related Website Sets, Shared Storage, `requestStorageAccessFor`, Attribution Reporting, `_current` navigations | none | `src/` uses none of them. |

---

## 6. Corrections made elsewhere in this change

- [`../design/performance-boost.md:415`](../design/performance-boost.md): `contain: style` was added
  in Safari 27, not removed.
- [`native-shell-plugin.md §0.0`](native-shell-plugin.md) point 2, `§0.1` and **Timing risk**:
  - #61/#68 are closed by capacitor#8535 (released in 8.5.2), which also moves the SystemBars listener.
  - Its probe re-reads on `onPageCommitVisible`.
  - The Cap 9 `"full"` TODO line is deleted in the hunk that adds `"native"`.
- [`../decisions/register.md §5.1`](../decisions/register.md): the same two facts, in the SystemBars
  and Capacitor 9 rows.
- [`../decisions/register.md`](../decisions/register.md) B21: the WebView "current" version.
- [`owed-device-verification.md`](owed-device-verification.md) row 1: the switch tick needs re-checking on
  iOS 27.
- [`../research/capacitor-internals.md`](../research/capacitor-internals.md), upstream issues to
  watch: the 8.5 bump prerequisites.

## 7. Already in `docs/`, not repeated here

| Topic | Where |
|---|---|
| Navigation API is Baseline in Safari 26.2 | `../decisions/animation.md:249` |
| `overlay` absent from Safari 27 | `../decisions/animation.md:199` |
| iOS 26.5 broke the haptics polyfill | `../decisions/register.md:595` (B10) |
| `theme-color` inert on iOS 26 | `../decisions/register.md:699` (B17) |
| Android 16 removes the edge-to-edge opt-out; Android 17 emulator measurements | `../decisions/register.md:568` (B9) |
| iOS Local Network permission for LAN dev | `../decisions/positioning.md:237` |
| Wake Lock in Home Screen apps fixed in iOS 18.4 | `../decisions/register.md:1193` (B19) |
| Android WebView floor 119 | `../decisions/register.md:1075` (B21) |
