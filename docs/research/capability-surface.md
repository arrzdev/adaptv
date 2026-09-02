# adaptv — capability surface research: the device APIs

> The device-API counterpart to `docs/research/component-surface.md`. Same premise, applied to the layer that
> touches hardware and OS services: **what did Expo, React Native and Capacitor each decide is worth
> shipping as a first-party device API**, what do those interfaces look like, and where does adaptv's
> `src/capabilities/` sit against them.
>
> This layer is the more directly actionable of the two, because adaptv's architecture already
> matches it — Expo's `expo-*` module + hook split is, independently, the same design as adaptv's
> `capabilities/` (no React) + `hooks/` (React wrapper) split. The gap is coverage, not shape.

**Sources — read from published packages at these versions:**

| Roster | How read | Count |
|---|---|---|
| Expo SDK | `expo@57.0.8` `bundledNativeModules.json`, then **50 `expo-*` packages** downloaded and their `build/**/*.d.ts` parsed | 123 listed / 50 inventoried |
| React Native non-visual APIs | `react-native@0.86.2` `types/index.d.ts` export list | ~30 |
| Capacitor | npm registry probe of `@capacitor/*` | **33 official plugins** |
| adaptv today | `src/interface/capabilities.index.ts`, `hooks.index.ts`, `src/storage/`, `src/ota/`, `package.json` | **19 capability modules + 28 hook modules** (re-counted 2026-09-02 with `locale`; on 2026-08-30 this row said 17 + 23 and §4 said 12 — neither matched the barrel) |

---

## 1. The three rosters

### 1.1 Expo — 50 capability modules inventoried

`expo-application` · `expo-apple-authentication` · `expo-asset` · `expo-audio` · `expo-auth-session` ·
`expo-background-task` · `expo-battery` · `expo-brightness` · `expo-calendar` · `expo-cellular` ·
`expo-clipboard` · `expo-constants` · `expo-contacts` · `expo-crypto` · `expo-device` ·
`expo-document-picker` · `expo-file-system` · `expo-font` · `expo-haptics` ·
`expo-image-manipulator` · `expo-image-picker` · `expo-intent-launcher` · `expo-keep-awake` ·
`expo-linking` · `expo-local-authentication` · `expo-localization` · `expo-location` ·
`expo-mail-composer` · `expo-media-library` · `expo-navigation-bar` · `expo-network` ·
`expo-notifications` · `expo-print` · `expo-screen-capture` · `expo-screen-orientation` ·
`expo-secure-store` · `expo-sensors` · `expo-sharing` · `expo-sms` · `expo-speech` ·
`expo-splash-screen` · `expo-sqlite` · `expo-status-bar` · `expo-store-review` · `expo-system-ui` ·
`expo-task-manager` · `expo-tracking-transparency` · `expo-updates` · `expo-video-thumbnails` ·
`expo-web-browser`

### 1.2 React Native core — non-visual APIs

`Alert` · `ActionSheetIOS` · `ToastAndroid` · `Share` · `Linking` · `Clipboard` · `Vibration` ·
`Appearance` · `AppState` · `BackHandler` · `Dimensions` · `PixelRatio` · `Platform` · `Keyboard` ·
`I18nManager` · `AccessibilityInfo` · `PermissionsAndroid` · `PushNotificationIOS` · `Settings` ·
`DevSettings` · `LayoutAnimation` · `PanResponder` · `InteractionManager` · `Animated` · `Easing` ·
`AppRegistry` · `UIManager` · `NativeModules` · `NativeEventEmitter` · `LogBox` · `Systrace`

### 1.3 Capacitor — 33 official plugins

`action-sheet` · `app` · `app-launcher` · `background-runner` · `barcode-scanner` · `browser` ·
`camera` · `clipboard` · `contacts` · `device` · `dialog` · `file-transfer` · `file-viewer` ·
`filesystem` · `geolocation` · `google-maps` · `haptics` · `inappbrowser` · `keyboard` ·
`local-notifications` · `motion` · `network` · `preferences` · `privacy-screen` ·
`push-notifications` · `screen-orientation` · `screen-reader` · `share` · `splash-screen` ·
`status-bar` · `text-zoom` · `toast` · `watch`

**Not official** (community-only, verified absent from the `@capacitor` scope): biometrics, NFC,
secure-storage, SQLite. Those four are the ones where adaptv would be doing real native work rather
than wiring a maintained plugin — `storage.secure` already carries that cost deliberately.

