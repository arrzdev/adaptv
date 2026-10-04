import type { DocPage } from "@/content/docs/types"

export const page: DocPage = {
  slug: "introduction",
  title: "Introduction",
  summary:
    "What adaptv is, who it is for, what it owns, what you keep writing, and when to pick something else.",
  blocks: [
    {
      type: "p",
      text: "adaptv is a React framework that ships one codebase to desktop web, mobile web, an installed home-screen app, and native iOS and Android apps. You write ordinary React against the DOM and ordinary CSS with Tailwind. adaptv owns everything between that code and an app that behaves correctly on each target: the document shell, the platform differences, the native projects, the service worker, and the CLI that runs it all.",
    },
    {
      type: "p",
      text: "The native apps are web views. adaptv keeps the DOM, puts it in a native shell, and then fixes the specific places where a web page stops behaving like an app: safe areas that land after first paint, three unrelated keyboard mechanisms, overscroll chaining, `:active` that cannot be cleared from JavaScript, two splash screens colliding on launch, and server code that works on the web and is dead inside a store binary. [The six targets](/docs/six-targets) lists the runtimes; the rest of these docs is the catalogue of fixes.",
    },
    { type: "h2", text: "Who it is for" },
    {
      type: "ul",
      items: [
        "A team that knows React and CSS and wants a web app, an installable PWA and store apps without a second rendering model or a second styling system.",
        "A product with a public surface (landing page, docs, shareable pages) and an app behind it. The web build server-renders by default, so the public pages are indexable, and the same routes ship inside the native bundle.",
        "Apps whose screens are forms, lists, feeds, settings, dashboards and content. That is most apps.",
      ],
    },
    { type: "h2", text: "What adaptv owns and what you write" },
    {
      type: "table",
      head: ["adaptv owns", "You write"],
      rows: [
        [
          "The document: `<html>`, `<head>`, viewport meta, critical CSS, the pre-paint theme and platform stamp.",
          "`adaptv.config.ts`: name, colours, icons directory, render mode, router options. See [config](/docs/config).",
        ],
        [
          "A full-viewport frame that every route renders inside. The document never scrolls. See [The frame](/docs/the-frame).",
          "Pages whose root is a [View](/docs/view) or a [ScrollView](/docs/scroll-view).",
        ],
        [
          "The root route, the router instance and the generated route tree (kept in a git-ignored `.adaptv/` directory).",
          "A route config and one file per page. See [Routing](/docs/routing).",
        ],
        [
          "The web manifest, the icon links, the service worker and its update flow. See [Offline](/docs/offline).",
          "Optional service-worker modules of your own, listed in `serviceWorkers`.",
        ],
        [
          "The native iOS and Android projects, generated from the config. You never edit a native config file. See [Native builds](/docs/native-builds).",
          "An `appId`, and the names of any extra native plugins you add.",
        ],
        [
          "The web and native branch inside every capability: haptics, keyboard, network, clipboard, share, storage. See [capabilities](/docs/capabilities).",
          "Calls to one API. No `isNative()` branch in app code.",
        ],
        [
          "Corrections to `hover:` and `active:`, the `app:` and `web:` variants, and the safe-area utilities. See [Styling](/docs/styling).",
          "Your own design system: colours, spacing, radii and components, in Tailwind. adaptv ships no palette.",
        ],
        [
          "A build check that refuses server-only code in application source. See [Rendering](/docs/rendering).",
          "Your data layer. adaptv has no opinion on how you fetch, cache or sync.",
        ],
      ],
    },
    { type: "h2", text: "One tool" },
    {
      type: "p",
      text: "The `adaptv` CLI drives every target. `dev` runs with live reload, `preview` runs the real build on a device, and `build` produces the artifacts. Every command names its target, and there is no default target. The full list is in the [CLI reference](/docs/cli).",
    },
    {
      type: "code",
      label: "Terminal",
      lang: "bash",
      code: `adaptv doctor                        # does this machine have what a native build needs?
adaptv dev     web|ios|android|all   # live reload, including a physical device over the LAN
adaptv preview web|ios|android|all   # the real build, no live reload
adaptv build   web|ios|android|all   # deployable site, unsigned .ipa, debug .apk
adaptv keys ota                      # the signing pair for the update channel
adaptv icons --input ./mark.png      # every icon the app needs, from one image`,
    },
    { type: "h2", text: "When not to use it" },
    {
      type: "p",
      text: "A web view is the right tool for most apps and the wrong one for a few.",
    },
    {
      type: "ul",
      items: [
        "**Games and heavy graphics.** You want a native renderer.",
        "**Camera or AR pipelines.** When real-time native APIs are the whole product, a web view sits in the way.",
        "**A team already shipping great native apps.** Keep them. adaptv replaces nothing you have working.",
        "**An app that depends on server functions everywhere.** A native bundle is a folder of files on the device with no server behind it, so logic that must run on your server has to live in an API the app calls over the network. [Rendering](/docs/rendering) explains the boundary.",
      ],
    },
    { type: "h2", text: "Status" },
    {
      type: "note",
      tone: "warn",
      text: "adaptv is **pre-alpha**. The package `@arrzdev/adaptv` is marked `private` and is not on the public npm registry, and the `create-adaptv` scaffolder is designed but not built. Today the framework is consumed by linking a local checkout, which is what the repository's playground app and this website do. [Quick start](/docs/quick-start) shows that path. APIs change without a migration path until a first release.",
    },
    {
      type: "p",
      text: "What runs today: the build plugin, the shell, the components and capabilities documented here, storage, the service worker, the signed over-the-air channel, and the CLI for web, the iOS Simulator, the Android emulator and physical devices. What is not built: the scaffolder, a first-party native shell module, and real breadth in the component catalogue.",
    },
    { type: "h2", text: "A map of the docs" },
    {
      type: "table",
      head: ["Start here", "To find out"],
      rows: [
        [
          "[Quick start](/docs/quick-start)",
          "How to get an app running today, and what a minimal app consists of.",
        ],
        [
          "[Project structure](/docs/project-structure)",
          "What each file is for, and what is generated.",
        ],
        [
          "[The six targets](/docs/six-targets)",
          "The runtimes your code runs on and how to style for where you are.",
        ],
        [
          "[The frame](/docs/the-frame)",
          "The layout contract every page inherits. Read this before writing a page.",
        ],
        [
          "[Routing](/docs/routing), [Rendering](/docs/rendering)",
          "Declaring routes, loaders and layouts, and what `render` decides for each target.",
        ],
        [
          "[Styling](/docs/styling), [Theming](/docs/theming)",
          "Tailwind setup, the variants adaptv adds, the class tiers, and light and dark.",
        ],
        [
          "[Layout shift](/docs/layout-shift), [Safe areas](/docs/safe-areas), [Keyboard](/docs/keyboard)",
          "The three problems that make a web view feel like one, and what adaptv does about each.",
        ],
        [
          "[Offline](/docs/offline), [OTA updates](/docs/ota-updates)",
          "The service worker, and shipping a new bundle to installed native apps.",
        ],
        [
          "[Deploying](/docs/deploying), [Native builds](/docs/native-builds), [Icons and splash](/docs/icons-and-splash)",
          "Getting the web build onto a host and the native build onto a device.",
        ],
      ],
    },
    {
      type: "p",
      text: "The Reference tab has a page per component ([View](/docs/view), [ScrollView](/docs/scroll-view), [Drawer](/docs/drawer), [List](/docs/list) and the rest), the hooks grouped by job ([device](/docs/hooks-device), [lifecycle](/docs/hooks-lifecycle), [feedback](/docs/hooks-feedback), [data](/docs/hooks-data), [updates](/docs/hooks-updates)), and the [config](/docs/config), [CLI](/docs/cli), [router API](/docs/router-api) and [Vite plugin](/docs/vite-plugin) references.",
    },
  ],
}
