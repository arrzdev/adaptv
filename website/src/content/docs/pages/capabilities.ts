import type { DocPage } from "@/content/docs/types"

export const page: DocPage = {
  slug: "capabilities",
  title: "Capabilities",
  summary:
    "The device APIs as plain functions, with no React: the same calls on every target, the right backend chosen underneath, and every expected refusal returned as a value.",
  platforms: ["Web", "PWA", "iOS", "Android"],
  importLine:
    'import { haptics, openExternal, getOnline, subscribeOnline, onResume, BackPriority } from "@arrzdev/adaptv/capabilities"',
  source: "src/capabilities",
  blocks: [
    { type: "h2", text: "Capability or hook" },
    {
      type: "p",
      text: "Every device feature in adaptv is written once as a capability: a module of plain functions that picks the native plugin inside a native build and the web API everywhere else. The hooks in `@arrzdev/adaptv/hooks` are thin React wrappers over them. Choose by who is calling:",
    },
    {
      type: "ul",
      items: [
        "**In a component, to render from the value**: use the hook. It subscribes, re-renders and cleans up for you, and it returns a safe value during server rendering.",
        "**Outside React**: use the capability. Feeding a data library's online manager, refreshing a token on resume from an auth module, registering a back handler from a store.",
        "**Fire and forget**: use the capability even inside a component. `haptics.impact()` and `openExternal(url)` hold no state, so there is nothing for a hook to add.",
      ],
    },
    {
      type: "p",
      text: 'The modules share a few conventions. Everything is safe to import and call during server rendering. Functions return an outcome (`"ok"`, `"unsupported"`, `"denied"`) for anything the platform may refuse in normal use, and reject only for a real programming error. State comes as a `get` and `subscribe` pair shaped for `useSyncExternalStore`. Permission-gated features use one four-state shape: `"granted"`, `"denied"`, `"prompt"` and `"unavailable"`, where unavailable means the feature cannot be used at all right now and prompting will not help.',
    },
    {
      type: "code",
      label: "query-client.ts",
      lang: "ts",
      code: `import { onlineManager, focusManager } from "@tanstack/react-query"
import { getOnline, subscribeOnline, subscribeAppState } from "@arrzdev/adaptv/capabilities"

// Accurate connectivity on native, where navigator.onLine is not
onlineManager.setEventListener((setOnline) =>
  subscribeOnline(() => setOnline(getOnline())),
)

// A native resume is not a window focus event. Tell the library yourself.
focusManager.setEventListener((setFocused) =>
  subscribeAppState((state) => setFocused(state === "active")),
)`,
    },
    {
      type: "note",
      tone: "info",
      text: "In a native build, several capabilities check whether the installed binary actually carries the plugin before using it, because an over-the-air bundle can be newer than the binary it runs on. When the plugin is missing they fall back to the web API inside the WebView. That applies to clipboard, share, haptics and the orientation lock. See [OTA updates](/docs/ota-updates).",
    },

    { type: "h2", text: "App state" },
    {
      type: "p",
      text: "Foreground and background, as one signal. Hooks: `useAppState`, `useOnResume`, `useOnPause` in [lifecycle hooks](/docs/hooks-lifecycle), which also has the per-target notes.",
    },
    {
      type: "api",
      name: "getAppState()",
      signature: 'function getAppState(): "active" | "background"',
      description:
        'Current state. Web reads `document.visibilityState`; native holds the last OS event. `"active"` on the server.',
    },
    {
      type: "api",
      name: "subscribeAppState()",
      signature:
        "function subscribeAppState(listener: (state: AppState) => void): () => void",
      description:
        "Call `listener` on every change. Edge-triggered: a listener is never told the same state twice in a row. A page restored from the back-forward cache is reported as a resume even though its pause was never observed. The native listeners are released when the last subscriber leaves.",
      returns: "An unsubscribe function. A no-op on the server.",
    },
    {
      type: "api",
      name: "onResume() / onPause()",
      signature:
        "function onResume(callback: () => void): () => void\nfunction onPause(callback: () => void): () => void",
      description:
        "`subscribeAppState` filtered to one direction. Each returns an unsubscribe.",
    },
    {
      type: "code",
      label: "auth.ts",
      lang: "ts",
      code: `import { onResume } from "@arrzdev/adaptv/capabilities"

onResume(() => {
  if (tokenExpiresSoon()) void refreshToken()
})`,
    },

    { type: "h2", text: "Back chain" },
    {
      type: "p",
      text: "One ordered list of back handlers for the whole app. Hooks: `useBackHandler` and `adaptvBack()` in [lifecycle hooks](/docs/hooks-lifecycle), where the model and the per-target notes live.",
    },
    {
      type: "api",
      name: "BackPriority",
      signature:
        "const BackPriority: { Overlay: 400; Transient: 300; Affordance: 200; RouterBack: 100; ExitApp: 0 }",
      description:
        "Named priority bands. Higher runs first. They are numbers so you can slot a handler between two bands. `Overlay` is for drawers, modals and sheets; `Transient` for menus and search fields; `Affordance` for an in-app back control; `RouterBack` is where adaptv's own history-back handler sits; `ExitApp` is the bottom.",
    },
    {
      type: "api",
      name: "registerBackHandler()",
      signature:
        "function registerBackHandler(handler: () => boolean, priority?: number): () => void",
      description:
        "Add a handler. It returns `true` to consume the press or `false` to pass it on. Within one priority the most recently registered handler runs first.",
      params: [
        {
          name: "handler",
          type: "() => boolean",
          required: true,
          description: "The handler.",
        },
        {
          name: "priority",
          type: "number",
          default: "BackPriority.Transient",
          description: "Where in the chain to sit.",
        },
      ],
      returns: "An unregister function. Calling it twice is safe.",
    },
    {
      type: "api",
      name: "runBackChain()",
      signature: "function runBackChain(): boolean",
      description:
        "Walk the chain from the highest priority down and stop at the first handler that returns `true`. A handler that throws counts as `false`. Handlers added or removed during the walk do not affect it. This is what the Android back button and `adaptvBack()` call.",
      returns: "`true` if a handler consumed the press.",
    },
    {
      type: "p",
      text: "`resetBackChain()` drops every registration. It exists for tests.",
    },

    { type: "h2", text: "Browser" },
    {
      type: "api",
      name: "openExternal()",
      signature: "function openExternal(url: string): Promise<void>",
      description:
        "Open a URL outside the app's router. On native it opens the in-app system browser (Safari View Controller on iOS, a Custom Tab on Android), so the user stays in your app. On web it opens a new tab with `noopener,noreferrer`. If the native plugin is missing it falls back to `window.open`. You can ignore the promise; await it if you want the native open to settle first. [Link](/docs/link) does this for you when its `to` is an external URL.",
    },
    {
      type: "api",
      name: "isExternalUrl()",
      signature: "function isExternalUrl(href: string): boolean",
      description:
        "`true` for anything with a URI scheme (`https:`, `mailto:`, `tel:`) or a protocol-relative `//host`. `false` for a route path such as `/settings`, which belongs to the router.",
    },
    {
      type: "code",
      label: "help-button.tsx",
      lang: "tsx",
      code: `<Button onClick={() => void openExternal("https://example.com/help")}>Help</Button>`,
    },

    { type: "h2", text: "Clipboard" },
    {
      type: "p",
      text: "Hook: `useClipboard` in [data hooks](/docs/hooks-data), which has the per-target notes.",
    },
    {
      type: "api",
      name: "writeClipboardText()",
      signature:
        'function writeClipboardText(text: string): Promise<"ok" | "denied" | "unsupported">',
      description:
        'Copy text. Never rejects. On web it tries the async clipboard first and falls back to `document.execCommand("copy")`, so copying works on a plain-http origin too. `"denied"` means the platform refused this time (no user gesture, unfocused document); `"unsupported"` means no retry can help.',
    },
    {
      type: "api",
      name: "readClipboardText()",
      signature:
        "function readClipboardText(): Promise<{ status: ClipboardStatus; text: string | null }>",
      description:
        'Read text. Never rejects; `text` is `null` for any status other than `"ok"`. On web it must be called from a user gesture, and Chromium also requires a focused document. There is no fallback on an insecure origin.',
    },
    {
      type: "api",
      name: "checkClipboardReadPermission()",
      signature:
        'function checkClipboardReadPermission(): Promise<"granted" | "denied" | "prompt" | "unavailable">',
      description:
        'Read permission without prompting. Native is always `"granted"`. Safari and Firefox have no such permission to query and report `"prompt"`: reading works there from a user gesture.',
    },

    { type: "h2", text: "Device" },
    {
      type: "p",
      text: "Hook: `useDevice` in [device hooks](/docs/hooks-device), which documents every `DeviceInfo` field and what each target reports.",
    },
    {
      type: "api",
      name: "getDeviceInfo()",
      signature: "function getDeviceInfo(): Promise<DeviceInfo>",
      description:
        "The device record: `platform`, `os`, `osVersion`, `model`, `manufacturer`, `isVirtual`, `webViewVersion`. Resolved once per process and cached. Never rejects: if the native plugin is missing it resolves to the web record.",
    },
    {
      type: "api",
      name: "getDeviceId()",
      signature: "function getDeviceId(): Promise<string | null>",
      description:
        "A stable per-install identifier on native. `null` on web, always: adaptv does not fingerprint.",
    },
    {
      type: "api",
      name: "getLanguageTag()",
      signature: "function getLanguageTag(): string",
      description:
        'The current BCP-47 tag from `navigator.language`, `"en"` on the server. Synchronous, and read fresh on each call because the user can change it in Settings and come back.',
    },
    {
      type: "p",
      text: "`resetDeviceInfo()` clears the cached record. It exists for tests.",
    },

    { type: "h2", text: "Geolocation" },
    {
      type: "p",
      text: "Hook: `useGeolocation` in [data hooks](/docs/hooks-data), including the native permission declarations you have to add by hand today.",
    },
    {
      type: "api",
      name: "checkGeoPermission()",
      signature: "function checkGeoPermission(): Promise<GeoPermission>",
      description:
        'Current permission without prompting. Never rejects. `"unavailable"` when the API is absent (an http origin) or, on native, when system location services are off.',
    },
    {
      type: "api",
      name: "requestGeoPermission()",
      signature: "function requestGeoPermission(): Promise<GeoPermission>",
      description:
        "Ask. Native shows the OS dialog. The web has no separate request, so this reads the position once to raise the browser prompt and reports the state that results. Never rejects.",
    },
    {
      type: "api",
      name: "getCurrentPosition()",
      signature:
        "function getCurrentPosition(options?: { highAccuracy?: boolean; timeoutMs?: number }): Promise<GeoCoords>",
      description:
        "Read the position once. Defaults: `highAccuracy: false`, `timeoutMs: 10000`. This one **rejects** on an error, a timeout or a missing permission, so wrap it, or use the hook, which does.",
      returns: "`{ latitude, longitude, accuracy }`, accuracy in metres.",
    },

    { type: "h2", text: "Gesture controller" },
    {
      type: "p",
      text: "A single arbiter that decides which gesture owns the pointer when several could start: a drawer drag, a swipeable row, an edge swipe. adaptv's own gesture components use the shared `gestureController`. Use it when you write a custom drag that has to coexist with them. It is pure logic with no DOM, so it behaves the same on every target.",
    },
    {
      type: "props",
      rows: [
        {
          name: "requestCapture(id, priority, onLost?, options?)",
          type: "(id: string, priority: number, onLost?: () => void, options?: { blocksScroll?: boolean }) => boolean",
          description:
            "Ask to own the pointer. Granted when nothing holds it, when you already hold it, or when `priority` is strictly higher than the holder's; a tie does not pre-empt. `onLost` is called if you are later pre-empted or disabled, so you can end your drag cleanly. `blocksScroll: true` marks the scroll container as held while you own the pointer.",
        },
        {
          name: "release(id)",
          type: "(id: string) => void",
          description:
            "Give the pointer up. Ignored unless `id` holds it, so a pre-empted gesture's late cleanup cannot free the winner's capture.",
        },
        {
          name: "getCaptured()",
          type: "() => string | null",
          description: "The id that owns the pointer, if any.",
        },
        {
          name: "isScrollBlocked()",
          type: "() => boolean",
          description:
            "Whether the current holder asked for scroll to be held still.",
        },
        {
          name: "setEnabled(id, enabled)",
          type: "(id: string, enabled: boolean) => void",
          description:
            "Disable or re-enable a gesture. A disabled id is refused capture until it is enabled again. Disabling the current holder releases it and calls its `onLost`.",
        },
        {
          name: "unregister(id)",
          type: "(id: string) => void",
          description:
            "Forget an id for good, releasing its capture if it holds one. Call it when the component unmounts.",
        },
      ],
    },
    {
      type: "code",
      label: "use-card-drag.ts",
      lang: "ts",
      code: `import { gestureController } from "@arrzdev/adaptv/capabilities"

const id = useId()

function onDragStart() {
  const granted = gestureController.requestCapture(id, 20, cancelDrag, {
    blocksScroll: true,
  })
  if (!granted) return
  // ...start dragging
}

function onDragEnd() {
  gestureController.release(id)
}

useEffect(() => () => gestureController.unregister(id), [id])`,
    },
    {
      type: "p",
      text: "`createGestureController()` returns a fresh, independent arbiter with the same methods. It exists so tests do not share capture state; an app uses the shared instance, because gestures only compete if they ask the same controller.",
    },

    { type: "h2", text: "Haptics" },
    {
      type: "p",
      text: "Hooks: `useHaptics`, `useHapticTick` and `useVibrate` in [feedback hooks](/docs/hooks-feedback), which explains the iOS web limits and has the per-target tables.",
    },
    {
      type: "api",
      name: "haptics",
      signature:
        'const haptics: {\n  impact(weight?: "light" | "medium" | "heavy"): void\n  notify(type: "success" | "warning" | "error"): void\n  selection(): void\n  isSupported(): boolean\n}',
      description:
        'Imperative feedback. Native uses the OS haptic engine. Web uses `navigator.vibrate` patterns, throttled to one pulse per 200 ms. `impact` defaults to `"light"`. The calls return nothing and never throw. On iOS web each call is at most one system tick, and nothing at all from iOS 26.5.',
    },
    {
      type: "api",
      name: "attachHapticTick()",
      signature: "function attachHapticTick(host: HTMLElement): () => void",
      description:
        "The declarative path for iOS web: overlay an invisible native switch on `host` so a real finger lands on it and iOS plays its system tick. Attaches nothing, and returns a no-op, wherever a real engine or `navigator.vibrate` exists. Idempotent per host.",
      returns: "A detach function.",
    },
    {
      type: "p",
      text: "`supportsHapticTick()` reports whether the overlay is the mechanism on this target (iOS, not native, no `navigator.vibrate`). `HAPTIC_TICK_ATTR` is the attribute that marks the injected node, `data-adaptv-haptic-tick`.",
    },

    { type: "h2", text: "Keep awake" },
    {
      type: "p",
      text: "Hook: `useKeepAwake` in [lifecycle hooks](/docs/hooks-lifecycle). One wake lock per app, on the Screen Wake Lock API on every target.",
    },
    {
      type: "props",
      rows: [
        {
          name: "requestKeepAwake()",
          type: '() => Promise<"held" | "unsupported" | "rejected">',
          description:
            "Keep the screen on until released. Never rejects. Re-acquires by itself when the app returns to the foreground, because the platform drops the lock whenever the page is hidden.",
        },
        {
          name: "releaseKeepAwake()",
          type: "() => Promise<void>",
          description:
            "Let the screen sleep, and stop re-acquiring. Safe to call when nothing is held.",
        },
        {
          name: "isKeepAwakeActive()",
          type: "() => boolean",
          description: "Whether a lock is held right now.",
        },
        {
          name: "subscribeKeepAwake(cb)",
          type: "(cb: () => void) => () => void",
          description:
            "Be told when the lock is taken or dropped. Returns an unsubscribe.",
        },
        {
          name: "getKeepAwakeCaveat()",
          type: "() => string | null",
          description:
            "A sentence describing a known way the lock reports success and still fails on this device, or `null`. Today: an installed PWA on iOS below 18.4.",
        },
      ],
    },

    { type: "h2", text: "Keyboard" },
    {
      type: "p",
      text: "The native keyboard events. On web these do nothing; use `useKeyboard` from [feedback hooks](/docs/hooks-feedback), which covers both and is what you want in nearly every case.",
    },
    {
      type: "props",
      rows: [
        {
          name: "hasNativeKeyboard()",
          type: "() => boolean",
          description:
            "Whether exact OS keyboard events are available. `true` in a native build.",
        },
        {
          name: "subscribeNativeKeyboard(cb)",
          type: "(cb: (info: { isOpen: boolean; height: number }) => void) => () => void",
          description:
            "Follow the native keyboard. If the keyboard is already up, `cb` is called at once with the current state. Returns an unsubscribe. A no-op off native.",
        },
        {
          name: "initNativeKeyboard()",
          type: "() => void",
          description:
            "Attach the app-wide OS listeners and, on iOS, stop the OS resizing the WebView. The shell calls it at startup so an autofocused field's first keyboard event is not missed. Idempotent.",
        },
      ],
    },

    { type: "h2", text: "Native theme" },
    {
      type: "api",
      name: "persistNativeThemePreference()",
      signature:
        'function persistNativeThemePreference(preference: "light" | "dark" | "system"): Promise<void>',
      description:
        'Mirror the theme preference into native storage, where the launch code can read it before any JavaScript runs. That is what lets the OS launch splash follow the app\'s theme on the next launch. `useTheme` and `applyUiThemePreference` already call it; call it yourself only if you manage the theme without them. A no-op on web. `NATIVE_THEME_PREF_KEY` (`"adaptv-theme"`) is the storage key, and `UiThemePreference` is the type.',
    },

    { type: "h2", text: "Network" },
    {
      type: "p",
      text: "Hook: `useIsOffline` in [data hooks](/docs/hooks-data).",
    },
    {
      type: "api",
      name: "getOnline()",
      signature: "function getOnline(): boolean",
      description:
        "Current connectivity. Native: the last status from the OS, `true` until the first one arrives. Web: `navigator.onLine`, which only proves a network interface exists. `true` on the server.",
    },
    {
      type: "api",
      name: "subscribeOnline()",
      signature: "function subscribeOnline(cb: () => void): () => void",
      description:
        "Be told when connectivity changes, then read `getOnline()`. On native the first subscription also fetches the current status. Returns an unsubscribe.",
    },

    { type: "h2", text: "Orientation" },
    {
      type: "p",
      text: "Hook: `useOrientation` in [device hooks](/docs/hooks-device), which has the outcome table and the per-target notes.",
    },
    {
      type: "props",
      rows: [
        {
          name: "getScreenOrientation()",
          type: "() => ScreenOrientationType",
          description:
            'One of `"portrait-primary"`, `"portrait-secondary"`, `"landscape-primary"`, `"landscape-secondary"`. On native the value is filled in by the first subscription; before that it reads `"portrait-primary"`.',
        },
        {
          name: "subscribeScreenOrientation(cb)",
          type: "(cb: () => void) => () => void",
          description: "Be told when it changes. Returns an unsubscribe.",
        },
        {
          name: "lockScreenOrientation(lock)",
          type: '(lock: ScreenOrientationLock) => Promise<"ok" | "unsupported" | "rejected">',
          description:
            'Hold the screen in `"any"`, `"natural"`, `"portrait"`, `"landscape"` or one of the four concrete values. Never rejects.',
        },
        {
          name: "unlockScreenOrientation()",
          type: '() => Promise<"ok" | "unsupported" | "rejected">',
          description: "Release the lock. Never rejects.",
        },
      ],
    },

    { type: "h2", text: "Share" },
    {
      type: "p",
      text: "Hook: `useShare` in [data hooks](/docs/hooks-data), which documents `ShareTarget`.",
    },
    {
      type: "api",
      name: "share()",
      signature:
        'function share(target: ShareTarget): Promise<"shared" | "dismissed" | "unsupported">',
      description:
        "Open the share sheet. An unsupported target and a dismissed sheet are outcomes. It **rejects** for a real caller error, and one matters: on web, calling it outside a user gesture (an `await` before the call is enough) throws `NotAllowedError`.",
    },
    {
      type: "api",
      name: "canShareTarget()",
      signature: "function canShareTarget(target: ShareTarget): boolean",
      description:
        "Whether this payload can be shared here. `false` wherever there is no share sheet, and `false` on native for a payload with `files`.",
    },

    { type: "h2", text: "Splash" },
    {
      type: "api",
      name: "hideNativeSplash()",
      signature: "function hideNativeSplash(): Promise<void>",
      description:
        "Hide the OS launch splash in a native build. The promise resolves when the splash's 200 ms fade has finished, not when the native call returns, and it cannot hang if the plugin is missing. Resolves at once on web. The shell calls it when your own splash has painted; you need it only if you replace that handoff. `NATIVE_SPLASH_FADE_MS` is the `200`. See [icons and splash](/docs/icons-and-splash).",
    },

    { type: "h2", text: "Status bar" },
    {
      type: "p",
      text: "Native only; every function is a no-op on web. Hook: `useStatusBar` in [device hooks](/docs/hooks-device).",
    },
    {
      type: "props",
      rows: [
        {
          name: "applyStatusBar(appearance)",
          type: '(appearance: "light" | "dark") => void',
          description:
            'Set the system bars\' icon style for the content behind them: `"dark"` gives light icons. On Android it covers the navigation bar too. It sets no colour; the bar background is what the page paints under it.',
        },
        {
          name: "enableEdgeToEdge()",
          type: "() => void",
          description:
            "Lay the WebView out under the system bars, with the [safe-area](/docs/safe-areas) utilities padding content back. On iOS it turns the overlay on. On Android the generated activity already did that at launch, and this re-checks that the safe-area values reached the page.",
        },
        {
          name: "reprobeAndroidInsets()",
          type: "() => void",
          description:
            "Android only. Ask the native shell to re-read the viewport meta and send the insets again. `enableEdgeToEdge` calls it for you during boot.",
        },
      ],
    },

    { type: "h2", text: "Chrome tint" },
    {
      type: "p",
      text: "Animate the mobile browser's toolbar colour. Hook: `useChromeTint` in [device hooks](/docs/hooks-device), which documents `ChromeTintOptions`, the returned `{ finished, stop }` handle and where the tint is visible. The hook also restores the tint if its component unmounts; with the functions below that is yours to do.",
    },
    {
      type: "props",
      rows: [
        {
          name: "transitionChromeTint(to, options?)",
          type: "(to: string, options?: ChromeTintOptions) => ChromeTintTransition",
          description:
            "Walk the tint to a colour. Defaults: `duration: 0.3` seconds, `easing: [0.25, 0.1, 0.25, 1]`, `from`: the colour on the tag now. Becomes an immediate set under reduced motion, a zero duration or an unreadable colour.",
        },
        {
          name: "setChromeTint(color)",
          type: "(color: string) => void",
          description:
            "Set it now, cancelling any transition. For following a gesture.",
        },
        {
          name: "restoreChromeTint(options?)",
          type: '(options?: Omit<ChromeTintOptions, "from">) => ChromeTintTransition',
          description:
            "Return to the theme's colour. Does nothing if nothing took the tint.",
        },
        {
          name: "getChromeTint()",
          type: "() => string | null",
          description:
            "The colour on the tag right now, `null` where there is no tag.",
        },
        {
          name: "getChromeTintBase()",
          type: "() => string | null",
          description:
            "The colour a restore returns to: what the theme, or the route's own tint, resolves to.",
        },
        {
          name: "subscribeChromeTintBase(listener)",
          type: "(listener: () => void) => () => void",
          description:
            "Be told when the base changes, for example on a theme flip.",
        },
      ],
    },
  ],
}