---

## 2. Domain-by-domain, with the web column

The **Web** column is the one Ionic's and Expo's tables don't have and adaptv does: a large fraction
of `expo-*` exists purely because React Native has no DOM. Where a browser API is real and shipping,
adaptv's web tier is free and only the native tier needs a plugin.

| Domain | Expo | RN core | Capacitor | Web platform | adaptv today |
|---|---|---|---|---|---|
| Haptics / vibration | `expo-haptics` | `Vibration` | ✅ `haptics` | `navigator.vibrate` (no iOS Safari) | ✅ `haptics`, `haptic-tick`, `useVibrate` |
| Network state | `expo-network` | — | ✅ `network` | `navigator.onLine` + NetInfo API | ✅ `network`, `useIsOffline` |
| Geolocation | `expo-location` | — | ✅ `geolocation` | `navigator.geolocation` | ✅ `geolocation`, `useGeolocation` |
| App lifecycle | — (`AppState`) | `AppState` | ✅ `app` | `visibilitychange` | ✅ `app-state` |
| Hardware back | — | `BackHandler` | ✅ `app` (`backButton`) | `popstate` | ✅ `back-chain`, `useAndroidBackButton` |
| Keyboard | — | `Keyboard` | ✅ `keyboard` | `visualViewport` | ✅ `keyboard`, `useKeyboard` |
| Status bar | `expo-status-bar` | `StatusBar` | ✅ `status-bar` | `theme-color` meta | ✅ `status-bar`, `useStatusBar` |
| Theme / dark mode | — | `Appearance` | — | `prefers-color-scheme` | ✅ `native-theme`, `useTheme` |
| Splash | `expo-splash-screen` | — | ✅ `splash-screen` | manifest | ✅ `splash`, `PwaSplashOverlay` |
| In-app browser | `expo-web-browser` | `Linking` | ✅ `browser`, `inappbrowser` | `window.open` | ✅ `browser`, `ExternalLink` |
| KV storage | — | — | ✅ `preferences` | `localStorage` | ✅ `storage.kv` |
| Secure storage | `expo-secure-store` | — | ❌ community | **none** (documented) | ✅ `storage.secure` |
| OTA updates | `expo-updates` | — | — | service worker | ✅ `src/ota/` |
| Gesture arbitration | (`react-native-gesture-handler`) | `PanResponder` | — | Pointer Events | ✅ `gesture-controller`, `useGestureEngine` |
| Share | `expo-sharing` | `Share` | ✅ `share` | **Web Share API** | ✅ `share`, `useShare` |
| Clipboard | `expo-clipboard` | `Clipboard` | ✅ `clipboard` | `navigator.clipboard` | ✅ `clipboard`, `useClipboard` |
| **Native dialogs** | — | `Alert` | ✅ `dialog` | `alert/confirm/prompt` | ❌ |
| **Native action sheet** | — | `ActionSheetIOS` | ✅ `action-sheet` | — | ❌ |
| **Native toast** | — | `ToastAndroid` | ✅ `toast` | — | ❌ |
| Device info | `expo-device`, `expo-application` | `Platform`, `Dimensions` | ✅ `device` | `userAgentData` | ✅ `device`, `useDevice` |
| Screen orientation | `expo-screen-orientation` | — | ✅ `screen-orientation` | `screen.orientation.lock()` | ✅ `orientation`, `useOrientation` |
| Keep awake | `expo-keep-awake` | — | ❌ community | **Screen Wake Lock API** | ✅ `keep-awake`, `useKeepAwake` — holds the screen in the Android WebView (dumpsys, 2026-09-02); the WKWebView takes Safari's disabler |
| **Local notifications** | `expo-notifications` | — | ✅ `local-notifications` | Notification API + SW | ❌ |
| **Push notifications** | `expo-notifications` | `PushNotificationIOS` | ✅ `push-notifications` | Push API + SW | ❌ |
| **Camera capture** | `expo-camera` | — | ✅ `camera` | `getUserMedia` | ❌ |
| **Image / file picking** | `expo-image-picker`, `expo-document-picker` | — | ✅ `camera` | `<input type=file>` | ❌ |
| **Filesystem** | `expo-file-system` | — | ✅ `filesystem`, `file-transfer` | OPFS / File System Access | ❌ |
| **Biometrics** | `expo-local-authentication` | — | ❌ community | **WebAuthn** | ❌ |
| **App launcher / can-open** | `expo-linking`, `expo-intent-launcher` | `Linking` | ✅ `app-launcher` | scheme URLs | ⚠️ `ExternalLink` only |
| **Screen reader state** | — | `AccessibilityInfo` | ✅ `screen-reader` | ARIA is native | ⚠️ ARIA free; no state accessor |
| Motion / sensors | `expo-sensors` | — | ✅ `motion` | DeviceMotion / Generic Sensor | ❌ |
| Battery | `expo-battery` | — | — | Battery Status (Chromium) | ❌ |
| Brightness | `expo-brightness` | — | — | none | ❌ |
| Contacts | `expo-contacts` | — | ✅ `contacts` | Contact Picker (Chromium/Android) | ❌ |
| Calendar | `expo-calendar` | — | — | none | ❌ |
| SMS / mail | `expo-sms`, `expo-mail-composer` | `Linking` | — | `sms:` / `mailto:` | ❌ |
| Print | `expo-print` | — | — | `window.print()` | ❌ |
| Speech | `expo-speech` | — | — | SpeechSynthesis | ❌ |
| Store review | `expo-store-review` | — | — | none | ❌ |
| Screen-capture block | `expo-screen-capture` | — | ✅ `privacy-screen` | none | ❌ |
| Localization | `expo-localization` | `I18nManager` | — | `Intl` | ✅ `locale` — the tag, direction, hour cycle, week shape, separators, zone, calendar; see the note under the table |
| Fonts | `expo-font` | — | — | `@font-face` | ❌ (CSS) |
| Audio / video playback | `expo-audio`, `expo-video` | — | — | `<audio>`/`<video>`, WebAudio | ❌ (DOM) |
| SQL database | `expo-sqlite` | — | ❌ community | OPFS + wa-sqlite | ❌ |
| Crypto | `expo-crypto` | — | — | `crypto.subtle` | ❌ (Web Crypto) |
| Background tasks | `expo-background-task`, `expo-task-manager` | — | ✅ `background-runner` | Background Sync (SW) | ❌ |
| Android nav bar | `expo-navigation-bar` | — | — | none | ⚠️ handled in native shell |
| Barcode scanning | `expo-camera` (built in) | — | ✅ `barcode-scanner` | BarcodeDetector (Chromium) | ❌ |
| Text zoom / dynamic type | — | `PixelRatio` | ✅ `text-zoom` | `rem` + browser zoom | ❌ |

