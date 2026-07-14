# Capacitor / native targets (nativ)

How `@repo/nativ` ships one app as **web (SSR PWA)**, **installed PWA (add-to-home)**,
**and** a **native iOS/Android build** — from one `nativ.config.ts`. Read before touching
platform detection, the service worker, offline data, capability hooks, or the native build.

## The one fault line to respect

"Is this the installed app?" used to be answered everywhere by `display-mode: standalone`.
A Capacitor WebView reports `display-mode: browser`, so that test is **wrong on native**.
Everything now keys off `@repo/nativ/utils`:

| Predicate | Means |
|---|---|
| `isNativePlatform()` | inside a Capacitor native shell (reads the injected `window.Capacitor` global — no import) |
| `isStandaloneDisplay()` | installed PWA (home-screen), browser tab = false |
| `isInstalledApp()` | **native OR standalone** — the "is this the app?" predicate |
| `getOS()` | `"ios" \| "android" \| "web"` (web = desktop/other) |
| `resolvePlatformTag()` | `"native" \| "standalone" \| "web"` |

Pre-paint, nativ stamps `<html data-nativ-platform>` and `<html data-nativ-os>` (blocking
head script) so the `app:` / `web:` Tailwind variants and critical CSS resolve from the
first frame. **`app:` now means installed (standalone PWA or native); `web:` means browser
tab only** — a native WebView is excluded from `web:`.

## SSR vs SPA — automatic per build, not a user choice

One app, two artifacts:

- **Web build** (`pnpm build`) — SSR + service worker, unchanged. Serves browser tab **and**
  standalone PWA (display mode is runtime).
- **Capacitor build** (`pnpm build:capacitor` → `NATIV_TARGET=capacitor`) — nativ forces
  `render: "spa"` + `sw: false`. A static SPA bundle loaded from the on-device `webDir`.

Why: Capacitor loads `webDir/index.html` from the **on-device bundle** — there's no server
to SSR, and the bundle *is* the offline shell, so the service worker is redundant/harmful
(stale-bundle risk). The switch lives in `nativ()` (vite plugin): `target: "capacitor"` or
`NATIV_TARGET=capacitor` mutates the loaded config before stamping. The app's
`vite.config.ts` drops `cloudflare()` and sets `build.outDir: "dist-capacitor"` for that target.

TanStack Start SPA emits `_shell.html`; `build:capacitor` copies it to `index.html` (Capacitor's
entry). `webDir` = `dist-capacitor/client`.

## Service worker — web only, automatic

| Context | Artifact | SW built? | SW registers? | Offline shell from |
|---|---|---|---|---|
| Browser tab | web SSR | ✅ | ✅ | SW precache + incremental nav cache |
| Installed PWA | same web SSR | ✅ | ✅ | SW precache + incremental nav cache |
| Native | Capacitor SPA | ❌ auto | ❌ auto | the on-device bundle |

Two-level gate: build-time (`sw:false` for the capacitor target → no `sw.js`, no precache) +
runtime (`useRegisterPwaServiceWorker` no-ops when `isNativePlatform()`). You keep writing
`sw.ts` for web; nativ decides where it applies. **Never make the SW nav cache load-bearing
for content** — it doesn't exist on native. See offline model below.

## Offline data model — nativ owns the shell, you own the data

Split every request into **shell** (differs per platform, nativ handles it) and **data**
(same everywhere — just JS + IndexedDB in a WebView). Pick a data posture per app:

| Posture | Offline behaviour | Add | Web + native? |
|---|---|---|---|
| **Fetch-and-fail** | query errors offline → fallback UI | nothing (plain TanStack Query) | identical |
| **Persisted cache** | previously-seen data readable offline (stale) | `@tanstack/query-persist-client` → IndexedDB | identical |
| **Local-first** (ChopChop) | full offline incl. writes; background sync | synq / a local DB | identical |

TanStack Query offline is **automatic** (default `networkMode: "online"` + `onlineManager`):
offline → queries `fetchStatus: "paused"` (no hanging request), mutations `isPaused` (auto-resume).
Drive UI off: `isPending` (no data → full skeleton), `isRefetching` (stale + revalidating →
per-field skeleton, e.g. price), `isPaused` (offline empty state — **not** `isLoading`, which
is false when paused), `dataUpdatedAt` (last successful fetch, persisted → "updated 5m ago" / stale mark).

**Connectivity accuracy:** feed nativ's `getOnline` / `subscribeOnline` (`@repo/nativ/capabilities`)
into TanStack's `onlineManager` — `navigator.onLine` on web, `@capacitor/network` on native.

## Capability hooks — one API, best backend per platform

