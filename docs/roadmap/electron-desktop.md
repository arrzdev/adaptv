# adaptv — native desktop through Electron

> **Status: direction recorded 2026-10-04 ("not yet, but in the future"). Not built, not designed,
> not ranked above current work.** Nothing here has been spiked: the Electron column below is read
> from Electron's documented API, not from a build. The inventory of what adaptv calls today is read
> from the code at `58fa2d8` (`main`, 2026-10-04).
>
> **Size: large. Risk: medium** — most of it is additive, but it asks one question of the platform
> model that every native branch in `src/` depends on (§4, Q1).

---

## 1. The goal

An adaptv app runs as a native desktop app through **Electron**, the same way it runs as a native
mobile app through **Capacitor** today. The same app code works, unchanged, on four hosts: browser
tab, installed PWA, Capacitor (iOS/Android) and Electron (macOS/Windows/Linux).

The way there is the one adaptv already took for mobile: **every native API the app reaches goes
through adaptv's own interface**, and the interface picks a backend per host. Register **L20**
already requires it — the consumer never names, installs or imports the packages underneath — so
Electron is a fourth backend behind interfaces that mostly exist, not a new surface. What does not
exist yet is (a) a host model with a fourth shell, (b) the places where adaptv itself calls
Capacitor outside those interfaces, and (c) a build and packaging target.

## 2. What adaptv reaches today

### 2a. Wrapped — the app reaches these only through adaptv

Each row is a module in `src/capabilities/`, exported from `adaptv/capabilities` (and
mostly through a hook in `adaptv/hooks`). The module imports the Capacitor plugin and
branches on `isNativePlatform()` / `hasNativePlugin()`; the consumer never sees the plugin.

| Module | Capacitor plugin | Public surface (abridged) |
|---|---|---|
| `app-info.ts` | `@capacitor/app` | `getAppInfo` |
| `app-state.ts` | `@capacitor/app` (`resume`/`pause`) | `getAppState`, `subscribeAppState`, `onResume`, `onPause` |
| `url-open.ts` | `@capacitor/app` (`appUrlOpen`) | `onUrlOpened` (router owns `installUrlOpen`) |
| `battery.ts` | `@capacitor/device` | `getBatteryState`, `subscribeBattery` |
| `device.ts` | `@capacitor/device` | `getDeviceInfo`, `getDeviceId` |
| `browser.ts` | `@capacitor/browser` | `openExternal`, `isExternalUrl`; `<ExternalLink>` |
| `clipboard.ts` | `@capacitor/clipboard` | `writeClipboardText`, `readClipboardText`, `checkClipboardReadPermission` |
| `compose.ts` | `@capacitor/app-launcher` | `composeMail`, `composeSms`, `getComposeSupport` |
| `filesystem.ts` | `@capacitor/filesystem` | `writeFile`, `readFile`, `readTextFile`, `listFiles`, `statFile`, `getFileUri`, `deleteFile` |
| `geolocation.ts` | `@capacitor/geolocation` | `getCurrentPosition`, `checkGeoPermission`, `requestGeoPermission` |
| `haptics.ts` | `@capacitor/haptics` | `haptics` |
| `keyboard.ts` | `@capacitor/keyboard` | `initNativeKeyboard`, `hasNativeKeyboard`, `subscribeNativeKeyboard` |
| `network.ts` | `@capacitor/network` | `getOnline`, `subscribeOnline` |
| `notifications.ts` | `@capacitor/local-notifications` | `notify`, `scheduleNotification`, `listScheduledNotifications`, `cancelNotification`, `onNotificationOpened`, permission calls |
| `orientation.ts` | `@capacitor/screen-orientation` | `getScreenOrientation`, `lockScreenOrientation`, `unlockScreenOrientation`, `subscribeScreenOrientation` |
| `privacy-screen.ts` | `@capacitor/privacy-screen` | `enablePrivacyScreen`, `disablePrivacyScreen`, `readPrivacyScreen` |
| `screen-reader.ts` | `@capacitor/screen-reader` | `getScreenReaderState`, `subscribeScreenReader`, `announce` |
| `share.ts` | `@capacitor/share` | `share`, `canShareTarget` |
| `splash.ts` | `@capacitor/splash-screen` | `hideNativeSplash` |
| `status-bar.ts` | `@capacitor/status-bar`, `SystemBars` from `@capacitor/core` | `applyStatusBar`, `enableEdgeToEdge`, `reprobeAndroidInsets` |
| `native-theme.ts`, `keyboard-height-cache.ts` | `@capacitor/preferences` (dynamic import) | internal: the persisted theme and the keyboard height prediction |
| `src/storage/kv.ts` | `@capacitor/preferences` | `storage.kv` |
| `src/storage/secure.ts` | `@aparajita/capacitor-secure-storage`, through `virtual:adaptv/secure-storage` | `storage.secure` |

