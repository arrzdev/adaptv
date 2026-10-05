import type { DocPage } from "@/content/docs/types"

export const page: DocPage = {
  slug: "config",
  title: "adaptv.config.ts",
  summary: "Every key of defineApp, with its type, default and effect.",
  platforms: ["Web", "PWA", "iOS", "Android"],
  importLine: 'import { defineApp } from "@arrzdev/adaptv/config"',
  source: "src/config/app-config.ts",
  blocks: [
    {
      type: "p",
      text: "`adaptv.config.ts` is in the app root and default-exports `defineApp({ ... })`, which returns what you pass and exists for the types. The [Vite plugin](/docs/vite-plugin) and the [CLI](/docs/cli) generate the head, manifest, service worker, routes and native projects from it.",
    },
    {
      type: "p",
      text: 'Write each screen thunk as a literal import, because adaptv reads the path from the source text: `() => import("@/components/splash-screen")`. Do not use a variable or template string. In dev, a saved change reloads the config. If it is invalid, dev keeps the last valid one and prints the errors. A change to `render` or the `router` paths needs a restart.',
    },
    { type: "h2", text: "Minimal example" },
    {
      type: "p",
      text: "Required keys: `name`, `description`, `themeColor`, `styles`, `router` (can be empty), and for the CLI `appId`.",
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
    { type: "h2", text: "Validation" },
    {
      type: "p",
      text: 'The CLI and build print every problem with its key. They check that the default export is an object, `name` and `styles` are non-empty strings, `router` is an object, colours are 3 or 6 digit hex (`white` fails), `appId` is reverse-DNS, and `deepLinks.scheme` is lowercase and not reserved (`http` and similar). They also check enum values, number and list types, and that `prerender` has `render: "ssr"`. On a native run, each `plugins` name must be installed. Keys marked Native apply to iOS and Android, keys marked Web to the web and PWA.',
    },
    { type: "h2", text: "Identity" },
    {
      type: "table",
      head: ["Key", "Type", "Default", "Description"],
      rows: [
        [
          "`name`",
          "`string`",
          "required",
          "Sets the manifest `name` and the page `<title>`.",
        ],
        [
          "`shortName`",
          "`string`",
          "`name`",
          "Manifest `short_name`, shown under the home-screen icon.",
        ],
        ["`title`", "`string`", "`name`", "Overrides the page `<title>`."],
        [
          "`description`",
          "`string`",
          "required",
          "One line, for the meta tag and manifest.",
        ],
        ["`lang`", "`string`", '`"en"`', "Sets `<html lang>`."],
      ],
    },
    { type: "h2", text: "Colours and theme" },
    {
      type: "table",
      head: ["Key", "Type", "Default", "Description"],
      rows: [
        [
          "`themeColor`",
          "`{ light?: string; dark?: string }`",
          "required",
          "Brand background per theme, hex. One side is used for both. See [Theming](/docs/theming).",
        ],
        [
          "`backgroundColor`",
          "`string`",
          "`themeColor.light`",
          "Manifest `background_color`, shown while an installed PWA starts.",
        ],
        [
          "`defaultThemePreference`",
          '`"light" | "dark" | "system"`',
          '`"system"`',
          "Theme when the user has not chosen.",
        ],
      ],
    },
    { type: "h2", text: "Styles, icons and the document" },
    {
      type: "table",
      head: ["Key", "Type", "Default", "Description"],
      rows: [
        [
          "`styles`",
          "`string`",
          "required",
          'The stylesheet entry, such as `"./src/styles/main.css"`. See [Styling](/docs/styling).',
        ],
        [
          "`icons`",
          "`string`",
          "none",
          "Folder of the icon set, inside `public/`. adaptv builds the manifest, head and native icons from it. Without icons, the app uses adaptv's mark and the CLI warns. See [Icons and splash](/docs/icons-and-splash).",
        ],
        [
          "`orientation`",
          '`"portrait" | "landscape" | "any"`',
          "none",
          "Manifest orientation lock. It also enables the rotate guard, the only lock on iOS.",
        ],
        [
          "`allowZoom`",
          "`boolean`",
          "`false`",
          "`false` fixes the scale. `true` allows pinch-zoom.",
        ],
        [
          "`openGraph`",
          "`{ title?, description?, image?, url?, type? }`",
          "none",
          "Open Graph tags.",
        ],
        [
          "`twitter`",
          '`{ card?: "summary" | "summary_large_image"; title?, description?, image? }`',
          "none",
          "Twitter card meta tags.",
        ],
        [
          "`manifestExtra`",
          "`Record<string, unknown>`",
          "none",
          "Fields merged into the manifest. Web.",
        ],
      ],
    },
    { type: "h2", text: "Rendering" },
    {
      type: "table",
      head: ["Key", "Type", "Default", "Description"],
      rows: [
        [
          "`render`",
          '`"ssr" | "spa"`',
          '`"ssr"`',
          '`"ssr"`: a server renders each request. It needs a host that runs code. `"spa"`: one static shell, which needs only file hosting. Web. See [Rendering](/docs/rendering) and [Deploying](/docs/deploying).',
        ],
        [
          "`prerender`",
          "`boolean`",
          "`false`",
          'Renders every page linked from `/` to static HTML at build time. Other pages render per request. Needs `render: "ssr"`. Only for pages that are the same for every visitor. Web.',
        ],
      ],
    },
    {
      type: "p",
      text: "There is no `host` key. To set the deploy target, use `NITRO_PRESET`.",
    },
    { type: "h2", text: "Service worker" },
    {
      type: "p",
      text: "adaptv registers one service worker on the web and in a PWA, never in a native build. You cannot disable or replace it. See [Offline](/docs/offline).",
    },
    {
      type: "table",
      head: ["Key", "Type", "Default", "Description"],
      rows: [
        [
          "`serviceWorkers`",
          "`string[]`",
          "none",
          "Your worker modules, for push or sync. Use `@arrzdev/adaptv/sw`. Web.",
        ],
        [
          "`serviceWorkerUpdate`",
          '`"auto" | "prompt"`',
          '`"auto"`',
          '`"auto"` applies a new worker at the next cold launch. `"prompt"` waits for `useServiceWorkerUpdate()`. See [Update hooks](/docs/hooks-updates). Web.',
        ],
      ],
    },
    { type: "h2", text: "App feel" },
    {
      type: "p",
      text: 'Each `ui` key takes `"app"` (installed PWA and native), `"all"` (also browser tabs) or `"off"`.',
    },
    {
      type: "table",
      head: ["Key", "Type", "Default", "Description"],
      rows: [
        [
          "`ui.noSelect`",
          '`"app" | "all" | "off"`',
          '`"app"`',
          "Sets `user-select: none`. Inputs keep selection. Opt in with the `selectable` utility.",
        ],
        [
          "`ui.hideScrollbars`",
          '`"app" | "all" | "off"`',
          '`"all"`',
          "Hides scrollbars.",
        ],
        [
          "`ui.touchCallout`",
          '`"app" | "all" | "off"`',
          '`"app"`',
          "Hides the iOS long-press link preview.",
        ],
        [
          "`patches.caretRepaint`",
          "`boolean`",
          "`true`",
          "Repaints the caret when it moves, so iOS leaves none behind.",
        ],
        [
          "`patches.textMagnifier`",
          "`boolean`",
          "`true`",
          "Stops the iOS double-tap text magnifier.",
        ],
        [
          "`patches.viewportFreeze`",
          "`boolean`",
          "`true`",
          "Stops the keyboard shifting the layout. Wrap inputs in [AvoidKeyboard](/docs/avoid-keyboard).",
        ],
        [
          "`images.placeholder`",
          "`boolean`",
          "`true`",
          "Blurred placeholder for `?adaptv-image`. See [Image](/docs/image).",
        ],
      ],
    },
    { type: "h2", text: "Screens" },
    {
      type: "p",
      text: "Each screen is a literal import thunk to a module with a default export. See [App shell components](/docs/app-shell-components).",
    },
    {
      type: "table",
      head: ["Key", "Props type", "Default", "Description"],
      rows: [
        [
          "`splashScreen`",
          "`SplashScreenProps`",
          "none",
          "Boot overlay for installed apps. It hides by returning `null`. Time a minimum duration from `revealedAt`.",
        ],
        [
          "`splashScreenInBrowser`",
          "`boolean`",
          "`false`",
          "Also show `splashScreen` in a tab.",
        ],
        [
          "`splashMaskMode`",
          '`"preferences" | "system" | "light" | "dark"`',
          '`"preferences"`',
          "Launch splash colour. `preferences` follows the app theme, `system` the device. Native.",
        ],
        [
          "`splashMaskLightColor`",
          "`string`",
          "`backgroundColor`, else `themeColor.light`",
          "Light launch colour. Native.",
        ],
        [
          "`splashMaskDarkColor`",
          "`string`",
          "`themeColor.dark`",
          "Dark launch colour. Native.",
        ],
        [
          "`orientationGuardScreen`",
          "`OrientationGuardProps`",
          "built-in prompt",
          "Prompt when a device is rotated against `orientation`.",
        ],
        [
          "`notFoundScreen`",
          "router not-found props",
          "built-in",
          "Full-screen 404, for `notFound()` and for no match.",
        ],
        [
          "`offlineComponent`",
          "`OfflineProps`",
          "built-in `Offline`",
          "Shown when a route chunk fails to load. Also usable in your routes. See [OfflineBoundary](/docs/offline-boundary).",
        ],
        [
          "`bootErrorScreen`",
          "`BootErrorProps`",
          "built-in `BootError`",
          "Shown when the bundle never ran. Built at build time, so use only its `code` prop, with no hooks.",
        ],
        [
          "`updateRequiredScreen`",
          "`days`, `since`, `buildTag`",
          "built-in",
          "Your screen for `updateRequiredAfterDays`. Native.",
        ],
      ],
    },
    {
      type: "p",
      text: "Import `OfflineProps` and `BootErrorProps` from `@arrzdev/adaptv/components`. The `updateRequiredScreen` props type is not exported. There is no `providers` key: use a layout route that wraps `<Outlet />`. See [Routing](/docs/routing).",
    },
    { type: "h2", text: "Native app" },
    {
      type: "table",
      head: ["Key", "Type", "Default", "Description"],
      rows: [
        [
          "`appId`",
          "`string`",
          "none",
          "Reverse-DNS id, such as `com.acme.notes`. The CLI requires it.",
        ],
        [
          "`appName`",
          "`string`",
          "`name`",
          "Home-screen name. Names the `.ipa` and `.apk`.",
        ],
        ["`plugins`", "`string[]`", "none", "Native plugins, by package name."],
        [
          "`pluginConfig`",
          "`Record<string, object>`",
          "none",
          "Settings per plugin, keyed by class name.",
        ],
        [
          "`deepLinks`",
          "`{ scheme: string }`",
          "none",
          "Registers a URL scheme. With `myapp`, `myapp://settings/profile?tab=2` opens `/settings/profile?tab=2`. Listen with `onUrlOpened` from `@arrzdev/adaptv/capabilities`. Universal links are not built.",
        ],
        [
          "`privacy`",
          "see below",
          "none",
          "iOS privacy manifest data only your app knows. adaptv derives the rest.",
        ],
      ],
    },
    {
      type: "table",
      head: ["Key", "Type", "Default", "Description"],
      rows: [
        [
          "`privacy.requiredReasonAPIs`",
          "`Record<string, string[]>`",
          "none",
          "Reason codes for APIs adaptv cannot derive.",
        ],
        [
          "`privacy.tracking`",
          "`boolean`",
          "`false`",
          "`NSPrivacyTracking`: whether the app tracks users.",
        ],
        [
          "`privacy.trackingDomains`",
          "`string[]`",
          "none",
          "`NSPrivacyTrackingDomains`.",
        ],
        [
          "`privacy.collectedData`",
          "`{ type; linked; tracking; purposes }[]`",
          "none",
          "`NSPrivacyCollectedDataTypes`. adaptv never infers it.",
        ],
      ],
    },
    { type: "h2", text: "Over-the-air updates" },
    {
      type: "p",
      text: "`origin` turns on JS updates without a store release. See [OTA updates](/docs/ota-updates).",
    },
    {
      type: "table",
      head: ["Key", "Type", "Default", "Description"],
      rows: [
        [
          "`origin`",
          "`string`",
          "none",
          "Public origin, such as `https://app.acme.com`. Must be `https`, except `http` for `localhost`, `127.0.0.1`, `[::1]` and `10.0.2.2` (Android emulator). Without it, OTA is off. A change needs a store release.",
        ],
        [
          "`otaPublicKey`",
          "`string`",
          "none",
          "PEM public key from `adaptv keys ota`. Commit it. Without it, no channel is published. A change needs a store release.",
        ],
        [
          "`otaOnNativeSkew`",
          '`"install" | "refuse"`',
          '`"install"`',
          'For an update built for different native plugins: `"install"` takes it, and features that need missing code report `supported: false`. `"refuse"` keeps the last matching bundle.',
        ],
        [
          "`otaPollMinutes`",
          "`number`",
          "`60`",
          "Minutes between update checks while the app is in use. `0` turns polling off. A value above 0 and below 5 fails the build. Launch and resume always check. A bundle applies at the next cold start.",
        ],
        [
          "`updateRequiredAfterDays`",
          "`number`",
          "none",
          "Days the channel may be ahead of the installed native layer before the update-required screen shows. Without it, it never shows.",
        ],
      ],
    },
    {
      type: "p",
      text: "For local tests only: `ADAPTV_OTA_ORIGIN` overrides `origin`. With it, `ADAPTV_OTA_PUBLIC_KEY` overrides `otaPublicKey`, and `ADAPTV_OTA_ALLOW_UNSIGNED=1` allows an unsigned channel.",
    },
    { type: "h2", text: "router" },
    {
      type: "p",
      text: "The block is required and can be empty. Other keys go to the router as runtime options, such as `defaultPreload`. See [Routing](/docs/routing) and [Router API](/docs/router-api).",
    },
    {
      type: "table",
      head: ["Key", "Type", "Default", "Description"],
      rows: [
        [
          "`router.routesDirectory`",
          "`string`",
          '`"./routing"`',
          "Route files folder, relative to `src/`.",
        ],
        [
          "`router.routerConfig`",
          "`string`",
          '`"./src/routing/config.ts"`',
          "Module with `rootRoute([...])`, from the app root.",
        ],
        [
          "`router.serverEntry`",
          "`string`",
          "built-in",
          'Custom server entry for `render: "ssr"`, relative to the app root.',
        ],
        [
          "`router.memoryHistoryInStandalone`",
          "`boolean`",
          "`false`",
          "In-memory history when installed, so OS swipe-back does nothing. Ignored in a tab.",
        ],
      ],
    },
    {
      type: "p",
      text: "Types: `AdaptvAppConfig`, `AdaptvRouterConfig`, `ScreenThunk`, `SplashScreenProps` and `OrientationGuardProps`, from `@arrzdev/adaptv/config`.",
    },
  ],
}
