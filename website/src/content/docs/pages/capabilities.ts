import type { DocPage } from "@/content/docs/types"

export const page: DocPage = {
  slug: "capabilities",
  title: "Capabilities",
  summary:
    "The device APIs as plain functions with no React. The same calls on every target.",
  platforms: ["Web", "PWA", "iOS", "Android"],
  importLine:
    'import { haptics, openExternal, getOnline, subscribeOnline, onResume, BackPriority } from "@arrzdev/adaptv/capabilities"',
  source: "src/capabilities",
  blocks: [
    { type: "h2", text: "Capability or hook" },
    {
      type: "p",
      text: "Each device feature is a module of plain functions. A native build uses the native plugin. Everywhere else uses the web API. The hooks in `@arrzdev/adaptv/hooks` wrap them. In a component that renders a value, use the hook. Outside React, use the capability. For a call that holds no state, such as `haptics.impact()`, use the capability anywhere.",
    },
    {
      type: "p",
      text: 'All modules are safe to call during server rendering. A function returns an outcome (`"ok"`, `"unsupported"`, `"denied"`) for a normal refusal. It rejects only for a programming error. State comes as a `get` and `subscribe` pair. Permissions use four states: `"granted"`, `"denied"`, `"prompt"` and `"unavailable"`. `"unavailable"` means a prompt will not help.',
    },
    {
      type: "code",
      label: "data-client.ts",
      lang: "ts",
      code: `import { getOnline, subscribeOnline, subscribeAppState } from "@arrzdev/adaptv/capabilities"

// Feed connectivity and focus to a data library
subscribeOnline(() => dataClient.setOnline(getOnline()))

// A native resume is not a window focus event
subscribeAppState((state) => dataClient.setFocused(state === "active"))`,
    },
    {
      type: "note",
      tone: "info",
      text: "An over-the-air bundle can be newer than the app binary. So clipboard, share, haptics and orientation lock check that the binary has the plugin. If not, they use the web API. See [OTA updates](/docs/ota-updates).",
    },

    { type: "h2", text: "App state" },
    {
      type: "p",
      text: "Hooks: `useAppState`, `useOnResume`, `useOnPause` in [lifecycle hooks](/docs/hooks-lifecycle).",
    },
    {
      type: "props",
      rows: [
        {
          name: "getAppState()",
          type: '() => "active" | "background"',
          description: '`"active"` on the server.',
        },
        {
          name: "subscribeAppState(listener)",
          type: "(listener: (state: AppState) => void) => () => void",
          description:
            "Call `listener` on each change, never twice with the same state. Returns an unsubscribe function.",
        },
        {
          name: "onResume(cb) / onPause(cb)",
          type: "(callback: () => void) => () => void",
          description: "`subscribeAppState` for one direction.",
        },
      ],
    },

    { type: "h2", text: "Back chain" },
    {
      type: "p",
      text: "One ordered list of back handlers. Hooks: `useBackHandler` and `adaptvBack()` in [lifecycle hooks](/docs/hooks-lifecycle).",
    },
    {
      type: "props",
      rows: [
        {
          name: "BackPriority",
          type: "{ Overlay: 400; Transient: 300; Affordance: 200; RouterBack: 100; ExitApp: 0 }",
          description:
            "Priority bands. Higher runs first. You can use a number between two bands.",
        },
        {
          name: "registerBackHandler(handler, priority?)",
          type: "(handler: () => boolean, priority?: number) => () => void",
          default: "BackPriority.Transient",
          description:
            "Add a handler. Return `true` to consume the press. At equal priority, the newest runs first. Returns an unregister function.",
        },
        {
          name: "runBackChain()",
          type: "() => boolean",
          description:
            "Run the chain until a handler returns `true`. A handler that throws counts as `false`. Returns `true` if one consumed the press.",
        },
      ],
    },

    { type: "h2", text: "Browser" },
    {
      type: "api",
      name: "openExternal()",
      signature:
        "function openExternal(url: string): Promise<OpenExternalOutcome>",
      description:
        'Open a URL outside the router. It never rejects. It resolves to `"opened"`, `"blocked"` (a popup blocker refused), `"invalid"` (the URL does not parse, or uses `javascript:`, `data:`, `blob:`, `about:` or `file:`) or `"unsupported"` (the server). Only `http:` and `https:` open a browser: the in-app browser on native, a new tab on web. Other schemes, such as `mailto:`, go to the OS. Call it from a click handler. [Link](/docs/link) calls it for an external `to`.',
    },
    {
      type: "api",
      name: "isExternalUrl()",
      signature: "function isExternalUrl(href: string): boolean",
      description:
        "`true` for a URL with a scheme or a `//host` URL. `false` for a route path such as `/settings`.",
    },

    { type: "h2", text: "Clipboard" },
    {
      type: "p",
      text: "Hook: `useClipboard` in [data hooks](/docs/hooks-data).",
    },
    {
      type: "props",
      rows: [
        {
          name: "writeClipboardText(text)",
          type: '(text: string) => Promise<"ok" | "denied" | "unsupported">',
          description:
            'Copy text. It never rejects. On web it falls back to `document.execCommand("copy")`, so it works on http.',
        },
        {
          name: "readClipboardText()",
          type: "() => Promise<{ status: ClipboardStatus; text: string | null }>",
          description:
            'Read text. It never rejects. `text` is `null` unless `status` is `"ok"`. On web, call it from a user gesture.',
        },
        {
          name: "checkClipboardReadPermission()",
          type: '() => Promise<"granted" | "denied" | "prompt" | "unavailable">',
          description:
            'Read permission, without a prompt. Native is `"granted"`. Safari and Firefox give `"prompt"`.',
        },
      ],
    },

    { type: "h2", text: "Device" },
    {
      type: "p",
      text: "Hook: `useDevice` in [device hooks](/docs/hooks-device), which lists the `DeviceInfo` fields.",
    },
    {
      type: "props",
      rows: [
        {
          name: "getDeviceInfo()",
          type: "() => Promise<DeviceInfo>",
          description:
            "The device record. Read once and cached. It never rejects.",
        },
        {
          name: "getDeviceId()",
          type: "() => Promise<string | null>",
          description: "A stable id on native. `null` on web.",
        },
        {
          name: "resetDeviceInfo()",
          type: "() => void",
          description: "Clear the cache. For tests.",
        },
      ],
    },

    { type: "h2", text: "Geolocation" },
    {
      type: "p",
      text: "Hook: `useGeolocation` in [data hooks](/docs/hooks-data). It lists the native permissions to add.",
    },
    {
      type: "props",
      rows: [
        {
          name: "checkGeoPermission()",
          type: "() => Promise<GeoPermission>",
          description: "The permission, without a prompt. It never rejects.",
        },
        {
          name: "requestGeoPermission()",
          type: "() => Promise<GeoPermission>",
          description:
            "Ask for permission. On web it reads the position once to raise the prompt. It never rejects.",
        },
        {
          name: "getCurrentPosition(options?)",
          type: "(options?: { highAccuracy?: boolean; timeoutMs?: number }) => Promise<GeoCoords>",
          default: "highAccuracy: false, timeoutMs: 10000",
          description:
            "Read the position. It **rejects** on an error, a timeout or no permission. Returns `{ latitude, longitude, accuracy }`.",
        },
      ],
    },

    { type: "h2", text: "Gesture controller" },
    {
      type: "p",
      text: "One arbiter decides which gesture owns the pointer, such as a drawer drag or an edge swipe. Use the shared `gestureController` for a custom drag that must work with adaptv components.",
    },
    {
      type: "props",
      rows: [
        {
          name: "requestCapture(id, priority, onLost?, options?)",
          type: "(id: string, priority: number, onLost?: () => void, options?: { blocksScroll?: boolean }) => boolean",
          description:
            "Ask to own the pointer. Granted if nothing holds it, or if `priority` is higher than the holder's. A tie does not take it. `onLost` runs if you are pre-empted. `blocksScroll` holds scroll still.",
        },
        {
          name: "release(id)",
          type: "(id: string) => void",
          description: "Give up the pointer. Ignored unless `id` holds it.",
        },
        {
          name: "getCaptured()",
          type: "() => string | null",
          description: "The id that owns the pointer.",
        },
        {
          name: "isScrollBlocked()",
          type: "() => boolean",
          description: "`true` if the holder asked to hold scroll still.",
        },
        {
          name: "setEnabled(id, enabled)",
          type: "(id: string, enabled: boolean) => void",
          description:
            "A disabled id cannot capture. Disabling the holder releases it and runs `onLost`.",
        },
        {
          name: "unregister(id)",
          type: "(id: string) => void",
          description: "Forget an id. Call it on unmount.",
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
      text: "`createGestureController()` returns a separate arbiter, for tests.",
    },

    { type: "h2", text: "Haptics" },
    {
      type: "p",
      text: "Hooks: `useHaptics`, `useHapticTick`, `useVibrate` in [feedback hooks](/docs/hooks-feedback).",
    },
    {
      type: "api",
      name: "haptics",
      signature:
        'const haptics: {\n  impact(weight?: "light" | "medium" | "heavy"): void\n  notify(type: "success" | "warning" | "error"): void\n  selection(): void\n  isSupported(): boolean\n}',
      description:
        'Native uses the OS engine. Web uses `navigator.vibrate`, at most one pulse per 200 ms. `impact` defaults to `"light"`. The calls never throw. On iOS web, each call is at most one tick. From iOS 26.5 it is nothing.',
    },
    {
      type: "api",
      name: "attachHapticTick()",
      signature: "function attachHapticTick(host: HTMLElement): () => void",
      description:
        "The iOS web path. It puts an invisible native switch over `host`, so a real finger gives a system tick. It attaches nothing where a real engine or `navigator.vibrate` exists.",
      returns: "A detach function.",
    },
    {
      type: "p",
      text: "`supportsHapticTick()` is `true` where the overlay is needed: iOS web without `navigator.vibrate`. `HAPTIC_TICK_ATTR` is `data-adaptv-haptic-tick`.",
    },

    { type: "h2", text: "Keep awake" },
    {
      type: "p",
      text: "Hook: `useKeepAwake` in [lifecycle hooks](/docs/hooks-lifecycle). There is one lock per app.",
    },
    {
      type: "props",
      rows: [
        {
          name: "requestKeepAwake()",
          type: '() => Promise<"held" | "unsupported" | "rejected">',
          description:
            "Keep the screen on. It never rejects. It takes the lock again on return to the foreground.",
        },
        {
          name: "releaseKeepAwake()",
          type: "() => Promise<void>",
          description: "Let the screen sleep.",
        },
        {
          name: "isKeepAwakeActive()",
          type: "() => boolean",
          description: "`true` while a lock is held.",
        },
        {
          name: "subscribeKeepAwake(cb)",
          type: "(cb: () => void) => () => void",
          description: "Hear when the lock changes.",
        },
        {
          name: "getKeepAwakeCaveat()",
          type: "() => string | null",
          description: "A known failure on this device, or `null`.",
        },
      ],
    },

    { type: "h2", text: "Keyboard" },
    {
      type: "p",
      text: "Native keyboard events. On web they do nothing. Use `useKeyboard` from [feedback hooks](/docs/hooks-feedback) instead.",
    },
    {
      type: "props",
      rows: [
        {
          name: "hasNativeKeyboard()",
          type: "() => boolean",
          description: "`true` in a native build whose binary has the plugin.",
        },
        {
          name: "subscribeNativeKeyboard(cb)",
          type: "(cb: (info: KeyboardInfo) => void) => () => void",
          description:
            "Follow the keyboard. `KeyboardInfo` is `{ isOpen, height, unpaidHeight, resizesLayoutViewport }`. If the keyboard is up, `cb` runs at once.",
        },
        {
          name: "initNativeKeyboard()",
          type: "() => void",
          description:
            "Attach the OS listeners. The shell calls it at startup.",
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
        'Copy the theme preference to native storage, so the launch splash follows the app theme. `useTheme` already calls it. Does nothing on web. The key is `NATIVE_THEME_PREF_KEY` (`"adaptv-theme"`).',
    },

    { type: "h2", text: "Network" },
    {
      type: "p",
      text: "Hook: `useIsOffline` in [data hooks](/docs/hooks-data).",
    },
    {
      type: "props",
      rows: [
        {
          name: "getOnline()",
          type: "() => boolean",
          description:
            "The connection state. Native: the last OS status. Web: `navigator.onLine`. `true` on the server.",
        },
        {
          name: "subscribeOnline(cb)",
          type: "(cb: () => void) => () => void",
          description: "Hear when it changes, then read `getOnline()`.",
        },
      ],
    },

    { type: "h2", text: "Orientation" },
    {
      type: "p",
      text: "Hook: `useOrientation` in [device hooks](/docs/hooks-device).",
    },
    {
      type: "props",
      rows: [
        {
          name: "getScreenOrientation()",
          type: "() => ScreenOrientationType",
          description: '`"portrait-primary"` before the first native value.',
        },
        {
          name: "subscribeScreenOrientation(cb)",
          type: "(cb: () => void) => () => void",
          description: "Hear when it changes.",
        },
        {
          name: "lockScreenOrientation(lock)",
          type: '(lock: ScreenOrientationLock) => Promise<"ok" | "unsupported" | "rejected">',
          description: "Hold an orientation. It never rejects.",
        },
        {
          name: "unlockScreenOrientation()",
          type: '() => Promise<"ok" | "unsupported" | "rejected">',
          description: "Release the lock. It never rejects.",
        },
      ],
    },

    { type: "h2", text: "Share" },
    {
      type: "p",
      text: "Hook: `useShare` in [data hooks](/docs/hooks-data), which lists `ShareTarget`.",
    },
    {
      type: "props",
      rows: [
        {
          name: "share(target)",
          type: '(target: ShareTarget) => Promise<"shared" | "dismissed" | "unsupported">',
          description:
            "Open the share sheet. It **rejects** for a caller error: on web, a call outside a user gesture, or a missing `storedFiles` path.",
        },
        {
          name: "canShareTarget(target)",
          type: "(target: ShareTarget) => boolean",
          description:
            "`true` if the payload can be shared. `false` on native for `files`.",
        },
      ],
    },

    { type: "h2", text: "Splash" },
    {
      type: "api",
      name: "hideNativeSplash()",
      signature: "function hideNativeSplash(): Promise<void>",
      description:
        "Hide the OS launch splash. It resolves when the 200 ms fade ends (`NATIVE_SPLASH_FADE_MS`). On web it resolves at once. The shell calls it. See [icons and splash](/docs/icons-and-splash).",
    },

    { type: "h2", text: "Status bar" },
    {
      type: "p",
      text: "Native only. Hook: `useStatusBar` in [device hooks](/docs/hooks-device).",
    },
    {
      type: "props",
      rows: [
        {
          name: "applyStatusBar(appearance)",
          type: '(appearance: "light" | "dark") => void',
          description:
            'Set the icon style for the content behind the bars. `"dark"` gives light icons.',
        },
        {
          name: "enableEdgeToEdge()",
          type: "() => void",
          description:
            "Draw the app under the system bars. The [safe-area](/docs/safe-areas) utilities pad content back.",
        },
        {
          name: "reprobeAndroidInsets()",
          type: "() => void",
          description: "Android only. Ask the shell to send the insets again.",
        },
      ],
    },

    { type: "h2", text: "Chrome tint" },
    {
      type: "p",
      text: "Animate the mobile browser toolbar colour. Hook: `useChromeTint` in [device hooks](/docs/hooks-device), which lists `ChromeTintOptions`. The hook restores the tint on unmount. These functions do not.",
    },
    {
      type: "props",
      rows: [
        {
          name: "transitionChromeTint(to, options?)",
          type: "(to: string, options?: ChromeTintOptions) => ChromeTintTransition",
          description:
            "Move the tint to a colour. Defaults: `duration: 0.3`, `easing: [0.25, 0.1, 0.25, 1]`.",
        },
        {
          name: "setChromeTint(color)",
          type: "(color: string) => void",
          description: "Set it now.",
        },
        {
          name: "restoreChromeTint(options?)",
          type: '(options?: Omit<ChromeTintOptions, "from">) => ChromeTintTransition',
          description: "Go back to the theme colour.",
        },
        {
          name: "getChromeTint()",
          type: "() => string | null",
          description: "The colour on the tag now.",
        },
        {
          name: "getChromeTintBase()",
          type: "() => string | null",
          description: "The colour that a restore goes back to.",
        },
        {
          name: "subscribeChromeTintBase(listener)",
          type: "(listener: () => void) => () => void",
          description: "Hear when the base changes.",
        },
      ],
    },
  ],
}