**Localization has one quirk that decides its shape** (measured 2026-09-02, Pixel 10 emulator API 37,
Android System WebView Chrome/149, an adaptv-built APK read over CDP, the language changed per app):
`navigator.language` follows the OS in the same process (en-US → pt-PT → ar-EG), but the engine's
*default* `Intl` locale is frozen at process start — `toLocaleTimeString(undefined, …)` kept printing
"3:07 PM" while `toLocaleTimeString("pt-PT", …)` printed "15:07". So `locale` passes the tag to every
`Intl` call and never trusts the default, and a consumer has to do the same with `languageTag`. The
per-app change also reloads the WebView document in place, so on Android native the record is right
at boot and `languagechange` never fires; the subscription is for the browser tab and the installed
PWA. iOS was measured separately — see the `locale` capability's header.

---

## 3. The interface conventions in this layer

Expo's capability modules are far more uniform than its component surface, and the uniformity is
where the value is. Six contracts hold across dozens of packages.

### 3.1 The permission triple — one shape, ~14 modules

```ts
getXPermissionsAsync():     Promise<PermissionResponse>
requestXPermissionsAsync(): Promise<PermissionResponse>
useXPermissions(options?: PermissionHookOptions): [PermissionResponse | null, requestFn, getFn]
```

Present in `expo-brightness`, `expo-calendar` (×2 — calendar and reminders), `expo-camera` (×2 —
camera and microphone), `expo-cellular`, `expo-contacts`, `expo-image-picker` (×2), `expo-location`
(×3 — foreground, background, motion-activity), `expo-maps`, `expo-media-library`,
`expo-notifications`, `expo-screen-capture`, `expo-tracking-transparency`, `expo-audio`.

`PermissionResponse` carries `{ status, granted, canAskAgain, expires }`.

**adaptv already has a permission model, and on one axis it is the better one.**
`src/capabilities/geolocation.ts` declares itself *"the exemplar for every permission-gated device
API"* and normalises to a four-state enum:

