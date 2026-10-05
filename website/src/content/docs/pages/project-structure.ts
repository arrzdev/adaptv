import type { DocPage } from "@/content/docs/types"

export const page: DocPage = {
  slug: "project-structure",
  title: "Project structure",
  summary:
    "The files of an adaptv app, what each one is for, and which ones adaptv writes for you.",
  blocks: [
    {
      type: "p",
      text: "An adaptv app is a Vite project with two config files, a route config, your pages and a stylesheet. Everything else is generated into one hidden directory. This page walks the tree using the two real apps in the adaptv repository: this website (`website/`), which is web-only and server-rendered, and the playground (`playground/apps/frontend/`), which ships to all six targets.",
    },
    {
      type: "note",
      text: "The project scaffolder, `create-adaptv`, is designed but not built yet. Until it is, you assemble these files by hand. [Quick start](/docs/quick-start) has the steps, and this page is the map.",
    },
    { type: "h2", text: "The tree" },
    {
      type: "code",
      label: "my-app/",
      lang: "text",
      code: `my-app/
├── adaptv.config.ts        the app: name, colours, icons, render mode, router
├── vite.config.ts          one plugin call: adaptv()
├── tsconfig.json
├── package.json
├── .gitignore              adaptv adds its own entries
├── public/
│   ├── favicons/           the icon set (the directory "icons" names)
│   └── robots.txt          any other static file
├── src/
│   ├── routing/
│   │   ├── config.ts       the route tree
│   │   ├── pages/          one file per route
│   │   └── layouts/        layout routes: providers, shells
│   ├── styles/
│   │   └── main.css        the stylesheet entry ("styles" in the config)
│   ├── components/         yours, including the screens the config names
│   └── sw/                 optional: your own service-worker modules
└── .adaptv/                generated, git-ignored, disposable`,
    },
    {
      type: "p",
      text: "Only four paths are fixed: `adaptv.config.ts` and `vite.config.ts` at the app root, and the two router defaults, `src/routing` and `src/routing/config.ts`, which the `router` block can move. `components/`, `sw/` and everything else under `src/` is convention.",
    },
    { type: "h2", text: "adaptv.config.ts" },
    {
      type: "p",
      text: "The single source of truth. The [Vite plugin](/docs/vite-plugin) and the [CLI](/docs/cli) both read it, and the head, the manifest, the service worker, the router and both native projects are derived from it. The website's is short, because it is a document people read in a browser:",
    },
    {
      type: "code",
      label: "website/adaptv.config.ts",
      lang: "ts",
      code: `import { defineApp } from "@arrzdev/adaptv/config"

export default defineApp({
  appId: "dev.adaptv.website",
  name: "adaptv",
  title: "adaptv — one React codebase, every screen",
  description: "One React codebase for desktop web, mobile web, ...",
  lang: "en",
  themeColor: { light: "#fbfbfd", dark: "#0b0c14" },
  styles: "./src/styles/main.css",
  orientation: "any",
  // a document people read: let them zoom it and see how far down they are
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
      type: "p",
      text: 'The playground\'s adds what an installed app needs: `icons`, `orientation: "portrait"`, a `serviceWorkers` module, its own `splashScreen`, `orientationGuardScreen`, `notFoundScreen` and `bootErrorScreen`, and `memoryHistoryInStandalone`. Every key is on the [config reference](/docs/config).',
    },
    {
      type: "note",
      tone: "warn",
      text: "The website sets an `appId` even though it never ships to a store. The config type says a web-only app omits it, but the CLI currently refuses to run without one.",
    },
    { type: "h2", text: "vite.config.ts" },
    {
      type: "p",
      text: "One framework plugin, before Tailwind's. No React plugin, no router plugin, no PWA plugin and no deploy plugin: `adaptv()` brings what it needs. The [Vite plugin page](/docs/vite-plugin) explains each line.",
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
    {
      type: "p",
      text: "`VITE_APP_PORT` is a convention of these two apps, read by their own `vite.config.ts`. The CLI starts Vite with `--strictPort`, so a second checkout of the same app needs a way to move the port, and this is it.",
    },
    { type: "h2", text: "src/routing" },
    {
      type: "p",
      text: "`config.ts` declares the route tree, and each entry names a file under the routes directory. adaptv owns the root route, so you declare only its children. The website's whole tree:",
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
  route("/blog", "pages/blog.page.tsx"),
  route("/blog/$slug", "pages/blog/post.page.tsx"),
])

export default routes`,
    },
    {
      type: "p",
      text: "A page file exports `Route` from `createFileRoute`. App-wide providers go in a layout route that wraps `<Outlet />`. The playground's `layouts/providers.layout.tsx` is the example, and it is why there is no `providers` key in the config. File names are yours: both apps use `*.page.tsx` and `*.layout.tsx`. See [Routing](/docs/routing) and the [Router API](/docs/router-api).",
    },
    { type: "h2", text: "src/styles/main.css" },
    {
      type: "p",
      text: "The stylesheet the config's `styles` key points at. adaptv builds it and links it in the head. It imports Tailwind, then adaptv's stylesheet, then your own tokens:",
    },
    {
      type: "code",
      label: "src/styles/main.css",
      lang: "text",
      code: `@import "tailwindcss";
@import "@arrzdev/adaptv/styles.css";

:root {
  --background: #ffffff;
  --foreground: #0a0a0c;
}`,
    },
    {
      type: "p",
      text: "You do not write a cascade-layer order line above the imports. The plugin injects it, which is why `adaptv()` has to come before `tailwindcss()` in `vite.config.ts`. See [Styling](/docs/styling) and [Theming](/docs/theming).",
    },
    { type: "h2", text: "public/" },
    {
      type: "p",
      text: "Served as it is. The one directory adaptv cares about is the icon set that `icons` names, conventionally `public/favicons`. There is no default: if the config names no directory, the app ships adaptv's own mark. `adaptv icons --input <image>` fills it. You do not put a `manifest.json` or a `sw.js` here. Both are generated. See [Icons and splash](/docs/icons-and-splash).",
    },
    { type: "h2", text: "src/sw/ (optional)" },
    {
      type: "p",
      text: "adaptv owns the service worker. If the app needs worker behaviour of its own (push, background sync, a runtime cache for your API), write a module against `@arrzdev/adaptv/sw` and list it in `serviceWorkers`. It is bundled into adaptv's worker and runs after its setup. The playground's `src/sw/probe.ts` is a minimal one. See [Offline](/docs/offline).",
    },
    { type: "h2", text: "tsconfig.json" },
    {
      type: "p",
      text: "Three things in it exist for adaptv. The plugin writes the first `include` entry, the `.adaptv` entry and the `#adaptv-route-tree` path for you, as long as the file already has an `include` array and a `paths` object. The `virtual-adaptv-*.d.ts` line is yours to add.",
    },
    {
      type: "code",
      label: "tsconfig.json",
      lang: "ts",
      code: `{
  "include": [
    // the global createFileRoute and the chromeTint route option
    "node_modules/@arrzdev/adaptv/src/interface/route-globals.d.ts",
    // types for "?adaptv-image" imports and adaptv's virtual modules
    "node_modules/@arrzdev/adaptv/src/**/virtual-adaptv-*.d.ts",
    // the generated route tree
    ".adaptv/**/*.ts",
    "**/*.ts",
    "**/*.tsx"
  ],
  "exclude": ["node_modules", "dist", ".output"],
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      // carries the route tree's type into typed navigation
      "#adaptv-route-tree": ["./.adaptv/routeTree.gen.ts"],
      "@/*": ["./src/*"]
    },
    "target": "ES2022",
    "jsx": "react-jsx",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "types": ["vite/client"],
    "allowImportingTsExtensions": true,
    "noEmit": true,
    "skipLibCheck": true,
    "strict": true
  }
}`,
    },
    {
      type: "ul",
      items: [
        "Without the `#adaptv-route-tree` path the app still builds, but every `to` in `navigate()` and `Link` widens to `string`: no autocomplete and no wrong-route error.",
        'Without the `virtual-adaptv-*.d.ts` line, `import hero from "./hero.jpg?adaptv-image"` is a type error.',
        "`@/*` is an ordinary alias. `resolve.tsconfigPaths: true` in `vite.config.ts` makes Vite follow it. The screen thunks in the config may use it too.",
      ],
    },
    { type: "h2", text: "package.json" },
    {
      type: "code",
      label: "package.json",
      lang: "ts",
      code: `{
  "type": "module",
  "scripts": {
    "dev": "adaptv dev web",
    "dev:ios": "adaptv dev ios",
    "dev:android": "adaptv dev android",
    "preview": "adaptv preview web",
    "build": "adaptv build web",
    "build:ios": "adaptv build ios",
    "build:android": "adaptv build android",
    "typecheck": "tsc --noEmit -p tsconfig.json"
  },
  "engines": { "node": ">=22.12" }
}`,
    },
    {
      type: "ul",
      items: [
        "Dependencies: `@arrzdev/adaptv`, plus its peers, which you install yourself: `react`, `react-dom`, `vite`, `tailwindcss`, `motion`, `clsx` and `tailwind-merge`. Add `@tailwindcss/vite` for the Tailwind plugin.",
        "You list no native packages. The native shell and the plugins behind adaptv's [capabilities](/docs/capabilities) are adaptv's own dependencies. Only a plugin adaptv does not ship goes in your `package.json`, and then in the config's `plugins` list.",
        "The `adaptv` binary comes with the package, so scripts call it by name. Every command is on the [CLI page](/docs/cli).",
        'If a task runner sits between you and the CLI, it has to pass the terminal through or `dev` loses its keys and its device picker. With Turborepo, mark the task `"interactive": true`.',
      ],
    },
    { type: "h2", text: ".adaptv/" },
    {
      type: "p",
      text: "Everything adaptv generates, in one directory, treated like `dist/`. It is git-ignored, and deleting it costs a rebuild and a device prompt. After a native run the playground's looks like this:",
    },
    {
      type: "table",
      head: ["Path", "Written by", "What it is"],
      rows: [
        ["`routeTree.gen.ts`", "dev, build", "The typed route tree."],
        ["`tmp/`", "dev, build", "Scratch space for the route generator."],
        [
          "`build/`",
          "build",
          "A stamp per build kind: where it wrote and from which config.",
        ],
        [
          "`web/`",
          "native runs",
          "The native web bundle: a static SPA with no service worker.",
        ],
        [
          "`ios/`",
          "native runs",
          "The Xcode project. Open `ios/App/App.xcworkspace` to archive a signed build.",
        ],
        ["`android/`", "native runs", "The Gradle project."],
        ["`builds/`", "`adaptv build ios|android`", "The `.ipa` and `.apk`."],
        ["`ota/`", "`adaptv build web`", "Cached update-bundle archives."],
        [
          "`state.json`",
          "CLI",
          "Build fingerprints and the device you last picked.",
        ],
        [
          "`dev.lock`",
          "`adaptv dev`",
          "The single-instance lock of a running session.",
        ],
        [
          "`icons-preview.html`",
          "`adaptv icons`",
          "Every generated icon under its platform's mask.",
        ],
      ],
    },
    {
      type: "p",
      text: "The native projects live here, not at the app root. adaptv regenerates their identity, icons, splash colours, plugin wiring and privacy manifest from the config on every native run, so treat them as build output: a hand edit inside `.adaptv/ios` or `.adaptv/android` is not something to rely on. An `ios/` or `android/` directory at the app root is not adaptv's and is left alone. See [Native builds](/docs/native-builds).",
    },
    { type: "h3", text: ".gitignore" },
    {
      type: "p",
      text: "The plugin appends its entries if they are missing. Add the build outputs yourself:",
    },
    {
      type: "code",
      label: ".gitignore",
      lang: "text",
      code: `node_modules/
dist/
.output/

# Generated by adaptv on every dev/build. Build artifacts, like dist/.
.adaptv/
capacitor.config.json`,
    },
    { type: "h2", text: "Build output" },
    {
      type: "table",
      head: ["Directory", "From", "Deploy it?"],
      rows: [
        [
          "`.output/`",
          'A web build with `render: "ssr"`',
          "Yes. `.output/server` is the server, `.output/public` the static files.",
        ],
        [
          "`dist/client`",
          'A web build with `render: "spa"`',
          "Yes, to any static host.",
        ],
        [
          "`dist/server`",
          "Any build",
          "No. It is scratch space for prerendering.",
        ],
        [
          "`.adaptv/web`",
          "A native build",
          "No. It is copied into the native projects.",
        ],
      ],
    },
    {
      type: "p",
      text: "See [Deploying](/docs/deploying) for hosts, and [Rendering](/docs/rendering) for choosing between the two web modes.",
    },
  ],
}
