import { HooksLifecycleDemo } from "@/components/docs-demos/hooks-lifecycle-demo"
import type { DocPage } from "@/content/docs/types"

export const page: DocPage = {
  slug: "hooks-lifecycle",
  title: "Lifecycle hooks",
  summary:
    "Foreground and background, screen enter and leave, the back press, keeping the screen awake, and a ready gate for cold start.",
  platforms: ["Web", "PWA", "iOS", "Android"],
  importLine:
    'import { useAppState, useOnResume, useOnPause, useScreenLifecycle, useBackHandler, adaptvBack, useKeepAwake, createBootstrapGate } from "@arrzdev/adaptv/hooks"',
  source: "src/hooks",
  blocks: [
    {
      type: "demo",
      component: HooksLifecycleDemo,
      code: `import { useAppState, useOnPause, useOnResume } from "@arrzdev/adaptv/hooks"

const state = useAppState()
const [resumes, setResumes] = useState(0)

useOnResume(() => setResumes((n) => n + 1))

<Text>{state} · resumes: {resumes}</Text>`,
    },
    { type: "h2", text: "App state" },
    {
      type: "p",
      text: "React effects and route lifecycle only run while the app is in the foreground. The most common mobile event, going to the background and coming back, fires none of them. It also fires no browser `focus` event inside a native WebView, so anything keyed on window focus (a data library's refetch-on-focus, for instance) never runs on native. These hooks are the one signal that is right on every target.",
    },
    {
      type: "api",
      name: "useAppState()",
      signature: 'function useAppState(): "active" | "background"',
      description:
        "Reactive foreground state. Re-renders the component when the app moves between foreground and background.",
      returns: '`"active"` or `"background"`. `"active"` on the server.',
    },
    {
      type: "api",
      name: "useOnResume()",
      signature: "function useOnResume(callback: () => void): void",
      description:
        "Run a callback each time the app returns to the foreground. Use it for token refresh, re-locking behind biometrics, reconnecting a socket, refetching stale data. The callback is held in a ref, so an inline arrow does not re-subscribe on every render. It is edge-triggered: one resume, one call. A page restored from the browser's back-forward cache counts as a resume; an ordinary first load does not.",
      params: [
        {
          name: "callback",
          type: "() => void",
          required: true,
          description: "Called on every background to foreground transition.",
        },
      ],
    },
    {
      type: "api",
      name: "useOnPause()",
      signature: "function useOnPause(callback: () => void): void",
      description:
        "Run a callback each time the app leaves the foreground. Use it to save a draft or pause media. Keep the work synchronous and short: the OS may suspend the process straight after.",
      params: [
        {
          name: "callback",
          type: "() => void",
          required: true,
          description: "Called on every foreground to background transition.",
        },
      ],
    },
    {
      type: "code",
      label: "session.tsx",
      lang: "tsx",
      code: `useOnResume(() => {
  void refreshToken()
  queryClient.invalidateQueries()
})

useOnPause(() => saveDraft(draft))`,
    },
    {
      type: "p",
      text: "Outside React, use `subscribeAppState`, `onResume` and `onPause` from [capabilities](/docs/capabilities).",
    },
    {
      type: "targets",
      rows: [
        {
          target: "Desktop web",
          status: "yes",
          note: "Driven by `visibilitychange`. Switching tabs or minimising counts as background; clicking another window does not, because the page is still visible.",
        },
        {
          target: "Mobile web",
          status: "yes",
          note: "Same, plus the back-forward cache restore on Safari.",
        },
        { target: "Installed PWA", status: "yes" },
        {
          target: "iOS",
          status: "yes",
          note: "The OS resume and pause events, so a phone call or pulling down Notification Centre counts too.",
        },
        {
          target: "Android",
          status: "yes",
          note: "The OS resume and pause events.",
        },
      ],
    },

    { type: "h2", text: "useScreenLifecycle" },
    {
      type: "api",
      name: "useScreenLifecycle()",
      signature:
        "function useScreenLifecycle(lifecycle: { onEnter?: () => void; onLeave?: () => void }): void",
      description:
        "Enter and leave callbacks for a route component. adaptv does not keep popped screens mounted, so a screen's mount is its enter and its unmount is its leave; this hook is a mount effect with stable callbacks and the names you think in. Inline arrows are safe: they are held in refs and do not re-trigger on re-render.",
      params: [
        {
          name: "onEnter",
          type: "() => void",
          description: "Called once when the screen mounts.",
        },
        {
          name: "onLeave",
          type: "() => void",
          description:
            "Called once when the screen unmounts. Its return value is ignored.",
        },
      ],
    },
    {
      type: "code",
      label: "player.page.tsx",
      lang: "tsx",
      code: `useScreenLifecycle({
  onEnter: () => analytics.screen("player"),
  onLeave: () => audio.stop(),
})`,
    },
    {
      type: "note",
      tone: "info",
      text: "It does not fire when the app goes to the background and comes back. The screen stays mounted through that. Use `useOnResume` and `useOnPause` for it.",
    },

    { type: "h2", text: "The back press" },
    {
      type: "p",
      text: "A back press has several possible owners: an open menu should close, then a sheet, and only then should the router navigate. adaptv keeps one chain of handlers. A back press walks it from the highest priority to the lowest, and the first handler to return `true` consumes the press. Within one priority the most recently registered handler goes first, so the top of two stacked sheets closes first. A handler that throws is treated as having returned `false`.",
    },
    {
      type: "api",
      name: "useBackHandler()",
      signature:
        "function useBackHandler(handler: () => boolean, priority?: number): void",
      description:
        "Intercept the back press while the component is mounted. Return `true` to consume it, `false` to pass it to the next handler. The handler is held in a ref, so changing its identity does not re-register it, and its place in the chain stays tied to mount order.",
      params: [
        {
          name: "handler",
          type: "() => boolean",
          required: true,
          description: "Return `true` when you handled the press.",
        },
        {
          name: "priority",
          type: "number",
          default: "BackPriority.Transient (300)",
          description:
            "Where in the chain to sit. Use a `BackPriority` band, or any number to slot between two bands. Changing it re-registers the handler.",
        },
      ],
    },
    { type: "h3", text: "BackPriority" },
    {
      type: "p",
      text: 'Exported from [capabilities](/docs/capabilities): `import { BackPriority } from "@arrzdev/adaptv/capabilities"`.',
    },
    {
      type: "table",
      head: ["Band", "Value", "For"],
      rows: [
        [
          "`BackPriority.Overlay`",
          "400",
          "Drawers, modals, sheets, while open.",
        ],
        [
          "`BackPriority.Transient`",
          "300",
          "Menus, search fields, anything that should dismiss before navigating. The default.",
        ],
        [
          "`BackPriority.Affordance`",
          "200",
          "An in-app back control with its own logic.",
        ],
        [
          "`BackPriority.RouterBack`",
          "100",
          "Router history back. adaptv's floor handler lives here.",
        ],
        [
          "`BackPriority.ExitApp`",
          "0",
          "Exit the app. Reached only with no history left.",
        ],
      ],
    },
    {
      type: "code",
      label: "filters-sheet.tsx",
      lang: "tsx",
      code: `import { useBackHandler } from "@arrzdev/adaptv/hooks"
import { BackPriority } from "@arrzdev/adaptv/capabilities"

useBackHandler(() => {
  if (!open) return false // nothing to close, let the router have it
  setOpen(false)
  return true
}, BackPriority.Overlay)`,
    },
    {
      type: "note",
      tone: "info",
      text: "[Dropdown](/docs/dropdown) registers itself in the `Transient` band while open. [Drawer](/docs/drawer) does not register a back handler today; add the snippet above next to a drawer that should close on back.",
    },
    {
      type: "api",
      name: "adaptvBack()",
      signature: "function adaptvBack(): boolean",
      description:
        "Go back, programmatically, through the same chain the Android hardware button uses. Wire it to your header's back button so it closes an open overlay first and navigates second, exactly like the hardware button.",
      returns:
        "`true` if something handled the press. `false` on web with no history left, where nothing should happen.",
    },
    {
      type: "code",
      label: "header.tsx",
      lang: "tsx",
      code: `<Button onClick={() => adaptvBack()} aria-label="Back">
  <ChevronLeft />
</Button>`,
    },
    {
      type: "api",
      name: "useAndroidBackButton()",
      signature: "function useAndroidBackButton(): void",
      description:
        "Installs the chain's floor handler and, on Android native, the hardware back button listener. The app shell mounts it once inside the router; you do not call it in an app built on the shell. The floor handler goes back in router history when there is history, exits the app on native when there is none, and on web returns `false` so a tab is never closed from under the user.",
    },
    {
      type: "targets",
      rows: [
        {
          target: "Desktop web",
          status: "partial",
          note: "No hardware button. The chain runs when you call `adaptvBack()`. The browser's own back button goes to the router directly and does not walk the chain.",
        },
        {
          target: "Mobile web",
          status: "partial",
          note: "Same as desktop web.",
        },
        {
          target: "Installed PWA",
          status: "partial",
          note: "No browser chrome, so an in-app back control calling `adaptvBack()` is the way back.",
        },
        {
          target: "iOS",
          status: "partial",
          note: "No hardware button. `adaptvBack()` walks the chain; with no history left the floor handler asks the OS to exit the app.",
        },
        {
          target: "Android",
          status: "yes",
          note: "The system back button walks the chain. With no history left it exits the app.",
        },
      ],
    },

    { type: "h2", text: "useKeepAwake" },
    {
      type: "api",
      name: "useKeepAwake()",
      signature:
        "function useKeepAwake(options?: { enabled?: boolean }): UseKeepAwakeResult",
      description:
        "Hold the screen on: a recipe, a workout timer, a boarding pass. One implementation on every target, the Screen Wake Lock API, which the native WebViews also carry. The platform drops the lock whenever the page is hidden; adaptv takes it again when the app comes back, until you release it.",
      params: [
        {
          name: "enabled",
          type: "boolean",
          default: "false",
          description:
            "Hold the lock for as long as the component is mounted and release it on unmount. Leave it off and call `request` and `release` yourself when the lock follows a user toggle.",
        },
      ],
      returns:
        "`{ supported, active, caveat, request, release, lastOutcome }`.",
    },
    {
      type: "props",
      rows: [
        {
          name: "supported",
          type: "boolean",
          description:
            "Whether the wake lock API exists here. `false` on the server. When `false`, do not render the toggle.",
        },
        {
          name: "active",
          type: "boolean",
          description: "Whether the screen is being held on right now.",
        },
        {
          name: "caveat",
          type: "string | null",
          description:
            "A sentence describing a way the lock can report success and still fail, or `null`. Today there is one: an installed PWA on iOS below 18.4 resolves the lock and dims the screen anyway. Render it next to the toggle.",
        },
        {
          name: "request",
          type: '() => Promise<"held" | "unsupported" | "rejected">',
          description:
            "Take the lock. Never rejects. Call it from a user gesture where you can: a request made while the page is hidden is refused.",
        },
        {
          name: "release",
          type: "() => Promise<void>",
          description:
            "Let the screen sleep again. Safe to call when nothing is held.",
        },
        {
          name: "lastOutcome",
          type: '"held" | "unsupported" | "rejected" | null',
          description:
            "Outcome of the most recent request, `null` before the first.",
        },
      ],
    },
    {
      type: "table",
      head: ["Outcome", "Meaning"],
      rows: [
        ['`"held"`', "The screen is being kept on."],
        ['`"unsupported"`', "No wake lock API. Asking again cannot help."],
        [
          '`"rejected"`',
          "The API refused: power-save mode, low battery, or a hidden page. Temporary; retry once the condition clears.",
        ],
      ],
    },
    {
      type: "code",
      label: "recipe.page.tsx",
      lang: "tsx",
      code: `// Held for as long as the recipe is on screen
useKeepAwake({ enabled: true })

// Or behind a toggle
const { supported, active, caveat, request, release } = useKeepAwake()
if (!supported) return null
<Switch checked={active} onCheckedChange={(on) => (on ? request() : release())} />
{caveat && <Text className="text-xs">{caveat}</Text>}`,
    },
    {
      type: "note",
      tone: "info",
      text: "The lock is one per app, not one per component. Two components that both pass `enabled: true` share it, and the first to unmount releases it for both.",
    },
    {
      type: "targets",
      rows: [
        {
          target: "Desktop web",
          status: "yes",
          note: "Chrome 84+, Firefox 126+, Safari 16.4+.",
        },
        { target: "Mobile web", status: "yes", note: "Same browser versions." },
        {
          target: "Installed PWA",
          status: "partial",
          note: "Works, except on iOS below 18.4, where the request resolves and the screen still dims. `caveat` reports it.",
        },
        {
          target: "iOS",
          status: "yes",
          note: "The same API inside the native WebView. Confirmed on the simulator; the lit screen on a physical iPhone is still to be verified.",
        },
        {
          target: "Android",
          status: "yes",
          note: 'Holds the screen, verified against the OS power state. Power-save mode answers `"rejected"`.',
        },
      ],
    },

    { type: "h2", text: "createBootstrapGate" },
    {
      type: "api",
      name: "createBootstrapGate()",
      signature: "function createBootstrapGate(): BootstrapGate",
      description:
        "A small ready flag for cold start. Create one at module scope, set it when the app's own boot work is done (a local database seeded, a session restored), and read it wherever something should wait, usually the splash screen. It is a factory, so an app can hold more than one gate. It has no connection to the router or the shell; it is only the flag and its subscription.",
      returns: "A `BootstrapGate` with the five members below.",
    },
    {
      type: "props",
      rows: [
        {
          name: "useBootstrapReady",
          type: "() => boolean",
          description: "The flag as a hook. `false` on the server.",
        },
        {
          name: "getBootstrapReady",
          type: "() => boolean",
          description: "The flag, read once.",
        },
        {
          name: "setBootstrapReady",
          type: "() => void",
          description: "Mark ready. Does nothing if already ready.",
        },
        {
          name: "resetBootstrapReady",
          type: "() => void",
          description:
            "Back to not ready, for example when the user signs out and boot work must run again.",
        },
        {
          name: "subscribeBootstrapReady",
          type: "(onStoreChange: () => void) => () => void",
          description:
            "Subscribe to changes outside React. Returns an unsubscribe.",
        },
      ],
    },
    {
      type: "code",
      label: "app-ready.ts",
      lang: "ts",
      code: `import { createBootstrapGate } from "@arrzdev/adaptv/hooks"

const gate = createBootstrapGate()

export const useAppReady = gate.useBootstrapReady
export const setAppReady = gate.setBootstrapReady`,
    },
    {
      type: "code",
      label: "providers.tsx",
      lang: "tsx",
      code: `useEffect(() => {
  void seedLocalDatabase().then(setAppReady)
}, [])

// in the splash screen
const ready = useAppReady()`,
    },
    {
      type: "p",
      text: "See [icons and splash](/docs/icons-and-splash) for how the splash screen uses a gate to decide when to reveal the app.",
    },
  ],
}
