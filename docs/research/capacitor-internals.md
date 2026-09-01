# Capacitor / native targets (adaptv)

How `@repo/adaptv` ships one app as **web (SSR PWA)**, **installed PWA (add-to-home)**,
**and** a **native iOS/Android build** — from one `adaptv.config.ts`. Read before touching
platform detection, the service worker, offline data, capability hooks, or the native build.

## The one fault line to respect

"Is this the installed app?" used to be answered everywhere by `display-mode: standalone`.
A Capacitor WebView reports `display-mode: browser`, so that test is **wrong on native**.
Everything now keys off `@repo/adaptv/utils`:

| Predicate | Means |
|---|---|
| `isNativePlatform()` | inside a Capacitor native shell (reads the injected `window.Capacitor` global — no import) |
| `isStandaloneDisplay()` | installed PWA (home-screen), browser tab = false |
| `isInstalledApp()` | **native OR standalone** — the "is this the app?" predicate |
| `getOS()` | `"ios" \| "android" \| "web"` (web = desktop/other) |
| `resolvePlatformTag()` | `"native" \| "standalone" \| "web"` |

Pre-paint, adaptv stamps `<html data-adaptv-platform>` and `<html data-adaptv-os>` (blocking
head script) so the `app:` / `web:` Tailwind variants and critical CSS resolve from the
first frame. **`app:` now means installed (standalone PWA or native); `web:` means browser
tab only** — a native WebView is excluded from `web:`.

## SSR vs SPA — automatic per build, not a user choice

One app, two artifacts:

- **Web build** (`pnpm build`) — SSR + service worker, unchanged. Serves browser tab **and**
  standalone PWA (display mode is runtime).
- **Capacitor build** (`pnpm build:capacitor` → `ADAPTV_TARGET=capacitor`) — adaptv forces
  `render: "spa"` + `sw: false`. A static SPA bundle loaded from the on-device `webDir`.

Why: Capacitor loads `webDir/index.html` from the **on-device bundle** — there's no server
to SSR, and the bundle *is* the offline shell, so the service worker is redundant/harmful
(stale-bundle risk). The switch lives in `adaptv()` (vite plugin): `target: "capacitor"` or
`ADAPTV_TARGET=capacitor` mutates the loaded config before stamping. The app's
`vite.config.ts` drops `cloudflare()` and sets `build.outDir: ".adaptv/web"` for that target.

TanStack Start SPA emits `_shell.html`; `build:capacitor` copies it to `index.html` (Capacitor's
entry). `webDir` = `.adaptv/web`.

## Service worker — web only, automatic

| Context | Artifact | SW built? | SW registers? | Offline shell from |
|---|---|---|---|---|
| Browser tab | web SSR | ✅ | ✅ | SW precache + incremental nav cache |
| Installed PWA | same web SSR | ✅ | ✅ | SW precache + incremental nav cache |
| Native | Capacitor SPA | ❌ auto | ❌ auto | the on-device bundle |

Two-level gate: build-time (`sw:false` for the capacitor target → no `sw.js`, no precache) +
runtime (`useRegisterPwaServiceWorker` no-ops when `isNativePlatform()`). You keep writing
`sw.ts` for web; adaptv decides where it applies. **Never make the SW nav cache load-bearing
for content** — it doesn't exist on native. See offline model below.

## Offline data model — adaptv owns the shell, you own the data

Split every request into **shell** (differs per platform, adaptv handles it) and **data**
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

**Connectivity accuracy:** feed adaptv's `getOnline` / `subscribeOnline` (`@repo/adaptv/capabilities`)
into TanStack's `onlineManager` — `navigator.onLine` on web, `@capacitor/network` on native.

## Capability hooks — one API, best backend per platform