```ts
export type GeoPermission = "granted" | "denied" | "prompt" | "unavailable"
```

The docblock is explicit that `"unavailable"` is *not* a permission — it means prompting is pointless
— and that `"denied"` sends the user to **app** settings while `"unavailable"` sends them to
**system** settings or nowhere. Expo splits exactly that distinction across two different calls
(`isAvailableAsync()` in §3.2 versus the permission response), so a caller has to know to ask twice.
Folding it into one enum is a genuinely cleaner contract, and adaptv also already normalises
Android's `"prompt-with-rationale"` into `"prompt"`.

The one thing Expo's shape has and adaptv's doesn't is **`canAskAgain`** — the difference between
"denied, you may ask again" and "denied permanently, the only path is Settings". That distinction is
the most commonly botched thing in permission UX, and it is the single concrete thing to take from
§3.1: a fifth state (or a companion flag) on the existing four-state shape, applied uniformly as more
permission-gated capabilities land.

### 3.2 `isAvailableAsync()` — never throw for "not on this platform"

`expo-battery` · `expo-brightness` · `expo-calendar` · `expo-contacts` · `expo-keep-awake` ·
`expo-mail-composer` · `expo-media-library` · `expo-screen-capture` · `expo-sensors` ·
`expo-sharing` · `expo-sms` · `expo-store-review` · `expo-task-manager` ·
`expo-apple-authentication`, plus the specialised variants `LocalAuthentication.hasHardwareAsync()` /
`isEnrolledAsync()`, `Clipboard.isPasteButtonAvailable`, `GlassEffect.isLiquidGlassAvailable()`.

A capability that doesn't exist on the current platform returns `false` from a probe rather than
throwing from the call. For adaptv, which has *three* targets (web, PWA, native) rather than two,
this matters more, not less — the web tier will be the `false` branch constantly.

Note the divergence with §3.1: for permission-gated capabilities adaptv folds this into the
permission enum as `"unavailable"` and needs no separate probe. For capabilities that need **no**
permission but still may not exist (share, keep-awake, clipboard-image, vibration on iOS Safari),
there is no equivalent today and Expo's boolean probe is the right shape to adopt.

### 3.3 Imperative core + hook wrapper — the split adaptv already made

Roughly half the modules ship both. `useBatteryLevel` / `useBatteryState` / `useLowPowerMode` /
`usePowerState` · `useNetworkState` · `useLocales` / `useCalendars` · `useKeepAwake` ·
`usePreventScreenCapture` · `useVisibility` · `useURL` / `useLinkingURL` · `useUpdates` ·
`useLastNotificationResponse` · `useIncomingShare` · `useFonts` · `useAssets` · `useSQLiteContext` ·
`useAudioPlayer` / `useAudioPlayerStatus` / `useAudioRecorderState` · `useImageManipulator`.

Every one is a thin wrapper over an imperative core that remains separately importable.

> `capabilities.index.ts` already says this in prose — *"Platform-branching device capability
> accessors (no React). Hooks in `@arrzdev/adaptv/hooks` wrap these; import them directly for
> non-React wiring."* Expo arrived at the identical split independently. That is a design worth
> treating as settled, and worth citing as such.

### 3.4 Constants for the immutable, functions for the mutable

`expo-device` exposes `brand`, `manufacturer`, `modelName`, `modelId`, `designName`, `osName`,
`osVersion`, `osBuildId`, `platformApiLevel`, `deviceYearClass`, `totalMemory`,
`supportedCpuArchitectures`, `isDevice` as **plain exported constants** — and
`getMaxMemoryAsync()`, `getUptimeAsync()`, `hasPlatformFeatureAsync()`, `isRootedExperimentalAsync()`
as functions. `expo-application` and `expo-updates` do the same (`applicationId`,
`nativeApplicationVersion`; `channel`, `runtimeVersion`, `updateId`, `isEmbeddedLaunch`).

The rule is legible from the API alone: **if it cannot change during the process lifetime, it's a
constant; if it can, it's a call.** No `getBrandAsync()`.

### 3.5 Sync/async pairs where the platform genuinely allows sync

`SecureStore.getItem` / `getItemAsync`, `setItem` / `setItemAsync` · `SQLite.openDatabaseSync` /
`openDatabaseAsync` (and `deleteDatabase*`, `backupDatabase*`, `deserializeDatabase*`) ·
`Calendar.getDefaultCalendarSync` / `getDefaultCalendarAsync`, `getSourcesSync` / `getSourcesAsync` ·
`Notifications.getLastNotificationResponse` / `…Async` · `Sharing.getSharedPayloads` /
`getResolvedSharedPayloadsAsync` · `Linking.getLinkingURL` (sync) / `getInitialURL` (async).

