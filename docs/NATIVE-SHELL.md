# adaptv — the `@adaptv/shell` native plugin

> The first-party Capacitor plugin (Swift + Kotlin) that **owns the native shell** — edge-to-edge, real
> inset reporting, status/nav bar, colour-driven splash, and theme sync — collapsing today's mix of
> community plugins + CLI native-source string-patching into **one module adaptv controls**. This is the
> native layer of `ARCHITECTURE.md §1.1` and **the wedge vs Ionic** (roadmap #2).
>
> Design, not built. The hard part is the **Android-15 / SDK-35 inset + keyboard breakage** (`RESEARCH.md
> §3`, flagged HIGH RISK) — treat it as the crux, not a detail. Started **2026-07-14**.

---

## ⚠︎ 0.0 STOP — the premise changed. Read this before anything below. (2026-07-20)

**Capacitor 8 ships a core plugin called `SystemBars` that has already taken over inset + IME handling
on Android, and it is registered unconditionally.** Everything below §1 was designed against a blank
slate that no longer exists.

`com.getcapacitor.plugin.SystemBars` lives **inside `@capacitor/android` itself** and is registered in
`Bridge.registerAllPlugins()` alongside `CapacitorHttp`/`CapacitorCookies`/`WebView`. You cannot
exclude it. Consequences, all verified against source:

1. **`@capacitor/keyboard`'s `resizeOnFullScreen` is dead code on Capacitor 8.**
   `possiblyResizeChildOfContent()` — its only consumer — early-returns when
   `Class.forName("com.getcapacitor.plugin.SystemBars")` resolves, which it **always** does. Shipped in
   keyboard 8.0.3 via [PR #62](https://github.com/ionic-team/capacitor-keyboard/pull/62).

2. **The two plugins collide, and it's an open bug.**
   [capacitor-keyboard#68](https://github.com/ionic-team/capacitor-keyboard/issues/68): setting
   `SystemBars.insetsHandling: "disable"` **plus** `Keyboard.resizeOnFullScreen: true` means *nothing*
   resizes the WebView. And [#61](https://github.com/ionic-team/capacitor-keyboard/issues/61) — a grey
   bar the height of the top inset appearing above the keyboard — has been open ~12 months across
   `capacitor#8095` → `#8398`, with users pinning to 8.0.0/8.0.1 to escape it.

3. **The maintainer's official position kills the current architecture.** jcesarmobile,
   [capacitor-plugins#2517](https://github.com/ionic-team/capacitor-plugins/issues/2517), 2026-06-25:
   *"If you are using edge to edge, remove status bar plugin, Capacitor 8 ships with SystemBars plugin."*
   That issue was opened because **Google Play Console now warns** about deprecated edge-to-edge APIs,
   with stack traces pointing at `StatusBar.setStatusBarColorDeprecated`.

4. **`@capacitor/status-bar` is half-dead on modern Android — silently.**
   `shouldSetStatusBarColor()` gates on **device** `Build.VERSION.SDK_INT`: `true` below API 35,
   `hasOptOut` at 35, **`false` at 36+**. So `setBackgroundColor` **resolves successfully and does
   nothing** on API 36+. Worse, `setOverlaysWebView` isn't gated at all — it still calls the
   no-op'd `setSystemUiVisibility`/`setStatusBarColor`, so `setOverlaysWebView(false)` also **resolves
   successfully and does nothing** on API 35+. *Under enforced edge-to-edge, `overlaysWebView` is
   permanently `true` and there is no way back.* `getInfo().color` reads the deprecated
   `Window.getStatusBarColor()` and returns `"#000000"` regardless of what's on screen.

5. **The only supported way to tint a status bar in 2026 is to draw it yourself** — a fixed-position
   scrim in the web layer, sized by `env(safe-area-inset-top)`, with `SystemBars.setStyle()` choosing
   light/dark *icons* to contrast it. Native background colour is gone with no replacement.

### What `SystemBars` already does for us

Its Android inset pipeline installs `ViewCompat.setOnApplyWindowInsetsListener` on the WebView's parent
and branches on WebView version, working around three Chromium bugs:

| Constant | Bug | Workaround |
|---|---|---|
| `WEBVIEW_VERSION_WITH_SAFE_AREA_FIX = 140` | [crbug/40699457](https://issues.chromium.org/issues/40699457) — `env(safe-area-inset-*)` wrong below WebView 140 | inject CSS vars manually below 140 |
| `WEBVIEW_VERSION_WITH_SAFE_AREA_KEYBOARD_FIX = 144` | [crbug/457682720](https://issues.chromium.org/issues/457682720) — bottom inset wrong while IME visible | force bottom to `0` below 144 |
| — | [crbug/461332423](https://issues.chromium.org/issues/461332423) — returning `WindowInsetsCompat.CONSUMED` **breaks safe-area recalculation** | build zeroed insets instead of consuming |

It injects `--safe-area-inset-{top,right,bottom,left}` on `document.documentElement` (Android only; iOS
relies on native `env()`), configurable via `insetsHandling: "css" | "disable"`.

**Two behaviours to design around:** the values are **integer-truncated dp** (`(int)(px/density)`), so
they disagree with `env(safe-area-inset-*)` by up to 1px; and **`--safe-area-inset-bottom` is forced to
`0` whenever the IME is visible** — the variable is not a stable geometric fact.

### ⚠︎ 0.1 The `viewport-fit=cover` probe is one-shot, and a framework loses that race (2026-07-27)

`SystemBars` decides **once per process** whether the page opted into drawing under the bars: from a
`DOMContentLoaded` listener it calls `onDOMReady()`, which reads the **last** `meta[name=viewport]` and
looks for the literal string `viewport-fit=cover`. The answer (`hasViewportCover`) gates
`shouldPassthroughInsets`, and **nothing re-checks it** — not a rotation, not `onPageCommitVisible`, not
a new inset dispatch.

A static `index.html` never loses that race. A framework that manages `<head>` on the client does: the
router replaces the viewport tag during boot, and a probe landing in the gap reads "no cover".

**The fallback it then picks is the bug users see.** With no cover, SystemBars pads the WebView's parent
by the system-bar insets *natively* and injects `--safe-area-inset-*` as **`0`** (deliberately — the
WebView is no longer drawing under anything). The app is not edge-to-edge, and the strip it stopped
covering shows the window background: Capacitor's stock `AppTheme.NoActionBar` inherits AppCompat's
`#fafafa`/`#303030`, so it reads as **a solid grey status-bar band**.

Measured, Pixel emulator API 37 / WebView 149, `adaptv preview android`: `innerHeight` 845 of 923,
`--safe-area-inset-top: 0px`, and rotating the device did **not** recover it (proving the flag, not the
inset pass, was stale). Calling `window.CapacitorSystemBarsAndroidInterface.onDOMReady()` by hand
flipped it to 923 / `54px` immediately.

**Two fixes, at two layers, because the failure has two halves:**

1. `capabilities/status-bar.ts` re-runs `onDOMReady()` — Capacitor's own entry point, so idempotent —
   and then *watches the result*, re-probing on any frame where the injected variable is missing, for
   the first 2s of boot. Watching beats a fixed delay because there are two independent races: the
   probe can run before the head settles, **and** a pass that landed can have its properties wiped
   afterwards by the router's `<html>` reconcile (the same one `applyPlatformStamp` already undoes).
2. `bin/lib/native.mjs` points the app theme's `windowBackground` at the theme-aware splash-mask
   colour, and makes the pre-API-35 bars transparent with the API-29+ contrast scrims off. The grey is
   then unreachable *by construction* on every Android version — including WebView < 140, where
   Capacitor never attempts passthrough at all and the padded fallback is permanent.

### ⚠︎ 0.2 Nothing in the stack ever asked for edge-to-edge below Android 15 (2026-07-31)

§0.0 and §0.1 are both about the *inset report*. They assume the window is already drawing under the
bars. **Below API 35 it never was.**

- `SystemBars` only **reports**. Read its source again: it installs a listener, injects CSS, and styles
  bar icons. It never touches the window. Nothing in `BridgeActivity` does either.
- `@capacitor/status-bar`'s `setOverlaysWebView(true)` was the only thing left holding it up, and it is
  the deprecated `setSystemUiVisibility` path — `LAYOUT_STABLE | LAYOUT_FULLSCREEN`, no
  `LAYOUT_HIDE_NAVIGATION`. **It covers the status bar and never the gesture bar.**
- And it only ran at all if the plugin reached the native project. Before
  [#27](https://github.com/arrzdev/adaptv/pull/27) adaptv's own plugins didn't, so on a pre-#27 build
  the JS call rejected `UNIMPLEMENTED`, `.catch(() => {})` swallowed it, and the app was simply not
  edge-to-edge — the grey band in §0.1, reached by a second, unrelated route.

Measured on the `Pixel_7` AVD (API 34, WebView 113, `adaptv preview android`):

| build | `innerHeight` / `screen.height` | `--safe-area-inset-top` | what you see |
|---|---|---|---|
| pre-#27 (no StatusBar plugin) | 839 / 915 | *unset* | padded, `windowBackground` band top **and** bottom |
| #27 (plugin registered) | 891 / 915 | `0px` | under the status bar, **nothing pads it** — header on the clock |

**The fix is native, in the generated `MainActivity` (`bin/lib/native.mjs`), not in JS:**

1. `WindowCompat.setDecorFitsSystemWindows(getWindow(), false)` in `onCreate`. Both bars, API 21+, no
   plugin to be registered, and it lands before the first inset dispatch — so there is no boot race to
   lose and no `UNIMPLEMENTED` to swallow. On API 35+ the OS already enforces the same thing.
2. `enableEdgeToEdge()` stops calling `setOverlaysWebView` on Android (iOS keeps it — there it is still
   the real mechanism). Calling it now would re-run the Play-flagged deprecated path over a window that
   is already correctly edge-to-edge.
3. **On WebView < 140 adaptv reports the insets itself.** `shouldPassthroughInsets` requires
   `getWebViewMajorVersion() >= 140`; below that `SystemBars` injects `0px` for all four *on purpose*,
   because it assumes the page is not drawing under anything. Once the page is, those zeros are the bug.

### 🔒 Revised decision: layer on `SystemBars`, do not replace it

The original plan — "phase 1 owns edge-to-edge + inset/IME reporting" — would mean **a second
`setOnApplyWindowInsetsListener` on the same view hierarchy as an unavoidable core plugin.** That
collision is *literally* bugs #61 and #68. Owning it harder makes it worse, not better.

So:

- **Rent `SystemBars` for the Android inset pipeline.** It already carries three Chromium workarounds
  adaptv would otherwise have to discover, maintain, and version-gate itself. Consume its CSS vars;
  do not install a competing listener.
- **`@adaptv/shell`'s Android job shrinks** to: normalising units (dp vs points vs truncated-int),
  papering over the IME-forces-bottom-to-zero quirk, and giving adaptv one accessor whose shape is
  identical on both platforms.
- **Drop `@capacitor/status-bar`** for edge-to-edge apps, per the maintainer's own guidance. Replace
  its tinting role with the web-layer scrim (point 5) plus `SystemBars.setStyle()`.
- **Own the keyboard height**, and report it **continuously**, not on discrete show/hide events —
  changing an `<input type>` to `tel` or opening the emoji keyboard resizes the IME while firing **no
  events at all** ([#26](https://github.com/ionic-team/capacitor-keyboard/issues/26),
  [#29](https://github.com/ionic-team/capacitor-keyboard/issues/29)).
- **Never assume `keyboardWillHide` precedes `keyboardDidHide`.** On iOS 26 the order inverts when the
  keyboard hides without animation ([#32](https://github.com/ionic-team/capacitor-keyboard/issues/32)).
- **Do not build on `visualViewport` on native.** Ionic's own source refuses to, with the reason in a
  comment: *"the Ionic webview manipulates how it resizes such that the Visual Viewport API is not
  reliable here."* Every Capacitor resize strategy shrinks the WebView rather than overlaying it, so
  the keyboard becomes invisible to `visualViewport`. Web-target fallback only.
- **`interactive-widget` is Android-only.** MDN BCD: `webview_android` 108 ✅, `webview_ios` **`false`**.
  It cannot be part of a cross-platform abstraction without a separate iOS path.

### ⚠︎ Timing risk

**Capacitor 9 is in alpha** (`@capacitor/core@9.0.0-alpha.6`) and `SystemBars.java` carries a
`// TODO: In Cap 9, add an additional option "full"` beside `insetsHandling`. **The inset contract is
going to change again.** Do not freeze `@adaptv/shell`'s public API against Capacitor 8's shape without
reading the Cap 9 alpha first.

> **Net effect on the roadmap: `@adaptv/shell` gets smaller and less risky, but stops being "the wedge
> vs Ionic"** — Capacitor core now solves the part that was going to be adaptv's differentiator. The
> real remaining wedge is the *unified cross-platform accessor* (§4) and everything above the native
> seam, not the seam itself.

---

## 0. Why own a native module

Today the native shell is **assembled from parts**:
- Community plugins: `@capacitor/status-bar`, `@capacitor/splash-screen`.
- The CLI **string-patches native project source** on every sync — `patchAndroidSplash` (writes
  `colors.xml` / `values-night` / launch `styles.xml` / a themed or plain `MainActivity.java`) and
  `patchIosTheme` (writes the `AdaptvSplash` colorset, the launch storyboard, and an `AppDelegate.swift`
  override) — see `bin/adaptv.mjs`.
- The generated `capacitor.config.json` sets `StatusBar.overlaysWebView` + `SplashScreen` blocks.

It works and is green — but it's fragile: patching native source with regexes, community-plugin version
skew, and **no owned place to fix the Android-15 inset/keyboard breakage** that the current approach will
hit (`RESEARCH.md §3`). Doctrine (`ARCHITECTURE.md §0.6`): *rent stable cores, own seams.* Edge-to-edge +
insets **is** the seam — and roadmap #2 names it the wedge — so adaptv should **own** it as a real plugin.

---

## 1. Scope — what the plugin owns

| Concern | Today | In `@adaptv/shell` |
|---|---|---|
| Edge-to-edge draw | `StatusBar.overlaysWebView` + SDK defaults | owned on both platforms, incl. the SDK-35 forced-E2E path |
| **Inset reporting** | `env(safe-area-inset-*)` (web) only; Android IME unreliable | the plugin reports **real** insets (status, nav, cutout, **keyboard/IME**) to the WebView, uniform cross-platform |
| Status / nav bar | `@capacitor/status-bar` | owned: style (light/dark icons) + background/transparent, theme-driven |
| Splash mask | CLI string-patches launch theme / storyboard / colors | plugin config, still **colour-driven + theme-aware**, hold-until-ready handoff |
| Theme sync | CLI-patched `UiModeManager` / `overrideUserInterfaceStyle` | plugin API — no native-source patching |

The **JS layer above the plugin does not change**: adaptv's shell consumes the plugin and keeps exposing
the same `--adaptv-safe-*` CSS vars and the same hooks (`useStatusBar`, `useKeyboard`, splash). The
primitives are untouched; only the native implementation underneath them is replaced. That's the whole
point — own the native seam without disturbing the contracts in `ARCHITECTURE.md §1`.

---

## 2. The JS API — one plugin surface

```ts
import { Shell } from "@adaptv/shell"

await Shell.configure({ edgeToEdge: true, statusBar: { style: "theme" }, splash: { … } })
await Shell.setTheme("dark" | "light" | "system")     // replaces the CLI MainActivity/AppDelegate patch
await Shell.hideSplash()                                // hold-until-ready handoff
Shell.addListener("insetsChange", ({ top, bottom, left, right, keyboard }) => { … })
```

adaptv's shell subscribes to `insetsChange` and writes the values to CSS custom properties
(`--adaptv-safe-top`, …, `--adaptv-keyboard`), so `View safe="…"` and `useKeyboard` read one uniform source
on every target. On web the same vars resolve from `env(safe-area-inset-*)` / `visualViewport` — identical
shape, different origin (the layer-1 hybrid split of `ARCHITECTURE.md §4`).

---

## 3. The Android-15 / SDK-35 crux (the hard part)

`RESEARCH.md §3`: Android 15 **forces** edge-to-edge on `targetSdk 35`, and the old
`keyboard-resize`/`keyboard-offset` path is no longer reliable — inputs near the bottom get overlapped,
and devices `< API 35` need explicit layout margins to keep prior behaviour. The plugin must therefore:

- **Read `WindowInsetsCompat` directly** (not community keyboard resize modes) to get accurate insets,
  **including the IME (keyboard) inset** — the reliable post-15 source. Report it via `insetsChange`.
- **Feed the IME inset to `useKeyboard`** on native. `useKeyboard` already prefers the exact OS height on
  native (`BEHAVIORS.md §4`); this makes that source *reliable on 15+* instead of depending on the plugin
  resize mode that broke.
- **For `< API 35`**, apply explicit layout margins to preserve old behaviour (what the community fix
  plugin does).
- **Study before writing:** Capawesome's `android-edge-to-edge-support` `WindowInsets` handling and the
  linked issues (`RESEARCH.md §3`) — adopt their hard-won handling, diverge where adaptv's single-module
  design differs. This is the "study Ionic/Capacitor prior art before reinventing" doctrine applied.

iOS is comparatively calm (safe-area insets are stable), but the plugin still owns the status-bar
overlay + the launch storyboard colour asset so the whole native shell lives in one place.

---

## 4. Migration path — CLI patching → plugin config (phased)

Own it, but **incrementally** — the Android-15 inset work is the risky, high-value core; the styling is
already green. So:

- **Phase 1 — the risky core.** Ship the plugin owning **edge-to-edge + inset/IME reporting** (the
  Android-15 fix). Keep the community `@capacitor/status-bar` / `@capacitor/splash-screen` and the CLI
  splash patching as-is. This de-risks the breakage first, with the smallest surface.
- **Phase 2 — absorb the rest.** Move status-bar styling, the colour-driven splash mask, and the theme
  override into the plugin's native code. The CLI **stops string-patching native source**
  (`patchAndroidSplash`/`patchIosTheme` retire); the generated `capacitor.config` replaces its
  `StatusBar`/`SplashScreen` blocks with a single `@adaptv/shell` block; the splash mask colours flow from
  `adaptv.config.ts` → the plugin config. `BEHAVIORS.md §3/§5/§6` get re-pointed at the plugin.

Net end state: the CLI installs + syncs one plugin and passes it config; the plugin owns every native
behaviour; **no regex patching of native projects.**

---

## 5. Wrap vs own

Per `RESEARCH.md §3` you *could* just depend on the Capawesome edge-to-edge plugin. But roadmap #2
explicitly makes this **the wedge vs Ionic**, and a rented native shell can't be the differentiator — so
**own it**, using the community plugin's `WindowInsets` handling as the reference implementation to study,
not as a runtime dependency. (Contrast with OTA in `LIFECYCLE.md §5.5`, where adaptv *rents* the low-level
bundle-swap — there the swap isn't the wedge; here the native shell is.)

---

## 6. Testing & status

Native-only, and specifically at the **API 34 ↔ 35 boundary** — the plugin's inset/keyboard behaviour
must be verified on both an API-34 and an API-35 emulator (the breakage line), plus the six-target
discipline (`TESTING.md`). Manual `adaptv run` today; a future `adaptv e2e` (`LIFECYCLE.md §7.2`) could
automate it.

**Status:** not built (roadmap #2). Highest native-risk item; the Android-15 `WindowInsets`/IME handling
is the crux. Cross-refs: `ARCHITECTURE.md §1.1` (the native layer it implements) · `BEHAVIORS.md §3/§5/§6`
(current edge-to-edge / safe-area / splash it will absorb) · `RESEARCH.md §3` (the Android-15 issues to
read first) · `capacitor-internals.md` (version pins) · `LIFECYCLE.md §7` (how the CLI syncs it).