Consumer apps just call the hook; it picks browser API / iOS polyfill / native plugin. adaptv
**depends on `@capacitor/*` directly** (in the bundle always, inert on web — never registered
unless it's a native build). Public hook APIs never change across platforms.

| Hook (`@repo/adaptv/hooks`) | web / iOS-web | native |
|---|---|---|
| `useVibrate` | `navigator.vibrate` / iOS-18 switch polyfill | `@capacitor/haptics` |
| `useIsOffline` | `navigator.onLine` + events | `@capacitor/network` |
| `useStatusBar` | no-op (browser owns the bar) | `@capacitor/status-bar` — **edge-to-edge**, theme-synced |
| `useGeolocation` | `navigator.geolocation` + Permissions | `@capacitor/geolocation` (OS prompt) |
| `useAndroidBackButton` | n/a | `@capacitor/app` back → router |

`useStatusBar` + `useAndroidBackButton` are wired once in `RoutingShell`. Non-React accessors
live in `@repo/adaptv/capabilities` (`fireNativeHaptic`, `getOnline`/`subscribeOnline`,
`applyStatusBar`/`enableEdgeToEdge`, geolocation, `hideNativeSplash`).

**Adding a capability:** new file in `packages/adaptv/src/capabilities/<x>.ts` → `if (!isNativePlatform()) { web path } else { @capacitor/<plugin> }`; wrap in a hook under `hooks/`; export via
`interface/capabilities.index.ts` + `interface/hooks.index.ts`. Model permission-gated APIs on
`geolocation.ts` (the exemplar).

## Splash policy (opinionated, by design)

The custom React splash renders when the app is **installed**; a plain browser tab serves the pages
instantly. SSR-safe: gated pre-paint off the `data-adaptv-platform` stamp in the critical CSS
(`getCriticalShellCss` in `shell/critical-css.ts`), so the overlay never paints where it's suppressed —
no hydration mismatch, no flash.

| Context | `data-adaptv-platform` | Custom React splash? |
|---|---|---|
| Native (iOS / Android) | `native` | ✅ always |
| Standalone / home-screen PWA (iOS / Android) | `standalone` | ✅ always |
| Browser tab | `web` | ❌ by default — instant pages; `splashScreenInBrowser: true` opts in |

`splashScreenInBrowser` (in `adaptv.config.ts`, default `false`) is the only knob. The gate:
`html[data-adaptv-platform="web"] [data-adaptv-splash]{display:none!important}` (omitted entirely when
`splashScreenInBrowser`). The React splash **self-dismisses by returning `null`** when ready (no `hide`
prop) — `RoutingShell` just mounts it. **One exception:** on a not-found the app's ready signal can never
fire (the boundary skips the layout route it lives in), so `RoutingShell` stops mounting the splash itself
— latched, so navigating back out of a 404 doesn't replay it. → `docs/decisions/register.md` B28.

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
frame on the iOS sim). adaptv **omits it** — the theme-aware pre-paint critical CSS (the WebView's own `html`
background) shows through during the held phase instead, and the real mask colour comes from the launch theme
(Android) / launch-storyboard colour asset (iOS). Manifest `background_color` = `backgroundColor` too.

**Android 12+ system splash** — the OS forces a splash that centres the launcher icon on a background, even
for native apps; it can't be disabled. adaptv neutralises it: the `adaptv` CLI's `patchAndroidSplash` writes a
launch-theme override (`values-v31/styles.xml` platform attrs + `values/styles.xml` AndroidX attrs +
`values{,-night}/colors.xml` + a transparent `drawable/splash_icon.xml`) setting
`windowSplashScreenBackground` = brand colour and `windowSplashScreenAnimatedIcon` = **transparent** → a flat
colour, no icon. Re-applied every `adaptv sync/run android` (idempotent), so it survives `@capacitor/assets`
and re-scaffolds.

**Theme-aware splash** — the splash colour follows the **app** theme (light/dark), not the device system,
like the React splash. Mechanism: adaptv mirrors the theme preference to native storage
(`@capacitor/preferences`, `persistNativeThemePreference` — on change + at startup), and the CLI writes a
**adaptv-owned `MainActivity`** that reads it and calls `UiModeManager.setApplicationNightMode()` (API 31+ —
the only API the OS honours for the system splash) + `AppCompatDelegate.setDefaultNightMode()`. It's applied
at startup (before the window) **and live** — `MainActivity` registers a `SharedPreferences` change listener
on the `CapacitorStorage` file adaptv writes to, so a theme change updates the OS override *immediately*
(`uiMode` is in the activity's `configChanges`, so no WebView reload; `AppCompatDelegate` is startup-only
since it recreates the activity). Because the override persists, the **next** launch's splash is already
correct — **1-launch convergence, no "open twice."** A `"system"` preference (the default) always matches.
Verified on the emulator: app forced dark + system light → **dark** splash; toggle to light → the very next
launch's splash is light.