Shipped as *pairs*, not as an async-only API with a sync escape hatch bolted on later. This is the
same argument `storage.kv` already makes in its own docblock — a synchronous read is what lets a
feature flag be readable during render instead of forcing a loading state onto every consumer.

### 3.6 Background work is a **named task registry**, not a closure

The one genuinely non-obvious design in the whole layer, forced by the platform: the JS context is
destroyed between background invocations, so a callback reference cannot survive. The handle has to
be a string, registered at module scope.

```ts
TaskManager.defineTask(taskName, executor)              // module scope, runs at import
BackgroundTask.registerTaskAsync(taskName, options)
Location.startLocationUpdatesAsync(taskName, options)
Location.startGeofencingAsync(taskName, regions)
Notifications.registerTaskAsync(taskName)
TaskManager.isTaskDefined(name) / isTaskRegisteredAsync(name) / unregisterTaskAsync(name)
```

adaptv's service-worker tier has the same property (the SW is killed and restarted), so if
background work is ever in scope, this is the shape — not a callback.

### 3.7 Subscriptions and shared native handles

Every listener returns an `EventSubscription` with `.remove()`; several modules additionally export
`removeXListener(subscription)` and `removeAllXListeners()` for symmetry with older code.

`SharedRef<'image'>` / `SharedObject` is the cross-module handle: `expo-image`'s `ImageRef`,
`expo-image-manipulator`'s `useImageManipulator(source: string | SharedRef<'image'>)`, and
`Link.MenuAction`'s `image` prop all pass a **native object between modules without serializing it
through JS**. `@expo/ui`'s `ObservableState` (§5.2 of `docs/research/component-surface.md`) is the same primitive
used for state instead of assets.

---

## 4. Gap analysis for adaptv

> **The remainder of this section is now tracked at**
> [`../roadmap/capability-gaps.md`](../roadmap/capability-gaps.md), which is the single not-done
> list. What is below is the reasoning; that file is what is left.

