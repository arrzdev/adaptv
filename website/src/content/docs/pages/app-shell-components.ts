import type { DocPage } from "@/content/docs/types"

export const page: DocPage = {
  slug: "app-shell-components",
  title: "App shell components",
  summary:
    "The app-level screens and listeners: update required, rotate guard, edge swipes, not found, boot error and the splash frame.",
  platforms: ["Web", "PWA", "iOS", "Android"],
  importLine:
    'import { EdgeSwipeGestures, PwaSplashOverlay, UiNotFound, BootError, UpdateRequired, OrientationGuard } from "@arrzdev/adaptv/components"',
  source: "src/components",
  blocks: [
    {
      type: "p",
      text: "These components work at the level of the whole app. Most of them are mounted for you by adaptv's shell, and what you control is a key in `adaptv.config.ts`: either a number that turns the screen on, or a thunk that swaps adaptv's screen for yours. Two of them, `EdgeSwipeGestures` and `PwaSplashOverlay`, you place yourself.",
    },
    {
      type: "table",
      head: ["Component", "Who mounts it", "What you control"],
      rows: [
        [
          "`UpdateRequired`",
          "The shell, always. Renders nothing until you opt in.",
          "`updateRequiredAfterDays`, `updateRequiredScreen`",
        ],
        [
          "`OrientationGuard`",
          "The shell, always. Renders nothing unless the app locks an orientation.",
          "`orientation`, `orientationGuardScreen`",
        ],
        ["`EdgeSwipeGestures`", "You, in a page or layout.", "Its props."],
        [
          "`UiNotFound`",
          "The root route, when no route matches.",
          "`notFoundScreen`",
        ],
        [
          "`BootError`",
          "The build. Prerendered into the HTML document.",
          "`bootErrorScreen`",
        ],
        [
          "`PwaSplashOverlay`",
          "You, inside your `splashScreen` component.",
          "Its props.",
        ],
      ],
    },
    {
      type: "p",
      text: 'Every screen thunk has the same shape: `() => import("@/components/my-screen")`, where the module\'s default export is the component. The thunk is never executed. The Vite plugin reads the import path and emits a static import, so these screens ship in the main bundle. The full list of keys is on the [config](/docs/config) page. The offline screen has [its own page](/docs/offline-boundary).',
    },
    {
      type: "p",
      text: "The full-screen layers stack in a fixed order: a [Drawer](/docs/drawer) at `z-50`, the splash at `z-100`, the rotate guard at `z-110`, and the update screen on top at `z-120`. An install that cannot be updated is a harder stop than a phone held the wrong way round.",
    },

    { type: "h2", text: "UpdateRequired" },
    {
      type: "p",
      text: "Takes the screen when a native install can no longer be updated over the air. That happens when a published build was made against a different set of native plugins than the installed binary has: from then on only a store update brings the two back into line. The [OTA updates guide](/docs/ota-updates) explains the mechanism.",
    },
    {
      type: "p",
      text: "An install in that state still works, so blocking it is opt-in, and opt-in by a number. With no `updateRequiredAfterDays` the component renders nothing, ever. Set it when a server contract moved with the native release (an API, a data shape, an auth flow) and an old binary cannot use the app correctly any more.",
    },
    {
      type: "code",
      label: "adaptv.config.ts",
      lang: "ts",
      code: `export default defineApp({
  // take the screen once an install has been stuck for two weeks
  updateRequiredAfterDays: 14,
  // optional: your own screen
  updateRequiredScreen: () => import("@/components/update-required"),
})`,
    },
    {
      type: "p",
      text: "`0` blocks the moment the channel moves. The channel moves when a release is built, which is usually before store review lets anyone install it, so `0` is only right when the contract broke with the release. A larger number lets the store catch up first. For anything short of taking the screen, such as a banner or a badge, read the same state with `useStoreRelease()` from [update hooks](/docs/hooks-updates).",
    },
    { type: "h3", text: "Props of your screen" },
    {
      type: "p",
      text: "Your `updateRequiredScreen` receives the three props below. adaptv's default screen states the age and never promises that the new version is downloadable yet, because adaptv cannot know whether it has cleared review. If you know your release is out, say so in yours. Like the rotate prompt, your screen is rendered as is and has to cover the viewport itself.",
    },
    {
      type: "code",
      label: "src/components/update-required.tsx",
      lang: "tsx",
      code: `type Props = { days: number; since: number; buildTag: string }

export default function UpdateRequired({ days, buildTag }: Props) {
  return (
    <div role="alert" className="fixed inset-0 z-[120] flex flex-col items-center justify-center gap-4 bg-white p-8 text-center">
      <h1 className="text-lg font-semibold">Update Notes to continue</h1>
      <p className="text-sm text-gray-600">This version stopped updating {days} days ago.</p>
      <a href="https://apps.apple.com/app/id0000000000" className="rounded-full bg-black px-5 py-2.5 text-white">
        Open the App Store
      </a>
      <p className="font-mono text-xs text-gray-400">{buildTag}</p>
    </div>
  )
}`,
    },
    {
      type: "note",
      text: "The props type, `UpdateRequiredProps`, is not exported from a public entry point yet, so declare the shape yourself as above. `OrientationGuardProps` and `SplashScreenProps` are exported from `@arrzdev/adaptv/config`.",
    },
    {
      type: "props",
      rows: [
        {
          name: "days",
          type: "number",
          required: true,
          description:
            "Whole days this install has been unable to take what the channel publishes. Already floored.",
        },
        {
          name: "since",
          type: "number",
          required: true,
          description:
            "When it first fell behind, in milliseconds since the epoch.",
        },
        {
          name: "buildTag",
          type: "string",
          required: true,
          description:
            "The build tag the channel is offering, which is the deploy that moved past this binary. Opaque to a user; put it in a support report.",
        },
      ],
    },
    { type: "h3", text: "Props of the host" },
    {
      type: "p",
      text: "The shell passes these from your config. You only need them if you build your own shell.",
    },
    {
      type: "props",
      rows: [
        {
          name: "afterDays",
          type: "number",
          description:
            "Days behind before the screen takes over. `undefined` disables it.",
        },
        {
          name: "component",
          type: "ComponentType<UpdateRequiredProps>",
          description: "Your screen. Falls back to the built-in one.",
        },
      ],
    },
    {
      type: "targets",
      rows: [
        {
          target: "Desktop web",
          status: "no",
          note: "Never renders. The service worker is the update mechanism and there is no native layer to fall behind.",
        },
        { target: "Mobile web", status: "no", note: "Same." },
        { target: "Installed PWA", status: "no", note: "Same." },
        { target: "iOS", status: "yes" },
        { target: "Android", status: "yes" },
      ],
    },

    { type: "h2", text: "OrientationGuard" },
    {
      type: "p",
      text: 'Covers the screen with a rotate prompt when a touch device is held against the app\'s orientation lock. The lock is the `orientation` key in your config, which is written to the web app manifest; the guard reads it back from the manifest, so there is one source of truth. With `orientation: "any"`, or no lock, it renders nothing.',
    },
    {
      type: "p",
      text: "It exists because iOS ignores the manifest's orientation and has no working JavaScript orientation lock, so a runtime guard is the only reliable hold there. It only triggers for a coarse pointer, so a desktop window that happens to be wider than it is tall is never covered.",
    },
    {
      type: "code",
      label: "adaptv.config.ts",
      lang: "ts",
      code: `export default defineApp({
  orientation: "portrait",
  orientationGuardScreen: () => import("@/components/rotate-prompt"),
})`,
    },
    {
      type: "code",
      label: "src/components/rotate-prompt.tsx",
      lang: "tsx",
      code: `import type { OrientationGuardProps } from "@arrzdev/adaptv/config"

export default function RotatePrompt({ orientation }: OrientationGuardProps) {
  return (
    <div role="alert" className="fixed inset-0 z-[110] flex items-center justify-center bg-white p-8 text-center">
      Turn your phone to {orientation}.
    </div>
  )
}`,
    },
    {
      type: "p",
      text: "Your screen is rendered as is, so it must cover the viewport itself (`fixed inset-0` and a z-index above your app).",
    },
    { type: "h3", text: "Props of your screen" },
    {
      type: "props",
      rows: [
        {
          name: "orientation",
          type: '"portrait" | "landscape"',
          required: true,
          description:
            "The orientation the app requires. The device is currently rotated away from it.",
        },
      ],
    },
    { type: "h3", text: "Props of the host" },
    {
      type: "props",
      rows: [
        {
          name: "manifestPath",
          type: "string",
          required: true,
          description:
            "Path to the web app manifest whose `orientation` field drives the lock.",
        },
        {
          name: "component",
          type: "ComponentType<OrientationGuardProps>",
          description: "Your screen. Falls back to the built-in rotate prompt.",
        },
      ],
    },
    {
      type: "targets",
      rows: [
        {
          target: "Desktop web",
          status: "no",
          note: "Never shown: the pointer is not coarse.",
        },
        { target: "Mobile web", status: "yes" },
        {
          target: "Installed PWA",
          status: "yes",
          note: "The only hold on iOS. Android also enforces the manifest lock itself.",
        },
        { target: "iOS", status: "yes" },
        { target: "Android", status: "yes" },
      ],
    },
    {
      type: "note",
      text: "When a test drives the site with touch emulation in a landscape desktop viewport, the guard covers the page. Use a portrait viewport for touch tests.",
    },

    { type: "h2", text: "EdgeSwipeGestures" },
    {
      type: "p",
      text: "Listens for a swipe in from the left or right edge of the screen and calls your handler. It renders nothing. It exists for the installed app, PWA or native, where there is no browser chrome and the system's own edge-swipe navigation does not work, so without it a header button is the only way back.",
    },
    {
      type: "code",
      label: "settings.page.tsx",
      lang: "tsx",
      code: `import { EdgeSwipeGestures } from "@arrzdev/adaptv/components"
import { adaptvBack } from "@arrzdev/adaptv/hooks"
import { isInstalledApp } from "@arrzdev/adaptv/utils"

function SettingsPage() {
  return (
    <>
      <EdgeSwipeGestures enabled={isInstalledApp()} left={() => adaptvBack()} />
      <Settings />
    </>
  )
}`,
    },
    {
      type: "note",
      tone: "warn",
      text: "Gate `enabled` to the installed app. In a browser tab the browser's own edge swipe still navigates, and a second recogniser on top of it goes back twice.",
    },
    {
      type: "p",
      text: "`adaptvBack()` walks the same back chain as the Android hardware button: it closes an open [Drawer](/docs/drawer) that registered a back handler first, then goes back in history. Calling `router.navigate()` from `left` works too, and skips the chain.",
    },
    {
      type: "p",
      text: "A swipe counts when it is a single touch that starts inside the edge strip, ends at least `threshold` pixels away, moved further sideways than vertically, and travelled away from its edge. The decision is made when the finger lifts. The listeners are passive and never block scrolling. A touch that starts in the strip claims adaptv's gesture arbiter at the highest priority, so a [Swipeable](/docs/swipeable) row or a drawer under the same finger does not move.",
    },
    {
      type: "props",
      rows: [
        {
          name: "left",
          type: "() => void",
          description:
            "Called for a swipe in from the left edge, a rightward drag. The back gesture.",
        },
        {
          name: "right",
          type: "() => void",
          description:
            "Called for a swipe in from the right edge, a leftward drag. The forward gesture.",
        },
        {
          name: "enabled",
          type: "boolean",
          default: "true",
          description: "When `false`, no listeners are attached.",
        },
        {
          name: "edgeZone",
          type: "number",
          default: "30",
          description:
            "How close to a screen edge, in pixels, a touch must start.",
        },
        {
          name: "threshold",
          type: "number",
          default: "56",
          description: "Horizontal distance in pixels the touch must travel.",
        },
      ],
    },
    {
      type: "targets",
      rows: [
        {
          target: "Desktop web",
          status: "no",
          note: "Touch events only. A mouse never triggers it.",
        },
        {
          target: "Mobile web",
          status: "no",
          note: "Keep it disabled. The browser's edge swipe is the back gesture here.",
        },
        { target: "Installed PWA", status: "yes", note: "Both edges." },
        {
          target: "iOS",
          status: "yes",
          note: "The native shell has no system swipe-back, so this is the back swipe.",
        },
        {
          target: "Android",
          status: "partial",
          note: "Under gesture navigation the system claims the left edge for its own back, which runs the back chain anyway. The right edge, and both edges under 3-button navigation, reach this component.",
        },
      ],
    },

    { type: "h2", text: "UiNotFound" },
    {
      type: "p",
      text: 'The default 404 screen. The root route renders it when no route matches, with a "Back to home" [Link](/docs/link) to `/`. It carries a neutral grey look and is meant to be replaced: register your own with `notFoundScreen`.',
    },
    {
      type: "code",
      label: "adaptv.config.ts",
      lang: "ts",
      code: `export default defineApp({
  notFoundScreen: () => import("@/components/not-found"),
})`,
    },
    {
      type: "p",
      text: "A quick way to a branded 404 is to wrap `UiNotFound` and pass classes to each part. The exported name is `UiNotFound`, and its props type is `UiNotFoundProps`.",
    },
    {
      type: "code",
      label: "src/components/not-found.tsx",
      lang: "tsx",
      code: `import { UiNotFound } from "@arrzdev/adaptv/components"

export default function NotFound() {
  return (
    <UiNotFound
      homeTo="/"
      className="justify-center gap-3 bg-white px-6"
      codeClassName="font-mono text-sm"
      titleClassName="text-2xl font-semibold"
      descriptionClassName="text-sm"
      homeLinkClassName="mt-4 rounded-full bg-black px-5 py-2.5 text-white"
    />
  )
}`,
    },
    {
      type: "props",
      rows: [
        {
          name: "homeTo",
          type: "string",
          default: '"/"',
          description: "Router path for the home link.",
        },
        {
          name: "className",
          type: "string",
          description:
            "Classes for the root `<main>`, a flex column that fills its parent and centres its items horizontally.",
        },
        {
          name: "codeClassName",
          type: "string",
          description: 'Classes for the "404" label.',
        },
        {
          name: "titleClassName",
          type: "string",
          description: 'Classes for the "Page not found" heading.',
        },
        {
          name: "descriptionClassName",
          type: "string",
          description: "Classes for the sentence under it.",
        },
        {
          name: "homeLinkClassName",
          type: "string",
          description: 'Classes for the "Back to home" link.',
        },
      ],
    },
    {
      type: "p",
      text: 'The copy is fixed in English. For other wording, write your own `notFoundScreen`. Nothing on this screen is locked, and the root carries `data-adaptv="not-found"`. On a cold start into a 404 in an installed app, adaptv retires the splash itself, since your app\'s boot code never runs to dismiss it.',
    },

    { type: "h2", text: "BootError" },
    {
      type: "p",
      text: "The screen for an app whose JavaScript never ran: the entry file returned a 404, it has a syntax error, or an over-the-air bundle is corrupt. React never mounts in that case, so nothing written in React can render at run time. adaptv renders this component to static HTML **at build time** and embeds it, hidden, in the document. A small inline watchdog reveals it when the app fails to start.",
    },
    {
      type: "p",
      text: "It is not an error boundary. A route that throws, a failed fetch or a bad render are yours to catch, with your own boundary around whatever you want to protect. adaptv installs none.",
    },
    {
      type: "code",
      label: "adaptv.config.ts",
      lang: "ts",
      code: `export default defineApp({
  bootErrorScreen: () => import("@/components/boot-error"),
})`,
    },
    {
      type: "p",
      text: "Because your screen runs in Node at build time and ships as markup, it has rules:",
    },
    {
      type: "ul",
      items: [
        "It must render standalone from the `code` prop and nothing else: no hooks, no state, no browser globals during render.",
        "Event handlers are not serialised. Every `<button>` inside the screen reloads the page when clicked, because the watchdog listens for it. If the screen has more than one button, spread `bootErrorRetryProps` on the one that should reload.",
        "Tailwind classes work. They are compiled into the app's stylesheet, which is a different file from the JavaScript that broke.",
        "It is rendered once per boot code, and the watchdog reveals the matching copy.",
        "A screen that fails to prerender is a loud build warning, not a failed build.",
      ],
    },
    {
      type: "code",
      label: "src/components/boot-error.tsx",
      lang: "tsx",
      code: `import type { BootErrorProps } from "@arrzdev/adaptv/components"
import { bootErrorRetryProps } from "@arrzdev/adaptv/components"

export default function AppBootError({ code }: BootErrorProps) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
      <h1 className="text-lg font-semibold">We couldn't start the app</h1>
      <p className="text-sm text-gray-600">
        {code === "BOOT-LOAD"
          ? "Check your connection and try again."
          : "Something is wrong on our side. We're on it."}
      </p>
      <button {...bootErrorRetryProps} type="button" className="rounded-xl bg-black px-4 py-2.5 text-white">
        Try again
      </button>
      <a href="mailto:help@example.com" className="text-sm underline">Contact support</a>
    </div>
  )
}`,
    },
    {
      type: "p",
      text: "When all you want is different copy, wrap adaptv's `BootError`. It follows the same rules, so the wrapper stays a plain function of `code`.",
    },
    {
      type: "code",
      label: "src/components/boot-error.tsx",
      lang: "tsx",
      code: `import type { BootErrorProps } from "@arrzdev/adaptv/components"
import { BootError } from "@arrzdev/adaptv/components"

export default function AppBootError({ code }: BootErrorProps) {
  return (
    <BootError
      code={code}
      title="Notes couldn't start"
      description={code === "BOOT-LOAD" ? "Check your connection." : "Please try again in a minute."}
      retryLabel="Reload"
    />
  )
}`,
    },
    { type: "h3", text: "Props of BootError" },
    {
      type: "props",
      rows: [
        {
          name: "code",
          type: '"BOOT-LOAD" | "BOOT-THROW" | "BOOT-REJECT" | "BOOT-STALL"',
          description:
            "How the boot failed. adaptv's own screen never displays it. It is there so your screen can branch on it.",
        },
        {
          name: "title",
          type: "string",
          default: '"Couldn\'t load the app"',
          description: "The heading.",
        },
        {
          name: "description",
          type: "string",
          default: '"Something went wrong while starting up."',
          description: "The line under it.",
        },
        {
          name: "retryLabel",
          type: "string",
          default: '"Try again"',
          description: "The button's label.",
        },
        {
          name: "className",
          type: "string",
          description: "Classes for the root, merged over the defaults.",
        },
      ],
    },
    {
      type: "table",
      head: ["Code", "Signal", "What it means"],
      rows: [
        [
          "`BOOT-LOAD`",
          "The entry `<script>` fired `error`.",
          "The file is not being served: a deploy, a CDN, no connection.",
        ],
        [
          "`BOOT-THROW`",
          "An uncaught error before the app mounted.",
          "The file arrived and the code in it is broken.",
        ],
        [
          "`BOOT-REJECT`",
          "An unhandled promise rejection before the app mounted.",
          "The same, by way of a promise.",
        ],
        [
          "`BOOT-STALL`",
          "The grace period passed and nothing mounted.",
          "It arrived, it ran, it raised nothing, and it never mounted.",
        ],
      ],
    },
    {
      type: "p",
      text: 'The code is also stamped on the document as `<html data-adaptv-boot-failed="BOOT-LOAD">`, so telemetry and end-to-end tests can read one attribute. In a native build `data-adaptv-boot-bundle` lands next to it with the build tag of the bundle that was running, or `embedded` for the one inside the binary, which tells you which deploy to roll back. The default screen carries the adaptv mark, follows light and dark through `dark:` classes, and has `data-adaptv="boot-error"`.',
    },
    {
      type: "note",
      text: "One failure sits below this screen: the HTML document itself never loading. In a native build adaptv generates a separate static error page for that. On the web it is the browser's own error page.",
    },

    { type: "h2", text: "PwaSplashOverlay" },
    {
      type: "p",
      text: "A full-viewport frame for your splash screen, with centred content. It is a building block, and adaptv never mounts it. You return it from the component you register as `splashScreen`. The shell mounts that component while the app boots, and the component dismisses itself by returning `null` when the app is ready. [Icons and splash](/docs/icons-and-splash) covers the launch sequence.",
    },
    {
      type: "code",
      label: "src/components/splash-screen.tsx",
      lang: "tsx",
      code: `import { PwaSplashOverlay } from "@arrzdev/adaptv/components"
import type { SplashScreenProps } from "@arrzdev/adaptv/config"

const MIN_VISIBLE_MS = 600

export default function SplashScreen({ revealedAt }: SplashScreenProps) {
  const ready = useAppReady()
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    if (!ready || revealedAt === null) return
    // time the minimum from the moment the splash became visible, not from mount
    const wait = Math.max(MIN_VISIBLE_MS - (Date.now() - revealedAt), 0)
    const timer = setTimeout(() => setDismissed(true), wait)
    return () => clearTimeout(timer)
  }, [ready, revealedAt])

  if (dismissed) return null

  return (
    <PwaSplashOverlay className="bg-white dark:bg-black">
      <Logo className="size-24" />
      <p className="text-2xl font-bold tracking-widest">NOTES</p>
    </PwaSplashOverlay>
  )
}`,
    },
    {
      type: "p",
      text: "The frame has two layers. The outer **coverage** box is pinned to the viewport and paints the background, so app content can never show past its edges during boot. The inner **centring** region positions your content. Constrain the inner region with `centerClassName`, for example to a fixed launch height so the logo does not shift when the viewport settles on an iOS home-screen launch, and the coverage box still spans the whole screen. Children are stacked in a centred column with a `gap-8`.",
    },
    {
      type: "props",
      rows: [
        {
          name: "children",
          type: "ReactNode",
          description: "The logo, wordmark or animation.",
        },
        {
          name: "className",
          type: "string",
          description:
            "Classes for the coverage box. The default background is `bg-background`. `fixed inset-0 z-[100]` is locked.",
        },
        {
          name: "style",
          type: "CSSProperties",
          description: "Inline style for the coverage box.",
        },
        {
          name: "centerClassName",
          type: "string",
          description:
            "Classes for the centring region. It defaults to `inset-0 flex flex-col items-center justify-center`, and you can move any edge. `absolute` is locked.",
        },
        {
          name: "centerStyle",
          type: "CSSProperties",
          description: "Inline style for the centring region.",
        },
      ],
    },
    {
      type: "p",
      text: "The coverage box carries `data-adaptv-splash`, and adaptv's critical CSS keys two behaviours on it. In a browser tab the splash is `display: none` unless you set `splashScreenInBrowser: true`, so a tab gets the page immediately. And until the OS launch splash has come off, every animation inside the splash is paused, so an intro animation starts when a person can see it.",
    },
    {
      type: "targets",
      rows: [
        {
          target: "Desktop web",
          status: "partial",
          note: "Hidden by default. Shown with `splashScreenInBrowser: true`.",
        },
        { target: "Mobile web", status: "partial", note: "Same." },
        { target: "Installed PWA", status: "yes" },
        {
          target: "iOS",
          status: "yes",
          note: "Painted underneath the OS launch splash, which hands over to it without a flicker.",
        },
        { target: "Android", status: "yes", note: "Same." },
      ],
    },
  ],
}