**iOS** — the CLI (`patchIosTheme`) writes a `AdaptvSplash` colour asset (`Assets.xcassets/AdaptvSplash.colorset`,
light + dark; a fixed mask has no dark variant → theme-independent) and a **solid launch storyboard** that
paints it (no image). For `splashMaskMode: "preferences"` it also patches `AppDelegate` to set
`window.overrideUserInterfaceStyle` from the persisted preference (stripped for the other modes). Known iOS
limit: the **pre-app `LaunchScreen` frame** is drawn from a launch snapshot that resolves a named colour to its
*universal* (light) variant regardless of device appearance — so an adaptive mask shows ~0.3s of the light
colour before the app takes over. It's a single brief frame (verified: no plugin/held flash after it, straight
to the themed app); a fixed mask avoids it entirely.

## The `adaptv` CLI — the only native entrypoint

Consumers never run `cap`, set toolchain env, or call an asset generator by hand. The
**`adaptv` CLI** (`packages/adaptv/bin/adaptv.mjs`, exposed as the `adaptv` bin) owns the whole
lifecycle and resolves `ANDROID_HOME` / `JAVA_HOME` / `pod` / `LANG` itself (an explicit env
var still wins), invoking the *local* `cap` binary directly so it works from a bare shell — not
only through a pnpm script that happened to seed `PATH` (that was the old `cap: command not
found` trap). The frontend scripts are thin aliases:

```
pnpm --filter @repo/frontend native:doctor   # adaptv doctor  — check JDK/SDK/Xcode/pod, print ✓/✗
pnpm --filter @repo/frontend cap:android      # adaptv run android — build SPA → brand assets → sync → launch
pnpm --filter @repo/frontend cap:ios          # adaptv run ios
pnpm --filter @repo/frontend cap:all          # adaptv run all      — both platforms, in parallel
pnpm --filter @repo/frontend cap:ios:ipa      # adaptv build ios    — unsigned archive → .adaptv/builds/<app>.ipa
```

Each `run` does: `vite build` (`ADAPTV_TARGET=capacitor`) + stamp `index.html` → brand assets →
`cap sync <platform>` → `cap run <platform>`. The picker is adaptv's own and caches to
`.adaptv/state.json`: `--target <id>` selects directly, `--latest` reuses the cached device. `sync` and
`assets` are internal steps now, not separate commands.

Toolchain (the CLI resolves these; you just install them):
- **Android** — SDK + a JDK (Android Studio bundles one at `/Applications/Android Studio.app/Contents/jbr/Contents/Home`).
- **iOS** — Xcode + **CocoaPods** (`gem install cocoapods`). The iOS project must be generated with **CocoaPods, not SPM**: `cap add ios --packagemanager CocoaPods`. See the version gotcha below.

**Capacitor version pin (important).** The official plugins (`status-bar`, `app`, …) lag `@capacitor/core`'s latest (their newest is ~8.0.x–8.2.0 vs core 8.4.x) and are built against the 8.0.x Swift API. So the whole core family is pinned to **8.0.2** (`@capacitor/core`/`cli`/`ios`/`android` in the frontend + `@capacitor/core` in adaptv) to match them. **Do not bump core above the plugins** or iOS fails to compile. And use **CocoaPods** on iOS: Capacitor 8's SPM framework (`capacitor-swift-pm`) diverged from the plugins' API (missing `getString`/`reject`/`bridge.webView`), while the CocoaPods framework (npm `@capacitor/ios`, which ships `Capacitor.podspec`) still matches — so SPM won't build, CocoaPods will.

**Plugins live in the APP, not adaptv.** Capacitor auto-discovers plugins by scanning the app's **direct**
dependencies at `cap sync` (writing `capacitor.plugins.json`) — transitive deps (a plugin buried in adaptv's
`dependencies`) are **not** discovered. So the base plugins adaptv's hooks use (`app`, `browser`, `haptics`,
`keyboard`, `network`, `preferences`, `screen-orientation`, `splash-screen`, `status-bar`, `core`) are declared
as **optional `peerDependencies`** of `@repo/adaptv` (a pure-web consumer needs none) and installed as **direct
deps of `apps/frontend`**. `adaptv doctor` prints ✓/✗ per base plugin and the exact install command if any are
missing. There is **no plugin array** in `adaptv.config.ts` — a consumer just installs the plugin and Capacitor
finds it.

