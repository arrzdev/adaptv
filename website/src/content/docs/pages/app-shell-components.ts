import type { DocPage } from "@/content/docs/types"

export const page: DocPage = {
  slug: "app-shell-components",
  title: "App shell components",
  summary: "Whole-app screens and listeners.",
  platforms: ["Web", "PWA", "iOS", "Android"],
  importLine:
    'import { EdgeSwipeGestures, PwaSplashOverlay, UiNotFound, BootError, UpdateRequired, OrientationGuard } from "@arrzdev/adaptv/components"',
  source: "src/components",
  blocks: [
    {
      type: "p",
      text: 'adaptv mounts most of these for you. You set a key in `adaptv.config.ts`: a number to turn a screen on, or a thunk such as `() => import("@/components/my-screen")` to replace adaptv\'s screen with yours. The module default export is the component. The screens ship in the main bundle. See [config](/docs/config). The offline screen has [its own page](/docs/offline-boundary).',
    },
    {
      type: "table",
      head: ["Component", "Who mounts it", "What you set"],
      rows: [
        [
          "`UpdateRequired`",
          "The shell. It renders nothing until you opt in.",
          "`updateRequiredAfterDays`, `updateRequiredScreen`",
        ],
        [
          "`OrientationGuard`",
          "The shell. It renders nothing without an orientation lock.",
          "`orientation`, `orientationGuardScreen`",
        ],
        ["`EdgeSwipeGestures`", "You.", "Its props."],
        [
          "`UiNotFound`",
          "The root route, when no route matches.",
          "`notFoundScreen`",
        ],
        [
          "`BootError`",
          "The build, into the HTML document.",
          "`bootErrorScreen`",
        ],
        [
          "`PwaSplashOverlay`",
          "You, inside your `splashScreen`.",
          "Its props.",
        ],
      ],
    },
    { type: "h2", text: "UpdateRequired" },
    {
      type: "p",
      text: "A native install may no longer be able to update over the air. This happens when a build was made for different native plugins than the installed binary has. Only a store update fixes it. See [OTA updates](/docs/ota-updates). The install still works, so the screen is opt-in. Set `updateRequiredAfterDays` to turn it on. `0` blocks as soon as the channel moves. For a banner, read `useStoreRelease()` from [update hooks](/docs/hooks-updates).",
    },
    {
      type: "code",
      label: "adaptv.config.ts",
      lang: "ts",
      code: `export default defineApp({
  updateRequiredAfterDays: 14,
  updateRequiredScreen: () => import("@/components/update-required"),
})`,
    },
    {
      type: "p",
      text: "Your screen receives these props. It is rendered as is, so it must cover the viewport itself. `UpdateRequiredProps` is not exported yet. Declare the type yourself.",
    },
    {
      type: "props",
      rows: [
        {
          name: "days",
          type: "number",
          required: true,
          description:
            "Whole days this install could not take the channel build.",
        },
        {
          name: "since",
          type: "number",
          required: true,
          description: "When it fell behind, in milliseconds since the epoch.",
        },
        {
          name: "buildTag",
          type: "string",
          required: true,
          description:
            "The build tag the channel offers. Put it in a support report.",
        },
      ],
    },
    {
      type: "targets",
      rows: [
        {
          target: "Desktop web",
          status: "no",
          note: "The service worker updates the app.",
        },
        { target: "Mobile web", status: "no" },
        { target: "Installed PWA", status: "no" },
        { target: "iOS", status: "yes" },
        { target: "Android", status: "yes" },
      ],
    },
    { type: "h2", text: "OrientationGuard" },
    {
      type: "p",
      text: 'A rotate prompt covers the screen when a touch device is held against the `orientation` lock in your config. The guard reads the lock from the web app manifest. With `"any"` or no lock, it renders nothing. It acts only for a coarse pointer. iOS ignores the manifest lock, so this guard is the only hold there. Your screen must cover the viewport itself.',
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
      type: "props",
      rows: [
        {
          name: "orientation",
          type: '"portrait" | "landscape"',
          required: true,
          description:
            "The orientation the app requires, from `OrientationGuardProps` in `@arrzdev/adaptv/config`.",
        },
      ],
    },
    {
      type: "targets",
      rows: [
        {
          target: "Desktop web",
          status: "no",
          note: "The pointer is not coarse.",
        },
        { target: "Mobile web", status: "yes" },
        {
          target: "Installed PWA",
          status: "yes",
          note: "Android also enforces the manifest lock.",
        },
        { target: "iOS", status: "yes" },
        { target: "Android", status: "yes" },
      ],
    },
    { type: "h2", text: "EdgeSwipeGestures" },
    {
      type: "p",
      text: "Calls your handler on a swipe in from the left or right screen edge. It renders nothing. Use it in an installed app, where no browser chrome gives a back swipe. Set `enabled` to the installed app only. In a browser tab, the browser's own swipe goes back too.",
    },
    {
      type: "code",
      label: "settings.page.tsx",
      lang: "tsx",
      code: `<EdgeSwipeGestures enabled={isInstalledApp()} left={() => adaptvBack()} />`,
    },
    {
      type: "p",
      text: "`adaptvBack()` runs the same back chain as the Android back button. It closes an open [Drawer](/docs/drawer) first, then goes back in history. A swipe is one touch that starts in the edge strip and travels at least `threshold` pixels, more sideways than vertically. A touch that starts in the strip wins over a [Swipeable](/docs/swipeable) row and a drawer drag.",
    },
    {
      type: "props",
      rows: [
        {
          name: "left",
          type: "() => void",
          description: "Called for a swipe in from the left edge.",
        },
        {
          name: "right",
          type: "() => void",
          description: "Called for a swipe in from the right edge.",
        },
        {
          name: "enabled",
          type: "boolean",
          default: "true",
          description: "`false` attaches no listeners.",
        },
        {
          name: "edgeZone",
          type: "number",
          default: "30",
          description: "How close to the edge, in pixels, a touch must start.",
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
        { target: "Desktop web", status: "no", note: "Touch only." },
        {
          target: "Mobile web",
          status: "no",
          note: "Keep it off. The browser swipe goes back.",
        },
        { target: "Installed PWA", status: "yes", note: "Both edges." },
        {
          target: "iOS",
          status: "yes",
          note: "The native shell has no system swipe-back.",
        },
        {
          target: "Android",
          status: "partial",
          note: "Gesture navigation takes the left edge. The right edge and 3-button navigation reach this component.",
        },
      ],
    },
    { type: "h2", text: "UiNotFound" },
    {
      type: "p",
      text: 'The default 404 screen, with a "Back to home" [Link](/docs/link). Replace it with `notFoundScreen`, or wrap `UiNotFound` and pass classes. The text is English only. Nothing is locked. The root has `data-adaptv="not-found"`.',
    },
    {
      type: "code",
      label: "src/components/not-found.tsx",
      lang: "tsx",
      code: `export default function NotFound() {
  return <UiNotFound className="justify-center bg-white" titleClassName="text-2xl font-semibold" />
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
          description: "Classes for the root `main`.",
        },
        {
          name: "codeClassName",
          type: "string",
          description: 'Classes for the "404" label.',
        },
        {
          name: "titleClassName",
          type: "string",
          description: "Classes for the heading.",
        },
        {
          name: "descriptionClassName",
          type: "string",
          description: "Classes for the sentence under it.",
        },
        {
          name: "homeLinkClassName",
          type: "string",
          description: "Classes for the home link.",
        },
      ],
    },
    { type: "h2", text: "BootError" },
    {
      type: "p",
      text: "The screen for an app whose JavaScript never ran. adaptv renders it to HTML at build time and hides it in the document. A small script shows it when the app fails to start. It is not an error boundary. Your own boundaries catch errors in routes. Set `bootErrorScreen` to replace it.",
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
      text: "Your screen runs in Node at build time. It must render from the `code` prop alone, with no hooks, state or browser globals. Any `<button>` in it reloads the page. With several buttons, spread `bootErrorRetryProps` on the one that should reload. Tailwind classes work. To change only the text, wrap `BootError`.",
    },
    {
      type: "code",
      label: "src/components/boot-error.tsx",
      lang: "tsx",
      code: `export default function AppBootError({ code }: BootErrorProps) {
  return <BootError code={code} title="Notes could not start" retryLabel="Reload" />
}`,
    },
    {
      type: "props",
      rows: [
        {
          name: "code",
          type: '"BOOT-LOAD" | "BOOT-THROW" | "BOOT-REJECT" | "BOOT-STALL"',
          description:
            "How the boot failed. The default screen does not show it.",
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
          description: "The button label.",
        },
        {
          name: "className",
          type: "string",
          description: "Classes for the root.",
        },
      ],
    },
    {
      type: "table",
      head: ["Code", "Meaning"],
      rows: [
        [
          "`BOOT-LOAD`",
          "The entry script did not load: a deploy, a CDN or no connection.",
        ],
        ["`BOOT-THROW`", "An uncaught error before the app mounted."],
        [
          "`BOOT-REJECT`",
          "An unhandled promise rejection before the app mounted.",
        ],
        ["`BOOT-STALL`", "Nothing mounted before the grace period ended."],
      ],
    },
    {
      type: "p",
      text: 'adaptv sets `data-adaptv-boot-failed` on `<html>` to the code, for telemetry and tests. A native build also sets `data-adaptv-boot-bundle` to the running bundle tag. The root has `data-adaptv="boot-error"`.',
    },
    { type: "h2", text: "PwaSplashOverlay" },
    {
      type: "p",
      text: "A full-viewport frame for your splash screen. adaptv does not mount it. Return it from the component you set as `splashScreen`. Return `null` when the app is ready. See [Icons and splash](/docs/icons-and-splash). The outer box covers the viewport and paints the background. The inner region centres the children in a column with `gap-8`. In a browser tab the splash is hidden unless `splashScreenInBrowser` is `true`. Animations inside it wait until the OS launch splash is gone.",
    },
    {
      type: "code",
      label: "src/components/splash-screen.tsx",
      lang: "tsx",
      code: `export default function SplashScreen() {
  const ready = useAppReady() // your app's own ready check
  if (ready) return null
  return (
    <PwaSplashOverlay className="bg-white dark:bg-black">
      <Logo className="size-24" />
    </PwaSplashOverlay>
  )
}`,
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
            "Classes for the outer box. The default background is `bg-background`. `fixed inset-0 z-[100]` is locked.",
        },
        {
          name: "style",
          type: "CSSProperties",
          description: "Inline style for the outer box.",
        },
        {
          name: "centerClassName",
          type: "string",
          description:
            "Classes for the inner region. The default is `inset-0 flex flex-col items-center justify-center`. `absolute` is locked.",
        },
        {
          name: "centerStyle",
          type: "CSSProperties",
          description: "Inline style for the inner region.",
        },
      ],
    },
    {
      type: "targets",
      rows: [
        {
          target: "Desktop web",
          status: "partial",
          note: "Hidden unless `splashScreenInBrowser` is `true`.",
        },
        { target: "Mobile web", status: "partial", note: "Same." },
        { target: "Installed PWA", status: "yes" },
        {
          target: "iOS",
          status: "yes",
          note: "It sits under the OS launch splash.",
        },
        { target: "Android", status: "yes" },
      ],
    },
  ],
}
