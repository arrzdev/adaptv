import type { DocPage } from "@/content/docs/types"

export const page: DocPage = {
  slug: "config",
  title: "adaptv.config.ts",
  summary:
    "Every key of defineApp: the one file the web build, the service worker, the manifest and both native projects are derived from.",
  platforms: ["Web", "PWA", "iOS", "Android"],
  importLine: 'import { defineApp } from "@arrzdev/adaptv/config"',
  source: "src/config/app-config.ts",
  blocks: [
    {
      type: "p",
      text: "`adaptv.config.ts` sits at the app root and default-exports `defineApp({ ... })`. `defineApp` is an identity function: it returns what you pass and exists for the types. The [Vite plugin](/docs/vite-plugin) and the [CLI](/docs/cli) both read this file, and everything else is generated from it: the document head, the web manifest, the service worker, the router, and the iOS and Android projects. You never write a manifest, a service-worker registration or a native project setting by hand.",
    },
    {
      type: "p",
      text: 'The file is loaded as data. Dynamic imports inside it are never executed, which is what makes the screen keys below work: `splashScreen: () => import("@/components/splash-screen")` is read for its path, and the plugin turns it into a static import in the generated root. In `dev`, saving the file reloads the config and the page. Changing `render` or the two `router` path keys needs a dev-server restart.',
    },
    { type: "h2", text: "Minimal example" },
    {
      type: "p",
      text: "Five keys are required by the type: `name`, `description`, `themeColor`, `styles` and `router` (an empty object is enough). `appId` is optional in the type but required by the CLI today. See the note under Native app below.",
    },
    {
      type: "code",
      label: "adaptv.config.ts",
      lang: "ts",
      code: `import { defineApp } from "@arrzdev/adaptv/config"

export default defineApp({
  appId: "com.acme.notes",
  name: "Notes",
  description: "Notes that work offline.",
  themeColor: { light: "#ffffff", dark: "#0a0a0c" },
  styles: "./src/styles/main.css",
  router: {},
})`,
    },
    { type: "h2", text: "Full example" },
    {
      type: "code",
      label: "adaptv.config.ts",
      lang: "ts",
      code: `import { defineApp } from "@arrzdev/adaptv/config"

export default defineApp({
  // identity
  appId: "com.acme.notes",
  appName: "Notes",
  name: "Acme Notes",
  shortName: "Notes",
  title: "Acme Notes: write anywhere",
  description: "Notes that work offline.",
  lang: "en",

  // look
  themeColor: { light: "#ffffff", dark: "#0a0a0c" },
  backgroundColor: "#ffffff",
  defaultThemePreference: "system",
  icons: "./public/favicons",
  styles: "./src/styles/main.css",
  orientation: "portrait",
  allowZoom: false,
  openGraph: { image: "https://notes.acme.com/og.png", type: "website" },
  twitter: { card: "summary_large_image" },

  // web delivery
  render: "ssr",
  serviceWorkers: ["./src/sw/push.ts"],
  serviceWorkerUpdate: "auto",
  manifestExtra: { categories: ["productivity"] },

  // behaviour
  ui: { noSelect: "app", hideScrollbars: "all", touchCallout: "app" },
  patches: { textMagnifier: true },
  images: { placeholder: true },

  // screens
  splashScreen: () => import("@/components/splash-screen"),
  splashMaskMode: "preferences",
  orientationGuardScreen: () => import("@/components/rotate-guard"),
  notFoundScreen: () => import("@/components/not-found-screen"),
  offlineComponent: () => import("@/components/offline"),
  bootErrorScreen: () => import("@/components/boot-error"),

  // native
  plugins: ["@capacitor/camera"],
  pluginConfig: { Camera: { saveToGallery: false } },
  privacy: { tracking: false },

  // over-the-air updates
  origin: "https://notes.acme.com",
  otaPublicKey: "-----BEGIN PUBLIC KEY-----\\n...\\n-----END PUBLIC KEY-----",
  otaOnNativeSkew: "install",
  otaPollMinutes: 60,

  router: {
    routesDirectory: "./routing",
    routerConfig: "./src/routing/config.ts",
    memoryHistoryInStandalone: true,
    defaultPreload: "intent",
  },
})`,
    },
    { type: "h2", text: "Validation" },
    {
      type: "p",
      text: "The CLI checks the config before it does any work, and prints every problem at once, each naming its key. The same rules run inside the build. What is checked: `name` and `styles` are non-empty strings, `router` is an object, `themeColor` has at least one side, every colour key is a 3 or 6 digit hex colour, every enum key holds one of its values, `appId` is reverse-DNS, `icons` is a string, `otaPollMinutes` and `updateRequiredAfterDays` are numbers, and `plugins` and `serviceWorkers` are lists of strings. On a native run, a name in `plugins` that is not installed is an error too.",
    },
    { type: "h2", text: "Identity" },
    {
      type: "props",
      rows: [
        {
          name: "name",
          type: "string",
          required: true,
          description:
            "The app's name. Becomes the manifest `name`, and the document `<title>` unless `title` overrides it.",
        },
        {
          name: "shortName",
          type: "string",
          default: "name",
          description:
            "Manifest `short_name`: the label under a home-screen icon.",
        },
        {
          name: "title",
          type: "string",
          default: "name",
          description: "Document `<title>` override.",
        },
        {
          name: "description",
          type: "string",
          required: true,
          description:
            "One line. Used for the description meta tag and the manifest `description`.",
        },
        {
          name: "lang",
          type: "string",
          default: '"en"',
          description: "The document language, written to `<html lang>`.",
        },
      ],
    },
    { type: "h2", text: "Colours and theme" },
    {
      type: "props",
      rows: [
        {
          name: "themeColor",
          type: "{ light: string; dark?: string } | { light?: string; dark: string }",
          required: true,
          description:
            "The brand background per theme. The launch-gap background, the pre-paint script and the `theme-color` meta all use exactly these values. Give one side and it is used for both. Hex only. See [Theming](/docs/theming).",
        },
        {
          name: "backgroundColor",
          type: "string",
          default: "themeColor.light",
          description:
            "Manifest `background_color`: what the OS paints behind an installed PWA while it cold-starts. Set it only when that backdrop should differ from the light theme colour. Hex only.",
        },
        {
          name: "defaultThemePreference",
          type: '"light" | "dark" | "system"',
          default: '"system"',
          description: "The theme when the user has no saved preference.",
        },
      ],
    },
    { type: "h2", text: "Styles, icons and the document" },
    {
      type: "props",
      rows: [
        {
          name: "styles",
          type: "string",
          required: true,
          description:
            'The app stylesheet entry, for example `"./src/styles/main.css"`. adaptv builds it and links it in the head. See [Styling](/docs/styling).',
        },
        {
          name: "icons",
          type: "string",
          description:
            "The directory holding the app's icon set. It must be inside `public/` so the files are served. There is no default directory: name one and adaptv reads it. It measures every file, then derives the manifest icons, the head links and the native launcher icons from what is there. With no usable art the app ships adaptv's own mark and the CLI tells you once per run. Generate a set with `adaptv icons --input <image>`. See [Icons and splash](/docs/icons-and-splash).",
        },
        {
          name: "orientation",
          type: '"portrait" | "landscape" | "any"',
          description:
            'The manifest orientation lock. It also drives the runtime rotate guard, which is the only thing that holds the lock on iOS. `"any"`, or leaving it out, turns the guard off.',
        },
        {
          name: "allowZoom",
          type: "boolean",
          default: "false",
          description:
            "Allow pinch-zoom. `false` gives a fixed scale and stops Safari zooming into inputs with text under 16px. `true` restores pinch-zoom, which is the WCAG 1.4.4 choice and the right one for a site people read.",
        },
        {
          name: "openGraph",
          type: "{ title?, description?, image?, url?, type? }",
          description:
            "Open Graph meta tags. Every field is an optional string.",
        },
        {
          name: "twitter",
          type: '{ card?: "summary" | "summary_large_image"; title?, description?, image? }',
          description: "Twitter card meta tags.",
        },
        {
          name: "manifestExtra",
          type: "Record<string, unknown>",
          description:
            "Extra fields merged as they are into the generated web manifest.",
        },
      ],
    },
    { type: "h2", text: "Rendering" },
    {
      type: "props",
      rows: [
        {
          name: "render",
          type: '"ssr" | "spa"',
          default: '"ssr"',
          description:
            'How the **web** build renders. `"ssr"`: a server renders each request and the client hydrates, so crawlers and link previews see real markup. `"spa"`: the host serves one static shell and the client router resolves the URL. It decides what a deploy needs: `"ssr"` needs something that runs per request, `"spa"` needs only a place to put files. The native build is always a static SPA, whatever this says. See [Rendering](/docs/rendering) and [Deploying](/docs/deploying).',
        },
        {
          name: "prerender",
          type: "boolean",
          default: "false",
          description:
            'Render, at build time, every page a link reaches from `/`, and ship each as a static HTML file next to the client assets. A host that serves files before the server answers those pages without running the server; a page the crawl did not reach is still rendered per request. Needs `render: "ssr"`. Only for pages that are the same for every visitor: a page that reads a cookie, a header or the time must not be reachable by a link, or every visitor gets the build\'s copy.',
        },
      ],
    },
    {
      type: "note",
      text: "There is no `host` key. adaptv wires the server build itself and the deploy target is detected from the platform's build environment, or set with the `NITRO_PRESET` environment variable. See [Deploying](/docs/deploying).",
    },
    { type: "h2", text: "Service worker" },
    {
      type: "p",
      text: "adaptv registers exactly one service worker on the web and in an installed PWA, and never in a native build. It precaches every route chunk, which is what makes a web build navigate like the native one. There is no key to disable, replace or retune it. See [Offline](/docs/offline).",
    },
    {
      type: "props",
      rows: [
        {
          name: "serviceWorkers",
          type: "string[]",
          description:
            "Your own worker modules, for behaviour the framework has no opinion about: push handlers, background sync, a runtime cache for your API. Each file is bundled into adaptv's worker and evaluated after its setup, so it can add handlers but cannot take over precaching or navigation. Write them against `@arrzdev/adaptv/sw` (`sendToApp`, `onAppMessage`, `cacheRoute`) and read messages in the app with `useServiceWorkerMessage()`.",
        },
        {
          name: "serviceWorkerUpdate",
          type: '"auto" | "prompt"',
          default: '"auto"',
          description:
            'When a new build\'s worker is applied. `"auto"` applies it at the next cold launch with no UI. `"prompt"` never applies it on its own: the app decides, through `useServiceWorkerUpdate()`. Nothing is ever applied mid-session in either mode. See [Update hooks](/docs/hooks-updates).',
        },
      ],
    },
    { type: "h2", text: "App feel" },
    {
      type: "h3",
      text: "ui",
    },
    {
      type: "p",
      text: 'The resets whose right answer depends on what the app is. Each takes a scope: `"app"` (installed PWA and native only), `"all"` (every target, browser tab included) or `"off"` (adaptv does not touch the property).',
    },
    {
      type: "props",
      rows: [
        {
          name: "ui.noSelect",
          type: '"app" | "all" | "off"',
          default: '"app"',
          description:
            "The global `user-select: none` reset. Inputs, textareas and `contenteditable` always keep native selection, and any element can opt back in with the `selectable` utility.",
        },
        {
          name: "ui.hideScrollbars",
          type: '"app" | "all" | "off"',
          default: '"all"',
          description:
            "Hides scrollbars globally. A scroller that wants one asks with `showsVerticalScrollIndicator` on [ScrollView](/docs/scroll-view), which outranks this reset.",
        },
        {
          name: "ui.touchCallout",
          type: '"app" | "all" | "off"',
          default: '"app"',
          description:
            "Suppresses iOS's long-press link preview sheet. In a Safari tab that sheet is a real affordance, which is why the default leaves it alone there. The tap highlight is always removed and is not configurable.",
        },
      ],
    },
    { type: "h3", text: "patches" },
    {
      type: "p",
      text: "Native-feel WebKit fixes adaptv applies app-wide. Every one defaults to `true`. Set a field to `false` to opt out of that fix.",
    },
    {
      type: "props",
      rows: [
        {
          name: "patches.caretRepaint",
          type: "boolean",
          default: "true",
          description:
            "Repaints a focused input's caret when it moves (scroll, drawer, keyboard) so iOS never leaves a detached caret behind.",
        },
        {
          name: "patches.textMagnifier",
          type: "boolean",
          default: "true",
          description: "Suppresses the iOS double-tap text magnifier loupe.",
        },
        {
          name: "patches.viewportFreeze",
          type: "boolean",
          default: "true",
          description:
            "Holds an app-wide scroll and virtual-keyboard-overlay lock so the on-screen keyboard and the URL bar cannot shift the layout. You own keyboard avoidance for inputs outside an overlay: wrap them in [AvoidKeyboard](/docs/avoid-keyboard). See [Keyboard](/docs/keyboard).",
        },
      ],
    },
    { type: "h3", text: "images" },
    {
      type: "props",
      rows: [
        {
          name: "images.placeholder",
          type: "boolean",
          default: "true",
          description:
            "Generate the blurred low-resolution placeholder for `?adaptv-image` imports. Turning it off still resolves `width` and `height`, so the box is still reserved and nothing shifts. There is no switch for the dimensions: a build that cannot resolve them fails. See [Image](/docs/image) and [Layout shift](/docs/layout-shift).",
        },
      ],
    },
    { type: "h2", text: "Screens" },
    {
      type: "p",
      text: "Each screen key is a thunk around a literal dynamic import, and the module it names must have a matching `default` export. The thunk is never executed. The plugin reads the path and emits a static import, so the screen is in the entry bundle and paints on the first frame. See [App shell components](/docs/app-shell-components) for the props each one receives.",
    },
    {
      type: "props",
      rows: [
        {
          name: "splashScreen",
          type: "() => Promise<{ default: ComponentType<SplashScreenProps> }>",
          description:
            "Your boot splash overlay. adaptv renders it while the app is installed (native app or home-screen PWA). It dismisses itself by returning `null`. It is mounted underneath the OS launch splash, so it receives `revealedAt`, the moment it became visible (`null` until then). Time a minimum visible duration from that, never from mount.",
        },
        {
          name: "splashScreenInBrowser",
          type: "boolean",
          default: "false",
          description: "Also show `splashScreen` in a browser tab.",
        },
        {
          name: "splashMaskMode",
          type: '"preferences" | "system" | "light" | "dark"',
          default: '"preferences"',
          description:
            'How the native OS launch splash picks its flat mask colour. `"preferences"` follows the app\'s theme preference, `"system"` always follows the device, `"light"` and `"dark"` are fixed.',
        },
        {
          name: "splashMaskLightColor",
          type: "string",
          default: "backgroundColor ?? themeColor.light",
          description: "The launch mask colour in light mode. Hex only.",
        },
        {
          name: "splashMaskDarkColor",
          type: "string",
          default: "themeColor.dark",
          description: "The launch mask colour in dark mode. Hex only.",
        },
        {
          name: "orientationGuardScreen",
          type: "() => Promise<{ default: ComponentType<OrientationGuardProps> }>",
          description:
            "The full-screen prompt shown when a touch device is rotated against `orientation`. Receives `orientation`, the one the app requires. adaptv has a built-in prompt when you omit it.",
        },
        {
          name: "notFoundScreen",
          type: "() => Promise<{ default: NotFoundRouteComponent }>",
          description:
            "The full-screen 404, rendered at the root whenever a route throws `notFound()` or no route matches.",
        },
        {
          name: "offlineComponent",
          type: "() => Promise<{ default: ComponentType<OfflineProps> }>",
          default: "adaptv's Offline",
          description:
            "The app's offline UI. adaptv renders it when the app cannot boot far enough for a route to exist (a route chunk fails to load), and you render the same component from a route whose data is unavailable. Every prop is optional so one component serves both. See [OfflineBoundary](/docs/offline-boundary).",
        },
        {
          name: "bootErrorScreen",
          type: "() => Promise<{ default: ComponentType<BootErrorProps> }>",
          default: "adaptv's BootError",
          description:
            "The screen shown when the bundle never ran: a 404 on the entry chunk, a syntax error, a corrupt update. It is prerendered to static HTML at build time, so it must render from its `code` prop alone, with no hooks and no browser APIs. It is not for runtime errors: a route that throws is yours to catch with your own boundary.",
        },
        {
          name: "updateRequiredScreen",
          type: "() => Promise<{ default: ComponentType<UpdateRequiredProps> }>",
          description:
            "Your screen for `updateRequiredAfterDays`, instead of adaptv's. Receives `days`, `since` (ms since the epoch) and `buildTag`.",
        },
      ],
    },
    {
      type: "note",
      text: "There is no `providers` key. An app-wide provider tree is a layout route: declare one in the route config and wrap `<Outlet />`. See [Routing](/docs/routing).",
    },
    { type: "h2", text: "Native app" },
    {
      type: "props",
      rows: [
        {
          name: "appId",
          type: "string",
          description:
            'The native app id, reverse-DNS, for example `"com.acme.notes"`. adaptv generates the whole iOS and Android project from this one field.',
        },
        {
          name: "appName",
          type: "string",
          default: "name",
          description:
            "The display name on the device home screen. Also names the built `.ipa` and `.apk`.",
        },
        {
          name: "plugins",
          type: "string[]",
          description:
            'Extra Capacitor-compatible native plugins, by package name, added to the set adaptv already ships for its own [capabilities](/docs/capabilities). Install the package, list it here, and use its JS API. adaptv wires the iOS and Android side. Do not list the plugins adaptv bundles. Example: `["@capacitor/camera"]`.',
        },
        {
          name: "pluginConfig",
          type: "Record<string, Record<string, unknown>>",
          description:
            "Native runtime settings for plugins, keyed by the plugin's class name (`Camera`, `PushNotifications`), merged into the generated native config.",
        },
        {
          name: "privacy",
          type: "AdaptvPrivacyConfig",
          description:
            "What only your app can know about its iOS privacy manifest. adaptv generates `PrivacyInfo.xcprivacy` on every iOS build and derives the required-reason APIs of every compiled-in plugin. This key adds the rest.",
        },
      ],
    },
    {
      type: "note",
      tone: "warn",
      text: "Known gap: the type says a web-only app omits `appId`, and the Vite build accepts a config without it. The CLI does not: `adaptv dev`, `preview`, `build` and `icons` stop with `missing 'appId' in adaptv.config.ts`, for every surface including `web`. Until the CLI agrees with the type, set an `appId` even if you never ship to a store.",
    },
    { type: "h3", text: "privacy" },
    {
      type: "props",
      rows: [
        {
          name: "privacy.requiredReasonAPIs",
          type: "Record<string, string[]>",
          description:
            'Required-reason APIs adaptv cannot derive, keyed by Apple\'s category and valued by reason codes. Merged with the derived set. Example: `{ NSPrivacyAccessedAPICategoryFileTimestamp: ["C617.1"] }`.',
        },
        {
          name: "privacy.tracking",
          type: "boolean",
          default: "false",
          description:
            "`NSPrivacyTracking`: whether the app tracks users as Apple defines it.",
        },
        {
          name: "privacy.trackingDomains",
          type: "string[]",
          description:
            "`NSPrivacyTrackingDomains`: the domains the app connects to for tracking.",
        },
        {
          name: "privacy.collectedData",
          type: "{ type: string; linked: boolean; tracking: boolean; purposes: string[] }[]",
          description:
            "`NSPrivacyCollectedDataTypes`: what the app collects. adaptv never infers this. An app with analytics, accounts or telemetry declares it here.",
        },
      ],
    },
    { type: "h2", text: "Over-the-air updates" },
    {
      type: "p",
      text: "An installed native app can take a new JS bundle without a store release. `origin` turns that on. See [OTA updates](/docs/ota-updates) for the whole flow.",
    },
    {
      type: "props",
      rows: [
        {
          name: "origin",
          type: "string",
          description:
            'The app\'s public origin, for example `"https://app.acme.com"`. Origin only: no path, no trailing slash, and `https` outside localhost, enforced at build time. `adaptv build web` writes the update channel under `<origin>/.well-known/adaptv/ota/` and installed apps poll it. It is baked into the store binary, so treat it as permanent. Omit it and OTA is off.',
        },
        {
          name: "otaPublicKey",
          type: "string",
          description:
            "The public half of the OTA signing key, a PEM RSA public key. Committed on purpose. Generate the pair with `adaptv keys ota` and give the private half to the deploy as `ADAPTV_OTA_PRIVATE_KEY`. Without it, a build with an `origin` refuses to publish a channel.",
        },
        {
          name: "otaOnNativeSkew",
          type: '"install" | "refuse"',
          default: '"install"',
          description:
            'What an installed app does with an update built against a different set of native plugins than it has. `"install"` takes it, and capabilities that need the missing native code report `supported: false`. `"refuse"` stays on the last matching bundle until a store release.',
        },
        {
          name: "otaPollMinutes",
          type: "number",
          default: "60",
          description:
            "How often an installed app checks for a bundle while it is in use, in whole minutes. `0` turns the poll off. The minimum is 5. adaptv always checks on launch and on resume as well. A poll changes when the download happens, never when the swap does: the bundle is applied at the next cold start.",
        },
        {
          name: "updateRequiredAfterDays",
          type: "number",
          description:
            "How many days the channel may have been ahead of this install's native layer before adaptv takes the screen. Omit it, the default, and it never does. Set it only when a server contract moved with a native release. For anything short of a full screen, read the same state with `useStoreRelease()`.",
        },
      ],
    },
    { type: "h2", text: "router" },
    {
      type: "p",
      text: "One block for all routing wiring. adaptv consumes the three keys it recognises for the build, handles `memoryHistoryInStandalone` itself, and passes every other key to the router as a runtime option (`defaultPreload`, `defaultPreloadStaleTime`, `scrollRestoration`, and so on). The block is required, and may be empty. See [Routing](/docs/routing) and the [Router API](/docs/router-api).",
    },
    {
      type: "props",
      rows: [
        {
          name: "router.routesDirectory",
          type: "string",
          default: '"./routing"',
          description:
            "Where the route files live, relative to `src/`. The default is `src/routing`.",
        },
        {
          name: "router.routerConfig",
          type: "string",
          default: '"./src/routing/config.ts"',
          description:
            "The route config file, relative to the app root: the module that calls `rootRoute([...])`.",
        },
        {
          name: "router.serverEntry",
          type: "string",
          description:
            'A custom server entry for `render: "ssr"`, relative to the app root. The built-in one is used otherwise.',
        },
        {
          name: "router.memoryHistoryInStandalone",
          type: "boolean",
          default: "false",
          description:
            "Use in-memory router history when the app runs installed (home-screen PWA or native). The OS edge-swipe-back then has no browser-history entry to navigate, so navigation stays app-controlled. Ignored in a browser tab.",
        },
        {
          name: "router.*",
          type: "unknown",
          description:
            'Any other key is forwarded to the router constructor. adaptv sets `notFoundMode: "root"` unless you set it yourself.',
        },
      ],
    },
    { type: "h2", text: "Environment overrides" },
    {
      type: "p",
      text: "These exist for local verification of the update channel, not for production builds.",
    },
    {
      type: "table",
      head: ["Variable", "Effect"],
      rows: [
        ["`ADAPTV_OTA_ORIGIN`", "Overrides `origin`."],
        [
          "`ADAPTV_OTA_PUBLIC_KEY`",
          "Overrides `otaPublicKey`, so you can verify a signed channel with a throwaway pair. Only alongside `ADAPTV_OTA_ORIGIN`.",
        ],
        [
          "`ADAPTV_OTA_ALLOW_UNSIGNED=1`",
          "Lets a build publish an unsigned channel. Only alongside `ADAPTV_OTA_ORIGIN`.",
        ],
      ],
    },
    { type: "h2", text: "Exported types" },
    {
      type: "p",
      text: "`@arrzdev/adaptv/config` also exports the types you annotate screens with: `AdaptvAppConfig`, `AdaptvRouterConfig`, `AdaptvUiConfig`, `AdaptvPatches`, `UiPatchScope`, `ScreenThunk`, `SplashScreenProps`, `OrientationGuardProps` and `OrientationLock`.",
    },
  ],
}