**Generated, adaptv-owned, gitignored (never hand-edit):** `capacitor.config.json` is stamped from
`adaptv.config.ts`'s flat `appId` — and *only* for the capacitor target, so a plain web `dev`/`build`
never materialises it. It sets `android.path`/`ios.path` to `.adaptv/android` / `.adaptv/ios`, so the
native projects live **inside the hidden `.adaptv/` dir** (alongside the generated route tree) rather than
at the app root — `capacitor.config.json` itself stays at the root, where `cap` reads it. Those projects
plus `.adaptv/web` and native build artifacts (`Pods/`, `DerivedData/`, `.gradle/`, `build/`) are all
under the already-gitignored `.adaptv/` / gitignored. Treat them like `node_modules`: regenerated, not
authored. A legacy app-root `ios/`/`android/` is moved into `.adaptv/` on the next `adaptv run`.

## App icons + splash — branded, never the Capacitor default

The launcher icon comes from the app's **one icon set** — `icons` in `adaptv.config.ts`, default
`./public/favicons`, the same directory the web manifest is built from. A standard PWA/favicon-generator
output already contains platform-specific art, so adaptv's job is to **pick the right member of that set for
the platform being built**, not to ask for a second source file (→ DECISIONS L8). There are **no splash
PNGs** — the splash is colour-driven (see Splash policy) — so the icon set is the only art adaptv reads.

`bin/lib/icons.mjs` does the picking and the rendering. It classifies each file by *family* from its name
(`maskable` · `android` · `apple` · `ms` · `favicon` · `generic`) and measures its real pixel size from the
file header — names lie, and the resolution warning is only worth printing if it's measured. Family
preference is per platform and inverts on `maskable`: iOS never masks an icon, so safe-zoned art would ship
a logo floating in dead space, while that same art is exactly what Android's adaptive foreground wants.
Resolution beats family when the gap is wide (a 180px `apple-touch-icon` loses to a 512px `android-chrome`
for iOS — upscaling 5.7× is the worse defect), so family only breaks ties among sources that already clear
the platform's bar. A lone `icon.png` is a valid set of one.

adaptv **writes the native icon files itself** rather than shelling out to `@capacitor/assets`: that package
is a ~260-package tree pinned to an old `@capacitor/cli`, whose `sharp` needs a native build step, and the
surface it would generate for us is small and fully known —

| target | written |
| --- | --- |
| iOS | `App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png` — the single 1024px universal slot the scaffolded `Contents.json` declares. **Flattened, alpha channel removed**: App Store Connect rejects an icon that merely *has* one, and it rejects it after the archive. |
| Android | `mipmap-{m,h,xh,xxh,xxxh}dpi/ic_launcher.png` (opaque square), `ic_launcher_round.png` (same art, circular mask), `ic_launcher_foreground.png` (transparent, inset to the 72/108dp safe zone unless the source is already `maskable`), plus `values{,-night}/ic_launcher_background.xml`. The `mipmap-anydpi-v26/*.xml` that wire foreground to background are Capacitor's and already correct — adaptv replaces only the art they point at. |

The **launcher-icon background is `#ffffff`**, not the app's light theme colour: these icons sit on someone
else's home screen, not inside the app, and the PWA set they're derived from is drawn against white too.
`values-night` gets the dark theme colour so a dark home screen resolves the dark brand background.

Warnings are about the **source art only, never adaptv's toolchain**, and none of them fire for a set that
is actually fine — a `!` every project sees is noise, not information (CLI-UX R4/R5). There are three:
nothing usable in the configured dir; a source below the platform's largest slot (1024px iOS, 432px
Android) which adaptv upscales anyway; and an opaque source on Android, where the adaptive foreground has
to be transparent for the launcher to composite and mask it. None is fatal — a bad icon ships Capacitor's
stock mark or a soft one, and neither is a reason to fail someone's build.

That last one is **decoded, not read from the header**, and the difference is the whole warning: a favicon
generator's `android-chrome-512.png` is RGBA with every pixel opaque. Trusting the declared channel branded
the adaptive foreground as a white box floating in the safe zone *and* stayed silent about it — the exact
case the warning exists for. `scanIcons` reads headers (cheap, for ranking); `resolveTransparency` decodes
the ONE file that won the pick.

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

> ⚠︎ **`backend-client` and `VITE_BACKEND_URL` no longer exist** (playground backend removed
> 2026-08-30). Kept as written because this is a *finding*, not a spec: the app it was measured
> against is what made "the origin is `capacitor://localhost`, so cookies are cross-origin and
> bearer tokens are not" observable at all, and rewriting the subject would falsify the
> observation. The finding transfers to any app adaptv ships — read `VITE_BACKEND_URL` as "the
> absolute origin the app calls". Same for the compile-time bullet below.

## Distribution & OTA updates

