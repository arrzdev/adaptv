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
      text: "A native WebView sends no browser `focus` event when the app returns. These hooks give the right signal on every target.",
    },
    {
      type: "api",
      name: "useAppState()",
      signature: 'function useAppState(): "active" | "background"',
      description: "The foreground state.",
      returns: '`"active"` or `"background"`. `"active"` on the server.',
    },
    {
      type: "api",
      name: "useOnResume()",
      signature: "function useOnResume(callback: () => void): void",
      description:
        "Run a callback when the app returns to the foreground. A page restored from the back-forward cache counts. A first load does not.",
      params: [
        {
          name: "callback",
          type: "() => void",
          required: true,
          description: "Called on each return.",
        },
      ],
    },
    {
      type: "api",
      name: "useOnPause()",
      signature: "function useOnPause(callback: () => void): void",
      description:
        "Run a callback when the app leaves the foreground. Keep the work short. The OS can suspend the app right after.",
      params: [
        {
          name: "callback",
          type: "() => void",
          required: true,
          description: "Called on each exit.",
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
          note: "Uses `visibilitychange`. Another window with focus is not background.",
        },
        { target: "Mobile web", status: "yes" },
        { target: "Installed PWA", status: "yes" },
        { target: "iOS", status: "yes", note: "Uses the OS events." },
        { target: "Android", status: "yes", note: "Uses the OS events." },
      ],
    },

    { type: "h2", text: "useScreenLifecycle" },
    {
      type: "api",
      name: "useScreenLifecycle()",
      signature:
        "function useScreenLifecycle(lifecycle: { onEnter?: () => void; onLeave?: () => void }): void",
      description:
        "Enter and leave callbacks for a route component. adaptv does not keep closed screens mounted. Mount is enter. Unmount is leave.",
      params: [
        {
          name: "onEnter",
          type: "() => void",
          description: "Called when the screen mounts.",
        },
        {
          name: "onLeave",
          type: "() => void",
          description: "Called when the screen unmounts.",
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
      text: "It does not fire when the app goes to the background. Use `useOnResume` and `useOnPause`.",
    },

    { type: "h2", text: "The back press" },
    {
      type: "p",
      text: "adaptv keeps one chain of back handlers. A back press runs them from the highest priority down. The first handler that returns `true` consumes the press. At equal priority, the newest runs first. A handler that throws counts as `false`.",
    },
    {
      type: "api",
      name: "useBackHandler()",
      signature:
        "function useBackHandler(handler: () => boolean, priority?: number): void",
      description:
        "Intercept the back press while the component is mounted. Return `true` to consume it. Return `false` to pass it on.",
      params: [
        {
          name: "handler",
          type: "() => boolean",
          required: true,
          description: "Return `true` if you handled the press.",
        },
        {
          name: "priority",
          type: "number",
          default: "BackPriority.Transient (300)",
          description: "Place in the chain. A change re-registers the handler.",
        },
      ],
    },
    { type: "h3", text: "BackPriority" },
    {
      type: "p",
      text: 'Import it from [capabilities](/docs/capabilities): `import { BackPriority } from "@arrzdev/adaptv/capabilities"`.',
    },
    {
      type: "table",
      head: ["Band", "Value", "For"],
      rows: [
        ["`BackPriority.Overlay`", "400", "Drawers, modals and sheets."],
        [
          "`BackPriority.Transient`",
          "300",
          "Menus and search fields. Default.",
        ],
        ["`BackPriority.Affordance`", "200", "An in-app back control."],
        ["`BackPriority.RouterBack`", "100", "Router history back."],
        ["`BackPriority.ExitApp`", "0", "Exit the app."],
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
      text: "[Drawer](/docs/drawer) registers at `Overlay` while open. [Dropdown](/docs/dropdown) registers at `Transient` while open.",
    },
    {
      type: "api",
      name: "adaptvBack()",
      signature: "function adaptvBack(): boolean",
      description:
        "Go back through the same chain as the Android hardware button. Use it for a header back button.",
      returns: "`true` if a handler consumed the press.",
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
        "Installs the base handler and the Android hardware back listener. The app shell calls it. You do not. The base handler goes back in history. With no history, it exits the app on native and does nothing on web.",
    },
    {
      type: "targets",
      rows: [
        {
          target: "Desktop web",
          status: "partial",
          note: "No hardware button. The browser back button skips the chain.",
        },
        {
          target: "Mobile web",
          status: "partial",
          note: "Same as desktop web.",
        },
        {
          target: "Installed PWA",
          status: "partial",
          note: "Call `adaptvBack()` from an in-app control.",
        },
        {
          target: "iOS",
          status: "partial",
          note: "No hardware button. Call `adaptvBack()`.",
        },
        {
          target: "Android",
          status: "yes",
          note: "The system back button runs the chain.",
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
        "Keep the screen on. It uses the Screen Wake Lock API on every target. adaptv takes the lock again when the app returns to the foreground.",
      params: [
        {
          name: "enabled",
          type: "boolean",
          default: "false",
          description:
            "Hold the lock while the component is mounted. Leave it off to call `request` and `release` yourself.",
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
          description: "`true` if the API exists. `false` on the server.",
        },
        {
          name: "active",
          type: "boolean",
          description: "`true` while the screen is held on.",
        },
        {
          name: "caveat",
          type: "string | null",
          description:
            "A case where the lock reports success and fails, or `null`. Today: an installed PWA on iOS below 18.4. Show it next to the toggle.",
        },
        {
          name: "request",
          type: '() => Promise<"held" | "unsupported" | "rejected">',
          description:
            "Take the lock. It never rejects. Call it from a user gesture.",
        },
        {
          name: "release",
          type: "() => Promise<void>",
          description: "Let the screen sleep.",
        },
        {
          name: "lastOutcome",
          type: '"held" | "unsupported" | "rejected" | null',
          description: "Result of the last request.",
        },
      ],
    },
    {
      type: "table",
      head: ["Outcome", "Meaning"],
      rows: [
        ['`"held"`', "The screen stays on."],
        ['`"unsupported"`', "No API. Do not retry."],
        [
          '`"rejected"`',
          "Refused: power-save, low battery or hidden page. Retry later.",
        ],
      ],
    },
    {
      type: "code",
      label: "recipe.page.tsx",
      lang: "tsx",
      code: `// Held while the recipe is on screen
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
      text: "There is one lock for the app. The first component to unmount releases it for all.",
    },
    {
      type: "targets",
      rows: [
        {
          target: "Desktop web",
          status: "yes",
          note: "Chrome 84+, Firefox 126+, Safari 16.4+.",
        },
        { target: "Mobile web", status: "yes", note: "Same versions." },
        {
          target: "Installed PWA",
          status: "partial",
          note: "On iOS below 18.4 the screen still dims.",
        },
        {
          target: "iOS",
          status: "yes",
          note: "Checked on the simulator only.",
        },
        { target: "Android", status: "yes" },
      ],
    },

    { type: "h2", text: "createBootstrapGate" },
    {
      type: "api",
      name: "createBootstrapGate()",
      signature: "function createBootstrapGate(): BootstrapGate",
      description:
        "A ready flag for cold start. Create it at module scope. Set it when boot work is done. Read it where something must wait, such as the splash screen.",
      returns: "A `BootstrapGate` with the members below.",
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
          description: "Read the flag.",
        },
        {
          name: "setBootstrapReady",
          type: "() => void",
          description: "Mark ready.",
        },
        {
          name: "resetBootstrapReady",
          type: "() => void",
          description: "Mark not ready.",
        },
        {
          name: "subscribeBootstrapReady",
          type: "(onStoreChange: () => void) => () => void",
          description: "Subscribe outside React.",
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
      text: "See [icons and splash](/docs/icons-and-splash).",
    },
  ],
}