Consumer apps just call the hook; it picks browser API / iOS polyfill / native plugin. nativ
**depends on `@capacitor/*` directly** (in the bundle always, inert on web — never registered
unless it's a native build). Public hook APIs never change across platforms.

| Hook (`@repo/nativ/hooks`) | web / iOS-web | native |
|---|---|---|
| `useVibrate` | `navigator.vibrate` / iOS-18 switch polyfill | `@capacitor/haptics` |
| `useNetworkStatus` | `navigator.onLine` + events | `@capacitor/network` |
| `useStatusBar` | no-op (browser owns the bar) | `@capacitor/status-bar` — **edge-to-edge**, theme-synced |
| `useGeolocation` | `navigator.geolocation` + Permissions | `@capacitor/geolocation` (OS prompt) |
| `useAndroidBackButton` | n/a | `@capacitor/app` back → router |

`useStatusBar` + `useAndroidBackButton` are wired once in `RoutingShell`. Non-React accessors
live in `@repo/nativ/capabilities` (`fireNativeHaptic`, `getOnline`/`subscribeOnline`,
`applyStatusBar`/`enableEdgeToEdge`, geolocation, `hideNativeSplash`).

**Adding a capability:** new file in `packages/nativ/src/capabilities/<x>.ts` → `if (!isNativePlatform()) { web path } else { @capacitor/<plugin> }`; wrap in a hook under `hooks/`; export via
`interface/capabilities.index.ts` + `interface/hooks.index.ts`. Model permission-gated APIs on
`geolocation.ts` (the exemplar).

## Splash policy (opinionated, by design)

The custom React splash renders when the app is **installed**; a plain browser tab serves the pages
instantly. SSR-safe: gated pre-paint off the `data-nativ-platform` stamp in the critical CSS
(`getCriticalShellCss` in `shell/critical-css.ts`), so the overlay never paints where it's suppressed —
no hydration mismatch, no flash.

| Context | `data-nativ-platform` | Custom React splash? |
|---|---|---|
| Native (iOS / Android) | `native` | ✅ always |
| Standalone / home-screen PWA (iOS / Android) | `standalone` | ✅ always |
| Browser tab | `web` | ❌ by default — instant pages; `splashScreenInBrowser: true` opts in |

`splashScreenInBrowser` (in `nativ.config.ts`, default `false`) is the only knob. The gate:
`html[data-nativ-platform="web"] [data-nativ-splash]{display:none!important}` (omitted entirely when
`splashScreenInBrowser`). The React splash **self-dismisses by returning `null`** when ready (no `hide`
prop) — `RoutingShell` just mounts it.

**The OS launch splash is a flat MASK colour** (`launchAutoHide: false` holds it until the app hands off;
`RoutingShell` calls `hideNativeSplash()` after first paint) that fades into the React splash — the mascot
lives ONLY in the React overlay, never the native layer (a native mascot = double-splash; see app-icons).
The mask is **colour-DRIVEN, not image-driven** (no generated splash PNGs): Android via a colour resource on
the launch theme, iOS via a colour asset on a solid launch storyboard. Config keys (all flat, no `native{}`):
`splashMaskMode` (`"preferences"` default / `"system"` / `"light"` / `"dark"`), `splashMaskLightColor`,
`splashMaskDarkColor`. `preferences` follows the app theme; `system` follows the device; `light`/`dark` are
fixed (theme-independent → no iOS first-frame mismatch either).

**No Capacitor plugin `backgroundColor`.** The `@capacitor/splash-screen` plugin's held view takes a single
fixed colour that can't follow the theme, so on a dark launch it flashes the light mask (verified frame-by-
frame on the iOS sim). nativ **omits it** — the theme-aware pre-paint critical CSS (the WebView's own `html`
background) shows through during the held phase instead, and the real mask colour comes from the launch theme
(Android) / launch-storyboard colour asset (iOS). Manifest `background_color` = `backgroundColor` too.

**Android 12+ system splash** — the OS forces a splash that centres the launcher icon on a background, even
for native apps; it can't be disabled. nativ neutralises it: the `nativ` CLI's `patchAndroidSplash` writes a
launch-theme override (`values-v31/styles.xml` platform attrs + `values/styles.xml` AndroidX attrs +
`values{,-night}/colors.xml` + a transparent `drawable/splash_icon.xml`) setting
`windowSplashScreenBackground` = brand colour and `windowSplashScreenAnimatedIcon` = **transparent** → a flat
colour, no icon. Re-applied every `nativ sync/run android` (idempotent), so it survives `@capacitor/assets`
and re-scaffolds.

