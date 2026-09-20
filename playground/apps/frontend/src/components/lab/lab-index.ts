/**
 * The testing surface's table of contents.
 *
 * Three groups, in the order a manual pass should walk them: the components
 * (the largest untested surface), then the framework-level behaviour that has no
 * component to open, then the capabilities and hooks.
 *
 * Kept as data rather than JSX so the index page and the route config are
 * obviously the same list: if an entry is here and its route is missing, the
 * link 404s loudly instead of the page quietly not existing.
 */
export type LabEntry = {
  /** The literal route path — kept literal so `<Link to>` stays type-checked. */
  to: string
  title: string
  /** What the page is for — shown on the index row. */
  summary: string
  /** `true` for a page the owner has never walked on any target. */
  isNew: boolean
}

export type LabGroup = {
  title: string
  /** Why this group is its own group — shown once, above the rows. */
  summary: string
  entries: readonly LabEntry[]
}

const COMPONENTS = [
  {
    to: "/lab/view-scroll",
    title: "View & ScrollView",
    summary: "the two layout primitives · fill, safe, edge fades",
    isNew: true,
  },
  {
    to: "/lab/list",
    title: "List",
    summary: "virtualised rows · 2 000 items, a handful of nodes",
    isNew: false,
  },
  {
    to: "/lab/text",
    title: "Text",
    summary: "line clamp · selectable · iOS Dynamic Type",
    isNew: true,
  },
  {
    to: "/lab/image",
    title: "Image",
    summary: "the box is reserved before the bytes arrive",
    isNew: true,
  },
  {
    to: "/lab/button",
    title: "Button",
    summary: "press engine + haptics + slots, with real semantics",
    isNew: true,
  },
  {
    to: "/lab/pressable",
    title: "Pressable",
    summary:
      "the press engine on any element · reentrant, zero re-renders",
    isNew: false,
  },
  {
    to: "/lab/link",
    title: "Link & ExternalLink",
    summary: "in-app navigation, smartBack, and leaving the app",
    isNew: true,
  },
  {
    to: "/lab/toggles",
    title: "Checkbox & Switch",
    summary: "controlled, uncontrolled, indeterminate, dragged",
    isNew: false,
  },
  {
    to: "/lab/fields",
    title: "Input & TextArea",
    summary: "slots, submit key, autoResize · and the caret patch",
    isNew: false,
  },
  {
    to: "/lab/drawer",
    title: "Drawer",
    summary:
      "drag to dismiss, nesting, keyboard avoidance, the height cap · and the app's own sheets",
    isNew: true,
  },
  {
    to: "/lab/drawer-keyboard",
    title: "Drawer & keyboard",
    summary: "the 14-scenario conformance run · one tap, one verdict",
    isNew: true,
  },
  {
    to: "/lab/dropdown",
    title: "Dropdown",
    summary: "anchored menu · flip, shift, escape a clipped carousel",
    isNew: false,
  },
  {
    to: "/lab/collapsible",
    title: "Collapsible",
    summary: "measured height · until-found · reduced motion",
    isNew: true,
  },
  {
    to: "/lab/swipeable",
    title: "Swipeable",
    summary: "row actions · the gesture that must not lose the finger",
    isNew: false,
  },
  {
    to: "/lab/pull-to-refresh",
    title: "PullToRefresh",
    summary: "pull past the threshold without stealing the scroll",
    isNew: false,
  },
  {
    to: "/lab/wheel-column",
    title: "WheelColumn",
    summary: "the iOS picker drum · snap, momentum, haptic tick",
    isNew: false,
  },
  {
    to: "/lab/avoid-keyboard",
    title: "AvoidKeyboard",
    summary: "lift content off the on-screen keyboard",
    isNew: true,
  },
  {
    to: "/lab/offline",
    title: "Offline",
    summary: "the whole-screen fallback when the network is gone",
    isNew: true,
  },
  {
    to: "/lab/edge-swipe",
    title: "EdgeSwipeGestures",
    summary: "back-swipe where the OS no longer provides one",
    isNew: true,
  },
  {
    to: "/lab/screens",
    title: "Full-screen chrome",
    summary: "UiNotFound · OrientationGuard · PwaSplashOverlay",
    isNew: true,
  },
] as const satisfies readonly LabEntry[]