Capabilities with **no native plugin** — they run on web APIs in every host, and an Electron host
gets them for free as long as Chromium provides the API: `back-chain`, `gesture-controller`,
`haptic-tick`, `keep-awake` (Screen Wake Lock), `locale`, `motion`, `print`, `speech`
(`speechSynthesis`), `theme-color`.

### 2b. Used directly — adaptv code that calls Capacitor outside an interface

These are the places a fourth host would have to be threaded through by hand. None is reachable by
the consumer; all are adaptv's own code.

| Where | What it calls | Why it matters for Electron |
|---|---|---|
| `src/utils/platform.ts` | the `window.Capacitor` global (`isNativePlatform`, `getPlatform`) | It *is* the host model: `PlatformTag` is `web \| standalone \| native`, and `native` means Capacitor. |
| `src/utils/native-plugins.ts` | `Capacitor.PluginHeaders` | `hasNativePlugin()` answers "is this plugin compiled into the binary"; there is no Electron equivalent of the question. |
| `src/hooks/use-android-back-button.ts` | `App.addListener("backButton")` from `@capacitor/app` | A hook calling a plugin directly, not through `capabilities/`. Android-only; desktop has no back key. |
| `src/ota/updater.ts` | `CapacitorHttp` from `@capacitor/core`; `@capawesome/capacitor-live-update` (dynamic) | OTA is Capacitor-shaped end to end: the native HTTP path that escapes CORS, and the plugin that swaps the bundle. |
| `src/shell/boot-fallback.ts` | inline script reading `window.Capacitor.Plugins.LiveUpdate` and `.SplashScreen` | Runs before the bundle, so it cannot go through any module. |
| `src/shell/native-dev-boot-watchdog.ts` | inline script reading `window.Capacitor.isNativePlatform()` | Dev loop only. |
| `src/shell/service-worker-shell.ts` | — (rule: "Capacitor never gets a service worker") | The same decision is owed for Electron. |
| `src/vite/capacitor-config.ts`, `src/native/*`, `bin/lib/native.mjs` | Capacitor project, config, doctor, privacy manifest | The build and CLI side; Electron needs its own (§3, last rows). |

