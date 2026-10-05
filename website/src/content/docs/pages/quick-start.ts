import type { DocPage } from "@/content/docs/types"

export const page: DocPage = {
  slug: "quick-start",
  title: "Quick start",
  summary:
    "The path to a running adaptv app today: clone the repository, run an app that links it, and learn the five files a minimal app is made of.",
  blocks: [
    {
      type: "note",
      tone: "warn",
      text: "There is no install command yet. `@arrzdev/adaptv` is `private` in its `package.json` and is not on the public npm registry, and the `create-adaptv` scaffolder is designed but not built. The package's `exports` still point at TypeScript source, so an app consumes it by **linking a local checkout** with pnpm's `link:` protocol. Two apps in the repository do exactly that: `playground/` (the app the framework is developed against) and `website/` (this site). This page walks that path and will be replaced by `pnpm create adaptv` the day it exists.",
    },
    { type: "h2", text: "Requirements" },
    {
      type: "table",
      head: ["Tool", "Version", "Needed for"],
      rows: [
        ["Node.js", "22.12 or newer (`engines.node`)", "Everything."],
        [
          "pnpm",
          "11.1.1 (`packageManager`)",
          "Everything. The `link:` setup below is pnpm's.",
        ],
        [
          "Xcode and CocoaPods",
          "A current Xcode, on macOS",
          "`adaptv dev ios`, `preview ios`, `build ios`.",
        ],
        [
          "Android SDK, a JDK, `adb`",
          "Android Studio installs all three",
          "`adaptv dev android`, `preview android`, `build android`.",
        ],
      ],
    },
    {
      type: "p",
      text: "The web target needs only Node and pnpm. For native, `adaptv doctor` reports what the machine has. Run it from an app root (a directory with an `adaptv.config.ts`).",
    },
    {
      type: "table",
      head: ["Section", "What doctor checks"],
      rows: [
        [
          "Core",
          "`node --version`, and adaptv's own install: the native command it drives and the native modules it ships, resolved from the framework's package, never from your app's `package.json`.",
        ],
        [
          "Android",
          "The SDK directory (`ANDROID_HOME`, then `ANDROID_SDK_ROOT`, then `~/Library/Android/sdk`), a JDK (`JAVA_HOME`, then the one bundled with Android Studio), and `adb` (optional).",
        ],
        [
          "iOS (macOS only)",
          "`xcodebuild -version` and `pod --version`. Both are optional rows: a machine without Xcode can still build web and Android.",
        ],
        [
          "Project",
          "Whether the generated `.adaptv/android` and `.adaptv/ios` projects exist yet, whether the app has its own icon set or is wearing adaptv's default mark, and project-level checks on the generated native files.",
        ],
      ],
    },
    { type: "h2", text: "1. Clone and install" },
    {
      type: "code",
      label: "Terminal",
      lang: "bash",
      code: `git clone https://github.com/arrzdev/adaptv.git
cd adaptv
pnpm install`,
    },
    {
      type: "p",
      text: "The repository is still marked private in its own README, so the clone needs access until it is opened. The root install covers the framework only. `playground/` and `website/` are their own pnpm projects, each with its own `pnpm-workspace.yaml`, so each needs its own install.",
    },
    { type: "h2", text: "2. Run the website" },
    {
      type: "p",
      text: "The site you are reading is an adaptv app, server-rendered, with five routes. It is the smallest real app in the repository.",
    },
    {
      type: "code",
      label: "Terminal",
      lang: "bash",
      code: `cd website
pnpm install
pnpm dev            # adaptv dev web, on http://localhost:41760`,
    },
    {
      type: "p",
      text: "`pnpm website:dev` from the repository root does the same. Set `VITE_APP_PORT` to move the port when 41760 is taken; `adaptv dev` starts the dev server with a strict port and fails on a busy one instead of picking another.",
    },
    { type: "h2", text: "3. Run the playground" },
    {
      type: "p",
      text: "The playground is a task-list app with a `/lab` page for every component, capability and framework behaviour. It is where you see adaptv on a simulator. From the repository root:",
    },
    {
      type: "code",
      label: "Terminal",
      lang: "bash",
      code: `pnpm dev:web        # browser, http://localhost:41730
pnpm dev:ios        # iOS Simulator, live reload
pnpm dev:android    # Android emulator, live reload
pnpm dev:all        # all three at once

pnpm preview:ios    # the real build, installed and launched, no live reload
pnpm build:android  # a debug .apk`,
    },
    {
      type: "p",
      text: "The first `pnpm dev:*` installs the playground's dependencies by itself. Each script is a passthrough to the `adaptv` CLI inside the playground app, so `pnpm dev:ios` ends up running `adaptv dev ios`. The first native run generates the native project under `.adaptv/` and asks which device to use; later runs reuse both.",
    },
    {
      type: "note",
      text: "`dev` and `preview` are interactive and need a real terminal. In the playground they run inside a task runner pane: select the pane and press `i` to reach adaptv's own keys (`r` reload, `b` rebuild, `Ctrl-C` stop).",
    },
    { type: "h2", text: "What a minimal app consists of" },
    {
      type: "p",
      text: "Five files you write, plus `package.json` and `tsconfig.json`. There is no `index.html`, no router setup file, no client entry, no manifest, no service worker and no native project in your source tree: adaptv generates or serves all of them. The contents below are the website's own files. [Project structure](/docs/project-structure) covers the full layout.",
    },
    { type: "h3", text: "adaptv.config.ts" },
    {
      type: "p",
      text: "The one config file. `name`, `description`, `themeColor`, `styles` and `router` are required by the type. Every key is documented in the [config reference](/docs/config).",
    },
    {
      type: "code",
      label: "adaptv.config.ts",
      lang: "ts",
      code: `import { defineApp } from "@arrzdev/adaptv/config"

export default defineApp({
  appId: "dev.adaptv.website",
  name: "adaptv",
  title: "adaptv — one React codebase, every screen",
  description: "One React codebase for desktop web, mobile web, an installable home-screen app, and real iOS and Android apps.",
  lang: "en",
  themeColor: { light: "#fbfbfd", dark: "#0b0c14" },
  styles: "./src/styles/main.css",
  orientation: "any",
  // a document people read: let them zoom it
  allowZoom: true,
  ui: { hideScrollbars: "app" },
  router: {
    routesDirectory: "./routing",
    routerConfig: "./src/routing/config.ts",
    defaultPreload: "intent",
  },
})`,
    },
    {
      type: "note",
      tone: "warn",
      text: "The config type documents `appId` as the key a web-only app omits, but every CLI command refuses to start without one (`missing 'appId' in adaptv.config.ts`). Until the two agree, set an `appId` even if you never build for a store. It is a reverse-domain id such as `com.acme.app`.",
    },
    { type: "h3", text: "vite.config.ts" },
    {
      type: "p",
      text: "`adaptv()` returns the whole plugin array: the router and route generator, the server build, the manifest, the service worker, the image pipeline and the build checks. List it **before** `tailwindcss()`. adaptv writes the cascade-layer statement into your stylesheet ahead of Tailwind's own transform, and both run at the same enforcement level, so array order decides. No deploy plugin goes here; see [Deploying](/docs/deploying).",
    },
    {
      type: "code",
      label: "vite.config.ts",
      lang: "ts",
      code: `import { adaptv } from "@arrzdev/adaptv/vite"
import tailwindcss from "@tailwindcss/vite"
import { defineConfig } from "vite"

const port = Number(process.env.VITE_APP_PORT ?? 41760)

export default defineConfig({
  server: { host: "0.0.0.0", port },
  preview: { host: "0.0.0.0", port },
  resolve: {
    tsconfigPaths: true,
    dedupe: ["react", "react-dom"],
  },
  plugins: [adaptv(), tailwindcss()],
})`,
    },
    { type: "h3", text: "src/routing/config.ts" },
    {
      type: "p",
      text: "The route tree, declared in code. adaptv owns the root route, so you pass only its children. File paths are relative to the routes directory. [Routing](/docs/routing) covers params, layouts and loaders.",
    },
    {
      type: "code",
      label: "src/routing/config.ts",
      lang: "ts",
      code: `import { index, rootRoute, route } from "@arrzdev/adaptv/routes"

export const routes = rootRoute([
  index("pages/home.page.tsx"),
  route("/docs", "pages/docs.page.tsx"),
  route("/docs/$slug", "pages/docs/doc.page.tsx"),
])

export default routes`,
    },
    { type: "h3", text: "One page" },
    {
      type: "p",
      text: "A page file exports `Route`. Its component's root is a `View` (fixed) or a `ScrollView` (scrolls), and the shell stretches that root to the screen. Do not add `h-screen` or `min-h-screen`. [The frame](/docs/the-frame) explains why.",
    },
    {
      type: "code",
      label: "src/routing/pages/home.page.tsx",
      lang: "tsx",
      code: `import { Link, ScrollView, View } from "@arrzdev/adaptv/components"
import { createFileRoute } from "@arrzdev/adaptv/router"

export const Route = createFileRoute("/")({
  component: HomePage,
})

function HomePage() {
  return (
    <ScrollView className="bg-white px-6 dark:bg-black">
      <View className="mx-auto w-full max-w-xl gap-4 py-safe-offset-8">
        <h1 className="font-semibold text-3xl">Hello</h1>
        <Link to="/docs" className="text-blue-600">
          Read the docs
        </Link>
      </View>
    </ScrollView>
  )
}`,
    },
    { type: "h3", text: "src/styles/main.css" },
    {
      type: "p",
      text: "Tailwind first, then adaptv's stylesheet. Your tokens and any other CSS follow. The `adaptv()` plugin prepends the `@layer theme, base, adaptv, components, utilities;` statement to this file at build time, so you do not write it. [Styling](/docs/styling) explains what the second import adds.",
    },
    {
      type: "code",
      label: "src/styles/main.css",
      lang: "text",
      code: `@import "tailwindcss";
@import "@arrzdev/adaptv/styles.css";

@theme {
  --color-brand: #5563d6;
}`,
    },
    { type: "h3", text: "package.json" },
    {
      type: "p",
      text: "The `link:` entries are the part that goes away at the first release. adaptv is linked from the checkout, and `react`, `react-dom`, `vite` and `motion` are linked to the **checkout's copies** so there is one instance of each. A second React is a null-dispatcher crash (`Cannot read properties of null (reading 'useEffect')`) that names neither copy.",
    },
    {
      type: "code",
      label: "package.json",
      lang: "text",
      code: `{
  "name": "adaptv-website",
  "private": true,
  "type": "module",
  "imports": { "@/*": "./src/*" },
  "scripts": {
    "dev": "adaptv dev web",
    "preview": "adaptv preview web",
    "build": "adaptv build web",
    "typecheck": "tsc --noEmit -p tsconfig.json"
  },
  "dependencies": {
    "@arrzdev/adaptv": "link:..",
    "@tailwindcss/vite": "4.2.4",
    "motion": "link:../node_modules/motion",
    "react": "link:../node_modules/react",
    "react-dom": "link:../node_modules/react-dom",
    "tailwindcss": "4.2.4",
    "vite": "link:../node_modules/vite"
  },
  "engines": { "node": ">=22.12" },
  "packageManager": "pnpm@11.1.1"
}`,
    },
    {
      type: "p",
      text: 'An app that lives inside the checkout also needs its own `pnpm-workspace.yaml` (`packages: ["."]`). Without it, `pnpm install` walks up, finds the repository\'s workspace file and installs the framework instead of the app.',
    },
    { type: "h3", text: "tsconfig.json" },
    {
      type: "p",
      text: "adaptv edits two things into your `tsconfig.json` on the first run and leaves the rest alone: an `include` entry for its ambient route types, and a `paths` entry, `#adaptv-route-tree`, pointing at `.adaptv/routeTree.gen.ts`, which is what makes `to=\"/docs/$slug\"` type-checked. It also adds `.adaptv/` to `.gitignore`. While the package is linked as source, the app's tsconfig carries two more workarounds, both visible in `website/tsconfig.json`: `react` and `react-dom` pinned in `paths` so there is one copy of their types, and the framework's `virtual-adaptv-*.d.ts` files added to `include`.",
    },
    { type: "h2", text: "What goes wrong" },
    {
      type: "ul",
      items: [
        "**`no adaptv.config.ts in <dir>. Run from an app root.`** The CLI was run from the repository root or another directory. `cd` into the app.",
        "**`missing 'appId' in adaptv.config.ts`.** See the note above.",
        "**The dev server exits on a busy port.** That is deliberate: a silently moved port breaks a device that was told the old one. Free the port or set `VITE_APP_PORT`.",
        "**A page renders at its content height and does not scroll.** Its component returns more than one root element, so the shell did not stretch it. Wrap the page in one `ScrollView`.",
        "**Every Tailwind utility loses to an adaptv reset.** `tailwindcss()` is listed before `adaptv()` in `vite.config.ts`. adaptv prints a warning when it cannot find a Tailwind entry stylesheet to write the layer order into.",
        "**`preview` or `build` reports a cached web build after you edited framework source.** The build fingerprint covers the app tree and skips the linked framework. Pass `--force`.",
        "**A build fails on an import of `@tanstack/react-start`.** Server-only modules are refused in application source. [Rendering](/docs/rendering) explains what to use instead.",
      ],
    },
    { type: "h2", text: "Next" },
    {
      type: "ul",
      items: [
        "[The frame](/docs/the-frame): the layout contract, before you write a second page.",
        "[Routing](/docs/routing): params, loaders, layouts and links.",
        "[Styling](/docs/styling) and [Theming](/docs/theming).",
        "[Native builds](/docs/native-builds): from `adaptv doctor` to an app on a device.",
      ],
    },
  ],
}