adaptv has **18 capability modules** — the twelve this section originally listed (`app-state`,
`back-chain`, `browser`, `geolocation`, `gesture-controller`, `haptic-tick`, `haptics`, `keyboard`,
`native-theme`, `network`, `splash`, `status-bar`) plus the five Tier-1 additions below **and
`theme-color`**, which this doc omitted from both of its counts despite it being a shipped
capability with 8 exported symbols (`src/capabilities/theme-color.ts`, PR #64) that drives per-route
browser-chrome tinting. Add the three storage tiers and `ota/`. Ranked by *validated demand × cost*,
where cost is low when both an official Capacitor plugin **and** a real browser API exist.

> ⚠︎ **H6 — three probes named below are not consumer API.** `isShareSupported()`, the clipboard
> write probe and keep-awake's `supported` are **deliberately withheld** from the public barrel:
> `src/interface/capabilities.index.ts` states the rule and `capabilities.barrel.test.ts` enforces
> it. A standalone predicate is a second way to ask a question the surface already answers, and two
> answers can disagree. Read them here as internal shape, not as surface a consumer can call.

### ✅ Tier 1 — shipped

All five landed **2026-07-29**, each with an accessor, a hook, colocated tests covering the
degradation paths, and a lab page that renders the unsupported state visibly.

| Capability | Shape it landed with |
|---|---|
| `share` | **Two** probes, not one: `isShareSupported()` (platform) and `canShareTarget(t)` (payload). Checking only the first ships a button that throws on desktop Chrome; checking only the second ships one that silently does nothing. |
| `clipboard` | Write is a boolean probe; read uses the four-state permission enum. The asymmetry is real (read is permission-gated on web, write generally is not) and is deliberately **not** flattened. |
| `device` | Memoised `getDeviceInfo()`; delegates `platform`/`os` to `utils/platform` rather than re-detecting. §3.4's constants-vs-functions rule is kept in spirit — Capacitor's bridge has no sync path. |
| `orientation` | read · subscribe · lock · unlock, with `"ok" \| "unsupported" \| "rejected"` as three distinct outcomes. Chromium rejects a lock outside fullscreen; **iOS reports `unsupported` outright**. |
| `keep-awake` | Screen Wake Lock only — no community plugin was added without a decision, and the native runs of 2026-09-02 showed none is needed. **Android WebView: supported and it holds the screen** (Pixel 10 emulator API 36, WebView Chrome/149.0.7827.5, `adaptv build android`): `adb shell dumpsys power` shows a `SCREEN_BRIGHT_WAKE_LOCK 'WindowManager/displayId:0'` row attributed to the app's package while held and none after `release()`; at a 15 s `screen_off_timeout` the display is `Asleep` 25 s after a release and `Awake` 25 s after a request, the row at ACQ=-27s. caniwebview's "unsupported" is wrong for this WebView. **WKWebView: the same WebCore disabler as Safari**, taken by the app's own UI process (iPhone 17 Pro simulator, iOS 26.1): `ScreenSleepDisabler::updateState() shouldKeepScreenAwake=1` at the request, `=0` at the release, the identical line MobileSafari logs for the same page; `isIdleTimerDisabled` stays NO, so it is not the idle-timer property. The simulator never idle-locks, so the lit screen is owed to a physical iPhone (`../roadmap/owed-device-verification.md` row 3). |

**One shape worth carrying forward.** `keep-awake` exposes `supported` *and* a `getKeepAwakeCaveat()`
string, because "the API exists and resolves but does nothing" is a third state distinct from
supported and unsupported — iOS below 18.4 resolves a wake lock and still dims the screen
(WebKit 254545). A boolean could not express that, and silently doing nothing is exactly the failure
this layer exists to prevent.

### Tier 2 — high value, real work

**Native dialogs / action sheet / toast** (`@capacitor/dialog`, `action-sheet`, `toast`; RN `Alert`,
`ActionSheetIOS`, `ToastAndroid`). ⚠️ **This overlaps the component gap in
`docs/research/component-surface.md` §8 Tier 2, and the overlap is a real decision, not a duplicate entry:** Ionic
renders these itself as styled overlays (`ion-alert`, `ion-action-sheet`, `ion-toast`), while
RN/Capacitor delegate to the OS. Rendering them gives one look on all three targets and full styling
control; delegating gives the genuine platform look and free a11y, but has no web tier beyond
`window.confirm`. Given adaptv's positioning, rendering is very likely right — but it should be an
explicit, recorded decision rather than a default, and the two docs should not be read as asking for
the same thing twice.

**Notifications** (local + push) — `@capacitor/local-notifications` / `push-notifications`, and on
web the Notification + Push APIs through the service worker adaptv already owns. The web tier is
mostly *already built* infrastructure.

**Camera / image picker / document picker** — `@capacitor/camera` covers all three natively;
`getUserMedia` and `<input type="file">` cover web. High-frequency in real apps.

**Filesystem** — `@capacitor/filesystem` + OPFS.

**Biometrics** — WebAuthn on web is genuinely good; native needs a community plugin. Pairs naturally
with `storage.secure`, which already exists and already documents the web/native honesty gap.

### Tier 3 — long tail

Sensors/motion · battery · brightness · contacts · calendar · SMS/mail · print · speech ·
store review · screen-capture blocking · ~~localization~~ (✅ `locale`, 2026-09-02 — `Intl` made the
web tier free, and it turned out to be the native tier too) · barcode scanning · text zoom.

### What adaptv has that this comparison *doesn't* diminish

`back-chain` (priority-auction back handling — Ionic has it, RN has only a flat `BackHandler`,
Capacitor only a raw event), `gesture-controller` (Expo delegates to a third-party library),
the three-tier storage split with an honest web-security story, and `ota/`. Those are not gaps in
either direction; they're places adaptv already made a stronger choice than at least one of the two.

---

## 5. Where this sits

- `docs/research/component-surface.md` — the UI counterpart. §5 there covers how Expo translated SwiftUI/Compose
  idioms into React interfaces; §8 there ranks the *component* gaps, one of which (dialogs) overlaps
  §4 Tier 2 here and needs a single decision, not two.
- `docs/design/architecture.md §2` — the storage tiers referenced in §2 and §3.5.
- `docs/decisions/prior-art.md` §7 — Ionic's keyboard guards, the internals behind the `keyboard` capability.
- `docs/roadmap/native-shell-plugin.md` — where the native side of anything added from §4 would land.

**Raw extracts** (regenerable, not committed): the 50-package Expo capability dump and the Capacitor
registry probe were produced by scripts in the session scratchpad from the versions pinned in the
header.