The capability modules also import every `@capacitor/*` plugin **statically**, so the Capacitor JS
(and each plugin's `web` fallback) is in every build, including the web one. That works today
because the branch is chosen at run time; an Electron backend should be chosen the same way, or the
static imports become per-host modules — that choice is Q2.

## 3. What an Electron backend for each wrapped API would need

The common shape: a **preload script** exposes one narrow bridge with `contextBridge` (context
isolation on, `nodeIntegration` off), and the **main process** answers it over IPC with Electron's
own modules. The renderer never gets Node. "Web branch" means the capability's existing browser
code already does the job inside Electron's Chromium and no bridge call is needed.

| Wrapped API | Electron backend | Notes |
|---|---|---|
| `app-info` | `app.getName()`, `app.getVersion()` | Build number has no direct analogue; carry it from the build. |
| `app-state` | Web branch (`visibilitychange`), or `BrowserWindow` `minimize`/`restore`/`hide`/`show`/`focus`/`blur` | Decide what "background" means on desktop: minimised, hidden, or unfocused. |
| `url-open` | `app.setAsDefaultProtocolClient()`; `open-url` (macOS); `requestSingleInstanceLock()` + `second-instance` argv (Windows, Linux) | Deep links need the scheme registered at install time by the packager. |
| `battery` | Web branch (Battery Status API in Chromium), or `powerMonitor` (`on-battery`/`on-ac`) | `powerMonitor` gives power source, not level. |
| `device` | `process.platform`, `os.release()`, `process.versions.electron` in main | `getDeviceId`: a random id stored under `app.getPath("userData")` — there is no stable hardware id, and there should not be. |
| `browser` / `<ExternalLink>` | `shell.openExternal()`, plus `webContents.setWindowOpenHandler` and `will-navigate` to stop external URLs opening inside the app window | The second half is a security requirement, not a nicety. |
| `clipboard` | Electron `clipboard` module, or the web branch | The web branch needs a secure origin (see the protocol row). |
| `compose` | `shell.openExternal("mailto:…")` | `composeSms` is `unsupported` on desktop; `getComposeSupport` already has the vocabulary. |
| `filesystem` | `fs/promises` in main, rooted per `FileScope` at `app.getPath("userData" \| "documents" \| "temp")` | The bridge must refuse paths that escape the root. `getFileUri` needs a custom protocol to serve stored files. |
| `geolocation` | Web branch | Whether Chromium's `navigator.geolocation` has a working provider inside Electron on each OS is unverified (Q6). |
| `haptics` | None — `unsupported` / no-op | Electron exposes no haptic API. |
| `keyboard` | None — `hasNativeKeyboard()` is `false` | No on-screen keyboard to track; touch laptops fall to the web branch. |
| `network` | Web branch (`navigator.onLine`), or `net.isOnline()` in main | |
| `notifications` | Electron `Notification` in main (`click` → `onNotificationOpened`) | `scheduleNotification` has no OS scheduler: a timer dies with the app. Either `unsupported`, or "while running" with a caveat (Q5). |
| `orientation` | None — `unsupported` | |
| `privacy-screen` | `BrowserWindow.setContentProtection(true)` | macOS and Windows only; Linux reports `unsupported`. |
| `screen-reader` | `app.isAccessibilitySupportEnabled()` + `accessibility-support-changed`; `announce` stays the web branch (live region) | |
| `share` | `ShareMenu` on macOS; `unsupported` elsewhere | Whether Web Share works in Electron's Chromium is unverified. |
| `splash` | Create the window with `show: false` and show it on `ready-to-show`, or from `hideNativeSplash` over IPC | Same contract: the app says when its first frame is ready. |
| `status-bar` | Window chrome: `titleBarStyle: "hidden"` + `titleBarOverlay` colours, `nativeTheme.themeSource` | `enableEdgeToEdge` maps to a hidden title bar with the content under it (Window Controls Overlay, `titlebar-area-*` env vars). `reprobeAndroidInsets` is a no-op. |
| `storage.kv` | Web branch (`localStorage`, persisted under `userData`) | Only if the app has a stable origin — not `file://`. |
| `storage.secure` | `safeStorage.encryptString()` + a file under `userData` | On Linux without a secret service `safeStorage` falls back to a hard-coded key; `storage.secure` must refuse there the way it refuses on the web. |
| `native-theme`, `keyboard-height-cache` | Follow `storage.kv` | Internal. |

And the parts that are not a capability:

| Part | What Electron needs |
|---|---|
| **Origin** | Serve the built app from a privileged custom scheme (`protocol.handle`), not `file://`, so storage, clipboard, cookies and the router get a stable secure origin — the role `capacitor://localhost` plays on iOS. |
| **OTA** | Two separate problems: the binary (`autoUpdater`, which wants signed builds) and the bundle (adaptv's own zip, which could be served from `userData` by the same protocol handler; `net.fetch` in main replaces `CapacitorHttp`). |
| **Build and CLI** | An `electron` target in `bin/` — prepare, dev with live reload, package for three OSes — under the CLI contract (`docs/design/cli-contract.md`). |
| **Packaging and signing** | macOS notarisation and Windows code signing cost money (a developer account, a certificate). That is a board decision under the company rules before any release, not before the work. |

## 4. Open questions

| # | Question | Why it matters |
|---|---|---|
| Q1 | **Host model.** Is Electron a fourth `PlatformTag` (`web \| standalone \| native \| desktop`), or does `native` widen to "a native shell" with a second axis for which one? | Every `isNativePlatform()` branch today assumes Capacitor plugins are callable. A fourth tag keeps them correct and adds work at each site; widening `native` risks Electron taking Capacitor branches. The `app:` CSS variant and the `"app"` ui scope (`isInstalledApp()`) presumably include it either way. |
| Q2 | **Backend dispatch.** Run-time branch per call (today's pattern), or one backend module per host chosen at build time? | Run-time keeps one bundle but ships every backend to every host; build-time is smaller but needs a host-specific build of the same app. It touches every file in §2a. |
| Q3 | **Does adaptv own the main process?** Ship a fixed main + preload (the consumer writes none), or let the consumer extend it? | L20 points to "adaptv owns it". A consumer who needs a menu bar or tray will want a hook. |
| Q4 | **Server functions.** Electron has a Node main process, but L3 holds: adaptv has no server side on any target (owner, 2026-10-05), so Electron refuses them like every other build. Open only whether the main process may host anything app-defined at all. | A local server would make Electron a third rendering target, not a fourth host. |
| Q5 | **Capability semantics on desktop.** `scheduleNotification` with no OS scheduler; `app-state` "background" with several windows; `orientation` and `haptics` as plain `unsupported`. | Each is a consumer-visible answer, so each wants a line in the capability's doc before code. |
| Q6 | **Geolocation and Web Share inside Electron.** Do Chromium's providers work there on each OS, or do these need a main-process backend? | Decides two rows of §3; a short spike answers it when the work starts. |
| Q7 | **Multiple windows.** Is an adaptv desktop app one window, or can it open more? | Back chain, app state, theme sync and storage events all assume one document. |
| Q8 | **Service worker.** Capacitor never gets one. Same rule for Electron? | The custom protocol serves files directly, so the SW buys little and adds a cache to invalidate. |
| Q9 | **Order.** After the `dist` cutover and the core/binding split? | Both move the files this touches; doing this first means doing parts of it twice. |