**Theme-aware splash** — the splash colour follows the **app** theme (light/dark), not the device system,
like the React splash. Mechanism: nativ mirrors the theme preference to native storage
(`@capacitor/preferences`, `persistNativeThemePreference` — on change + at startup), and the CLI writes a
**nativ-owned `MainActivity`** that reads it and calls `UiModeManager.setApplicationNightMode()` (API 31+ —
the only API the OS honours for the system splash) + `AppCompatDelegate.setDefaultNightMode()`. It's applied
at startup (before the window) **and live** — `MainActivity` registers a `SharedPreferences` change listener
on the `CapacitorStorage` file nativ writes to, so a theme change updates the OS override *immediately*
(`uiMode` is in the activity's `configChanges`, so no WebView reload; `AppCompatDelegate` is startup-only
since it recreates the activity). Because the override persists, the **next** launch's splash is already
correct — **1-launch convergence, no "open twice."** A `"system"` preference (the default) always matches.
Verified on the emulator: app forced dark + system light → **dark** splash; toggle to light → the very next
launch's splash is light.

**iOS** — the CLI (`patchIosTheme`) writes a `NativSplash` colour asset (`Assets.xcassets/NativSplash.colorset`,
light + dark; a fixed mask has no dark variant → theme-independent) and a **solid launch storyboard** that
paints it (no image). For `splashMaskMode: "preferences"` it also patches `AppDelegate` to set
`window.overrideUserInterfaceStyle` from the persisted preference (stripped for the other modes). Known iOS
limit: the **pre-app `LaunchScreen` frame** is drawn from a launch snapshot that resolves a named colour to its
*universal* (light) variant regardless of device appearance — so an adaptive mask shows ~0.3s of the light
colour before the app takes over. It's a single brief frame (verified: no plugin/held flash after it, straight
to the themed app); a fixed mask avoids it entirely.

## The `nativ` CLI — the only native entrypoint

Consumers never run `cap`, set toolchain env, or call an asset generator by hand. The
**`nativ` CLI** (`packages/nativ/bin/nativ.mjs`, exposed as the `nativ` bin) owns the whole
lifecycle and resolves `ANDROID_HOME` / `JAVA_HOME` / `pod` / `LANG` itself (an explicit env
var still wins), invoking the *local* `cap` binary directly so it works from a bare shell — not
only through a pnpm script that happened to seed `PATH` (that was the old `cap: command not
found` trap). The frontend scripts are thin aliases:

```
pnpm --filter @repo/frontend native:doctor   # nativ doctor  — check JDK/SDK/Xcode/pod, print ✓/✗
pnpm --filter @repo/frontend cap:android      # nativ run android — build SPA → brand assets → sync → launch
pnpm --filter @repo/frontend cap:ios          # nativ run ios
pnpm --filter @repo/frontend cap:ios:ipa      # nativ build ios --ipa  (unsigned archive)
pnpm --filter @repo/frontend cap:sync         # nativ sync android     (build + assets + cap sync, no launch)
# nativ assets [ios|android]                  # regenerate launcher icons + splash only
```

Each `run` does: `vite build` (`NATIV_TARGET=capacitor`) + stamp `index.html` → brand assets →
`cap sync <platform>` → `cap run <platform>`. Add `--target <id>` to skip the device picker.

Toolchain (the CLI resolves these; you just install them):
- **Android** — SDK + a JDK (Android Studio bundles one at `/Applications/Android Studio.app/Contents/jbr/Contents/Home`).
- **iOS** — Xcode + **CocoaPods** (`gem install cocoapods`). The iOS project must be generated with **CocoaPods, not SPM**: `cap add ios --packagemanager CocoaPods`. See the version gotcha below.

**Capacitor version pin (important).** The official plugins (`status-bar`, `app`, …) lag `@capacitor/core`'s latest (their newest is ~8.0.x–8.2.0 vs core 8.4.x) and are built against the 8.0.x Swift API. So the whole core family is pinned to **8.0.2** (`@capacitor/core`/`cli`/`ios`/`android` in the frontend + `@capacitor/core` in nativ) to match them. **Do not bump core above the plugins** or iOS fails to compile. And use **CocoaPods** on iOS: Capacitor 8's SPM framework (`capacitor-swift-pm`) diverged from the plugins' API (missing `getString`/`reject`/`bridge.webView`), while the CocoaPods framework (npm `@capacitor/ios`, which ships `Capacitor.podspec`) still matches — so SPM won't build, CocoaPods will.

**Plugins live in the APP, not nativ.** Capacitor auto-discovers plugins by scanning the app's **direct**
dependencies at `cap sync` (writing `capacitor.plugins.json`) — transitive deps (a plugin buried in nativ's
`dependencies`) are **not** discovered. So the base plugins nativ's hooks use (`app`, `browser`, `haptics`,
`keyboard`, `network`, `preferences`, `screen-orientation`, `splash-screen`, `status-bar`, `core`) are declared
as **optional `peerDependencies`** of `@repo/nativ` (a pure-web consumer needs none) and installed as **direct
deps of `apps/frontend`**. `nativ doctor` prints ✓/✗ per base plugin and the exact install command if any are
missing. There is **no plugin array** in `nativ.config.ts` — a consumer just installs the plugin and Capacitor
finds it.