- **Backend URL is COMPILE-TIME.** `VITE_BACKEND_URL` (`env/.env`) is baked into the bundle. For a
  real device use a **deployed HTTPS** URL — a LAN `http://…` dev IP is unreachable (wrong network
  **and** iOS App Transport Security blocks cleartext; the Capacitor Info.plist has no ATS exception).
  *(That var and its `env/.env` are gone with the playground backend, 2026-08-30 — see the note
  above. The rule is about `VITE_*` and holds for whatever an app puts there. The ATS half has
  since been answered: `adaptv dev` adds the dev exception to `Info.plist` itself and removes it on
  teardown, which is why a SIGKILLed `dev` strands it.)*
- **Android `.apk`** — `adaptv build android` self-signs a debug APK (Gradle builds it at
  `.adaptv/android/app/build/outputs/apk/debug/`; adaptv copies it to `--output` or `.adaptv/builds/<app>.apk`).
- **iOS `.ipa`** — a simulator run makes only `App.app` (simulator slice), never an `.ipa`. `.ipa` is a
  device artifact needing code signing. For **sideloading** (kravasign / AltStore / Sideloadly, which
  re-sign at install), build an **unsigned** `.ipa`: `adaptv build ios` runs `scripts/build-ipa.sh`
  (Release device archive, `CODE_SIGNING_ALLOWED=NO`, packaged `Payload/App.app`) against the project in
  `.adaptv/ios`, then places the `.ipa` at `--output` or `.adaptv/builds/<app>.ipa`. For **TestFlight / App Store**, sign via
  Xcode ▸ Archive ▸ Distribute with your own certificate — never automate the user's credentials.
- **OTA ("update over the air").** The bundle is a snapshot baked into the store build, so by default an
  update = a new store version (App Store review each time). Capacitor's OTA story is **Live Updates**
  (`@capacitor/live-updates` / Capgo / Appflow): host versioned web bundles, the app downloads and
  hot-swaps `webDir` on next launch — allowed for **JS/web-only** changes (Apple guideline 3.3.2). Native
  changes (new plugins, native code) still require a store submission. adaptv produces the static bundle
  those tools ship; it doesn't include a live-update client yet — it's an opt-in layer on top.

## Gotchas

- adaptv carries `@capacitor/*` as hard deps by design — Capacitor is in the bundle on web too,
  just never active. Don't try to make it optional; the hooks depend on it.
- Native "installed app" uses in-memory history (`standaloneMemoryHistory` → `isInstalledApp()`),
  so the OS gesture is inert and the app owns back (Android hardware back → router).
- Keyboard on native currently uses the web `visualViewport` path (works); `@capacitor/keyboard`
  precision + `@capacitor/screen-orientation` lock are follow-on refinements.
- Edge-to-edge on Android native = `StatusBar.setOverlaysWebView(true)` + the `app:`/`p-safe`
  safe-area utilities (which now apply on native). The nav bar is native-theme territory.

---

## Upstream issues to watch (was `RESEARCH.md §3`)

> Absorbed when `RESEARCH.md` (deleted 2026-08-30 — see git history) was dissolved. **Links were last verified
> 2026-07.** Re-check this list before any Capacitor version bump or Android/iOS SDK bump —
> that is the trigger it exists for. The Android-15/SDK-35 item is now tracked as live work
> in [`../roadmap/android-api-36.md`](../roadmap/android-api-36.md).


- **Android 15 / SDK 35 edge-to-edge + keyboard overlap (HIGH RISK).** Android 15 changed how insets +
  window resize interact with the keyboard/system bars; `keyboard-resize` + `keyboard-offset` are no
  longer reliable, and inputs near the bottom get overlapped. Devices < API 35 need explicit layout
  margins to keep old behavior. **Read before hardening adaptv's edge-to-edge/keyboard:**
  - Capacitor core issue — edge-to-edge < API 35 broken: <https://github.com/ionic-team/capacitor/issues/7951>
  - capawesome keyboard/edge-to-edge bugs: <https://github.com/capawesome-team/capacitor-plugins/issues/490> · <https://github.com/capawesome-team/capacitor-plugins/issues/428>
  - The community fix plugin (study its approach, or depend on it): <https://capawesome.io/docs/plugins/android-edge-to-edge-support/>
  - Config lesson from the field: `Keyboard` with `resizeOnFullScreen: false`; don't trust `resize:"ionic"`.
- **Version pinning.** Core vs official plugins vs Xcode/Swift toolchain — adaptv already pins a
  known-good set; keep it (see `docs/research/capacitor-internals.md`).