const FRAMEWORK = [
  {
    to: "/lab/cascade-layers",
    title: "Cascade layers",
    summary: "who wins: adaptv, a utility, or your own stylesheet",
    isNew: true,
  },
  {
    to: "/lab/press-states",
    title: "active:",
    summary: "engine element vs plain <button> · both must animate",
    isNew: true,
  },
  {
    to: "/lab/hover-focus",
    title: "hover: and focus",
    summary: "no sticky hover after a tap · Tab shows a ring (WCAG)",
    isNew: true,
  },
  {
    to: "/lab/safe-area",
    title: "Safe area",
    summary: "p-safe, *-safe-offset-N, *-safe-or-N and useInsets agreeing",
    isNew: true,
  },
  {
    to: "/lab/app-feel",
    title: "App feel",
    summary: "noSelect · hideScrollbars · touchCallout stamps",
    isNew: false,
  },
  {
    to: "/lab/service-worker",
    title: "Service worker",
    summary: "precache · navigation preload · the update flow",
    isNew: true,
  },
] as const satisfies readonly LabEntry[]

const CAPABILITIES = [
  {
    to: "/lab/share",
    title: "Share",
    summary: "OS share sheet · two-level support probe",
    isNew: false,
  },
  {
    to: "/lab/clipboard",
    title: "Clipboard",
    summary: "copy is ungated, paste is permission-gated",
    isNew: false,
  },
  {
    to: "/lab/device",
    title: "Device",
    summary: "model / OS / locale — and every null the web can't fill",
    isNew: false,
  },
  {
    to: "/lab/orientation",
    title: "Orientation",
    summary: "read everywhere, lock almost nowhere",
    isNew: false,
  },
  {
    to: "/lab/keep-awake",
    title: "Keep awake",
    summary: "screen wake lock · the caveat the API can't report",
    isNew: false,
  },
  {
    to: "/lab/app-state",
    title: "App state",
    summary: "foreground / background across resume and bfcache",
    isNew: false,
  },
  {
    to: "/lab/back-chain",
    title: "Back chain",
    summary: "priority-auction back handling",
    isNew: false,
  },
  {
    to: "/lab/browser",
    title: "Browser",
    summary: "external URLs · in-app system browser vs new tab",
    isNew: false,
  },
  {
    to: "/lab/geolocation",
    title: "Geolocation",
    summary: "the four-state permission exemplar",
    isNew: false,
  },
  {
    to: "/lab/gesture-controller",
    title: "Gesture controller",
    summary: "the global gesture arbiter and its claims",
    isNew: false,
  },
  {
    to: "/lab/haptic-tick",
    title: "Haptic tick",
    summary: "the iOS-web transducer — the only haptic WebKit allows",
    isNew: false,
  },
  {
    to: "/lab/haptics",
    title: "Haptics",
    summary: "imperative feedback · a documented no-op on iOS web",
    isNew: false,
  },
  {
    to: "/lab/keyboard",
    title: "Keyboard",
    summary: "the live height variable and the data-keyboard-open flag",
    isNew: false,
  },
  {
    to: "/lab/chrome-tint",
    title: "Chrome tint",
    summary:
      "the browser toolbar animated along a curve · browser tabs only",
    isNew: true,
  },
  {
    to: "/lab/route-tint",
    title: "Route tint",
    summary:
      "a route pinning the chrome to its own colour, before the app boots",
    isNew: true,
  },
  {
    to: "/lab/native-theme",
    title: "Native theme",
    summary: "theme mirrored into native storage for the OS splash",
    isNew: false,
  },
  {
    to: "/lab/network",
    title: "Network",
    summary: "reachability · accurate on native, coarse on web",
    isNew: false,
  },
  {
    to: "/lab/ota",
    title: "OTA & the store gap",
    summary: "has the channel moved past this binary",
    isNew: true,
  },
  {
    to: "/lab/splash",
    title: "Splash",
    summary: "the native launch splash handoff",
    isNew: false,
  },
  {
    to: "/lab/status-bar",
    title: "Status bar",
    summary: "system bars + edge-to-edge · native only",
    isNew: false,
  },
  {
    to: "/lab/hooks",
    title: "Standalone hooks",
    summary: "the hooks with no capability behind them",
    isNew: false,
  },
] as const satisfies readonly LabEntry[]

export const LAB_GROUPS = [
  {
    title: "Components",
    summary:
      "The public component surface. Every page states what the correct behaviour is on each target before it asks you to touch anything.",
    entries: COMPONENTS,
  },
  {
    title: "Framework behaviour",
    summary:
      "Things with no component to open — the cascade, the interaction variants, the safe-area contract. All of it recently changed and none of it has been watched running.",
    entries: FRAMEWORK,
  },
  {
    title: "Capabilities & hooks",
    summary:
      "One page per capability, each rendering its unsupported state as loudly as its happy path.",
    entries: CAPABILITIES,
  },
] as const satisfies readonly LabGroup[]