**Generated, nativ-owned, gitignored (never hand-edit):** `capacitor.config.json` is stamped from
`nativ.config.ts`'s flat `appId` — and *only* for the capacitor target, so a plain web `dev`/`build`
never materialises it. The `android/` + `ios/` projects and `dist-capacitor/` + native build artifacts
(`Pods/`, `DerivedData/`, `.gradle/`, `build/`) are all gitignored. Treat them like `node_modules`:
regenerated, not authored.

## App icons + splash — branded, never the Capacitor default

`nativ run`/`nativ assets` feeds `@capacitor/assets` from `apps/frontend/assets/` — **only a transparent
`logo.png`** (the launcher-icon source). The **launcher icon** is the mascot on `#ffffff` (matching the PWA
icons). There are **no splash PNGs** — the splash is colour-driven (see Splash policy), so `assets/` holds
just the logo.

The **launch splash is a SOLID mask colour — no mascot**. Deliberate: every app has an unavoidable OS launch
screen, and if it shows the mascot you get a **double splash** — the OS mascot, then the app's own React
splash mascot. Keeping the native layer a flat colour makes it a seamless same-colour lead-in; the mascot
appears exactly once, in the app-owned React splash (which fades it in on the identical colour). The colour
is theme-aware and driven by `splashMaskMode` / `splashMaskLightColor` / `splashMaskDarkColor` — Android via
the launch theme (`patchAndroidSplash`), iOS via a colour asset on a solid storyboard (`patchIosTheme`). No
generated splash images. Verified on both sims (light + dark).

**API/auth already native-safe:** `backend-client` uses an absolute `VITE_BACKEND_URL`, auth is
Bearer-token (no cross-origin cookies) — a `capacitor://localhost` / `http://localhost` origin
works as long as `VITE_BACKEND_URL` points at the remote backend (not localhost, which is the device).

## Distribution & OTA updates

- **Backend URL is COMPILE-TIME.** `VITE_BACKEND_URL` (`env/.env`) is baked into the bundle. For a
  real device use a **deployed HTTPS** URL — a LAN `http://…` dev IP is unreachable (wrong network
  **and** iOS App Transport Security blocks cleartext; the Capacitor Info.plist has no ATS exception).
- **Android `.apk`** — `cap:android` self-signs a debug APK at `android/app/build/outputs/apk/debug/`.
- **iOS `.ipa`** — a simulator run makes only `App.app` (simulator slice), never an `.ipa`. `.ipa` is a
  device artifact needing code signing. For **sideloading** (kravasign / AltStore / Sideloadly, which
  re-sign at install), build an **unsigned** `.ipa`: `pnpm --filter @repo/frontend cap:ios:ipa` →
  `apps/frontend/ios/App/build/ChopChop-unsigned.ipa` (Release device archive, `CODE_SIGNING_ALLOWED=NO`,
  packaged `Payload/App.app`; see `scripts/build-ipa.sh`). For **TestFlight / App Store**, sign via
  Xcode ▸ Archive ▸ Distribute with your own certificate — never automate the user's credentials.
- **OTA ("update over the air").** The bundle is a snapshot baked into the store build, so by default an
  update = a new store version (App Store review each time). Capacitor's OTA story is **Live Updates**
  (`@capacitor/live-updates` / Capgo / Appflow): host versioned web bundles, the app downloads and
  hot-swaps `webDir` on next launch — allowed for **JS/web-only** changes (Apple guideline 3.3.2). Native
  changes (new plugins, native code) still require a store submission. nativ produces the static bundle
  those tools ship; it doesn't include a live-update client yet — it's an opt-in layer on top.

## Gotchas

- nativ carries `@capacitor/*` as hard deps by design — Capacitor is in the bundle on web too,
  just never active. Don't try to make it optional; the hooks depend on it.
- Native "installed app" uses in-memory history (`standaloneMemoryHistory` → `isInstalledApp()`),
  so the OS gesture is inert and the app owns back (Android hardware back → router).
- Keyboard on native currently uses the web `visualViewport` path (works); `@capacitor/keyboard`
  precision + `@capacitor/screen-orientation` lock are follow-on refinements.
- Edge-to-edge on Android native = `StatusBar.setOverlaysWebView(true)` + the `app:`/`p-safe`
  safe-area utilities (which now apply on native). The nav bar is native-theme territory.
