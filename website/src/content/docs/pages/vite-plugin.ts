import type { DocPage } from "@/content/docs/types"

export const page: DocPage = {
  slug: "vite-plugin",
  title: "Vite plugin",
  summary:
    "adaptv() is the one plugin in vite.config.ts. It reads adaptv.config.ts and wires routing, rendering, the manifest, the service worker and the image pipeline.",
  platforms: ["Web", "PWA", "iOS", "Android"],
  importLine: 'import { adaptv } from "@arrzdev/adaptv/vite"',
  source: "src/vite/adaptv-plugin.ts",
  blocks: [
    {
      type: "p",
      text: "An adaptv app is a Vite app with one framework plugin. `adaptv()` loads `adaptv.config.ts`, then returns the whole plugin array the app needs: the router and its route generator, React, the server build, the manifest, the service worker, the app shell and the image pipeline. Build settings live in [adaptv.config.ts](/docs/config), so the call takes no arguments in an ordinary app.",
    },
    { type: "h2", text: "The vite.config.ts an app needs" },
    {
      type: "code",
      label: "vite.config.ts",
      lang: "ts",
      code: `import { adaptv } from "@arrzdev/adaptv/vite"
import tailwindcss from "@tailwindcss/vite"
import { defineConfig } from "vite"

export default defineConfig({
  server: { host: "0.0.0.0", port: 3000 },
  preview: { host: "0.0.0.0", port: 3000 },
  resolve: {
    tsconfigPaths: true,
    dedupe: ["react", "react-dom"],
  },
  ssr: {
    noExternal: ["@arrzdev/adaptv"],
  },
  plugins: [adaptv(), tailwindcss()],
})`,
    },
    {
      type: "ul",
      items: [
        "`adaptv()` returns a promise of a plugin array. Vite awaits it and flattens it, so there is no `await` and no spread.",
        "**`adaptv()` goes before `tailwindcss()`.** adaptv injects the cascade-layer order into your stylesheet before Tailwind compiles it. With the order reversed, adaptv's base styles start beating your own utilities.",
        '`ssr.noExternal: ["@arrzdev/adaptv"]` makes the server build bundle adaptv instead of loading it from `node_modules` at runtime. The package ships TypeScript source today.',
        "`resolve.dedupe` keeps one copy of React when adaptv is linked from a workspace.",
        "Do not add `@vitejs/plugin-react`, the router's plugin, a PWA plugin or a deploy plugin (Cloudflare, Netlify, Nitro). adaptv adds the ones it needs, and a second copy breaks the build in ways that are hard to read.",
        "The same port under `server` and `preview` keeps `adaptv dev web` and `adaptv preview web` on one address. The [CLI](/docs/cli) starts Vite with `--strictPort`.",
      ],
    },
    { type: "h2", text: "Options" },
    {
      type: "api",
      name: "adaptv()",
      signature:
        "function adaptv(options?: AdaptvOptions): Promise<PluginOption[]>",
      description:
        "Call it bare. The options exist for callers that cannot read their answer from `adaptv.config.ts`: the CLI's native build, and installs where the package is aliased.",
      params: [
        {
          name: "appRoot",
          type: "string",
          default: "process.cwd()",
          description: "The directory holding `adaptv.config.ts`.",
        },
        {
          name: "target",
          type: '"web" | "capacitor"',
          default: '"web"',
          description:
            'Which bundle to build. `"capacitor"` is the native bundle: it forces a static SPA and turns the service worker off, whatever the config says. Falls back to the `ADAPTV_TARGET` environment variable, which is how the CLI sets it. You rarely set this yourself.',
        },
        {
          name: "routerSpecifier",
          type: "string",
          default: '"@arrzdev/adaptv/router"',
          description:
            "The module the route generator writes into route files as the import for `createFileRoute`. Change it only when your project reaches the package under a different name. A wrong value fails at build time with an unresolved import.",
        },
      ],
      returns:
        "The plugin array. It throws before Vite starts when `adaptv.config.ts` is missing or cannot produce a manifest.",
    },
    { type: "h2", text: "What it does to your project" },
    {
      type: "p",
      text: "On every config load the plugin touches three files you own, each idempotently and without reformatting them:",
    },
    {
      type: "ul",
      items: [
        "`.gitignore` gains `.adaptv/` and `capacitor.config.json` if they are missing.",
        "`tsconfig.json` `include` gains `node_modules/@arrzdev/adaptv/src/interface/route-globals.d.ts` and `.adaptv/**/*.ts`, when the file already has an `include` array.",
        '`tsconfig.json` `paths` gains `"#adaptv-route-tree": ["./.adaptv/routeTree.gen.ts"]`, when the file already has a `paths` object. This is what carries the route tree\'s type into typed navigation. A bundler-only alias would build and silently turn every `to` into `string`.',
      ],
    },
    {
      type: "p",
      text: "Everything generated goes into one hidden directory, `.adaptv/`, which is rebuilt like `dist/`:",
    },
    {
      type: "table",
      head: ["Path", "Written by", "What it is"],
      rows: [
        [
          "`.adaptv/routeTree.gen.ts`",
          "dev and build",
          "The typed route tree, generated from your route config and route files.",
        ],
        [
          "`.adaptv/tmp/router/`",
          "dev and build",
          "Scratch space for the route generator.",
        ],
        [
          "`.adaptv/build/web.json`, `capacitor.json`",
          "build",
          "A stamp recording where the build wrote and which config it came from. The CLI reads it.",
        ],
        [
          "`.adaptv/web/`",
          "native build",
          'The native web bundle. Only written under `target: "capacitor"`.',
        ],
      ],
    },
    {
      type: "p",
      text: "The root route, the router entry and the client entry are not generated into your project. They are modules inside the package, fed your config through virtual modules. See [Project structure](/docs/project-structure) for the rest of `.adaptv/`.",
    },
    { type: "h2", text: "What a build emits" },
    {
      type: "table",
      head: ["target", "render", "Service worker", "Server", "Output"],
      rows: [
        [
          "`web`",
          "`ssr` (default)",
          "yes",
          "yes",
          "`.output/server` and `.output/public`",
        ],
        ["`web`", "`spa`", "yes", "no", "`dist/client`"],
        ["`capacitor`", "forced `spa`", "no", "no", "`.adaptv/web`"],
      ],
    },
    {
      type: "p",
      text: "Into the client output of a web build the plugin writes:",
    },
    {
      type: "ul",
      items: [
        "**`manifest.json`**: the web app manifest, built from `name`, `shortName`, `description`, `themeColor`, `backgroundColor`, `orientation`, the icon set and `manifestExtra`. In dev it is served at `/manifest.json`.",
        "**The app shell**: a static, user-agnostic HTML document with the pre-paint theme script, the critical CSS and your prerendered `bootErrorScreen`. It is `index.html` under `spa` and `adaptv-shell.html` under `ssr`. The SSR name is deliberate: asset-first hosts serve a file named `index.html` for `/` before they run the server, which would silently take the home route away from server rendering.",
        "**`sw.js`**: the service worker, bundled with your `serviceWorkers` modules, a precache manifest of every route chunk, stylesheet, icon and font, and a build tag that namespaces its caches. No route document is precached, only the shell. Files over 5 MB are left out.",
        "**Static-host files**, `spa` only: `404.html` (the same shell), `.nojekyll` and `_redirects`. Each is read by one kind of host and ignored by the rest, so the build never needs to know where it will land. Under `ssr` they are never written, because `_redirects` would answer navigations from a static file.",
        "**The icon set**: your `icons` directory, or adaptv's default mark when there is none.",
      ],
    },
    {
      type: "p",
      text: "The shell, the worker and the static-host files are written after every Vite environment and the server build have finished, in that order, so the worker's precache list is taken from a complete directory that already contains the shell.",
    },
    {
      type: "p",
      text: 'For `render: "ssr"` the plugin adds the server build itself (Nitro, pinned to an exact version). The deploy target is detected from the platform\'s build environment on AWS Amplify, Azure, Cloudflare, Firebase App Hosting, Netlify, Stormkit, Vercel and Zeabur. Anywhere else, set `NITRO_PRESET`. See [Deploying](/docs/deploying).',
    },
    { type: "h3", text: "The native bundle" },
    {
      type: "p",
      text: "Under `target: \"capacitor\"` the same source builds a static SPA into `.adaptv/web` with no service worker: a WebView loads files off the device, so there is no server to render against, and the bundle on disk already is the offline copy. The plugin also drops what only a browser could use: the icon art, the head icon links, the manifest's `icons` array, Vite's own `.vite/manifest.json` and the static-host files. `manifest.json` stays, because the orientation guard reads it on device. On iOS builds it writes the privacy manifest as well. You get this build through `adaptv dev`, `preview` and `build` for `ios` and `android`, never from a plain `vite build`. See [Native builds](/docs/native-builds).",
    },
    { type: "h2", text: "Server-only code is refused" },
    {
      type: "p",
      text: "One codebase also builds the native app, and the native app has no server: it is a folder of files on the device. Server functions work in dev and in an SSR deploy, then fail on iOS and Android, long after the code was written. So the plugin refuses them at build time, in every build, as the first plugin in the array. It cannot be disabled.",
    },
    {
      type: "table",
      head: ["Refused in your source", "Use instead"],
      rows: [
        [
          "Any import of `@tanstack/react-start` or `@tanstack/react-start/server` (server functions, middleware, request and response helpers)",
          "Your own API, called over the network",
        ],
        [
          "A `server: { ... }` key on the options of `createFileRoute(...)({ ... })` (server route handlers)",
          "A route `loader`, which runs on the server and the client and is fully supported",
        ],
      ],
    },
    {
      type: "p",
      text: "The error names the file and puts a caret on the import or the key. In dev it shows in the error overlay. In a build it exits 1. Only your own `.js`, `.jsx`, `.ts` and `.tsx` modules are checked: dependencies and virtual modules are exempt. The `server:` check is a source scan of the options object written inline, so it does not see options assembled in a variable first. adaptv also ships a shared Biome config (`@arrzdev/adaptv/biome-shared.json`) that flags the same imports in the editor. The `@arrzdev/adaptv/router` barrel exports none of these APIs, see the [Router API](/docs/router-api) and [Rendering](/docs/rendering).",
    },
    { type: "h2", text: "?adaptv-image" },
    {
      type: "p",
      text: "Add `?adaptv-image` to an image import and the plugin measures the file at build time. The import becomes an object that [Image](/docs/image) accepts as `src`, so the box is reserved before a byte of the image arrives. See [Layout shift](/docs/layout-shift).",
    },
    {
      type: "code",
      label: "hero.tsx",
      lang: "tsx",
      code: `import { Image } from "@arrzdev/adaptv/components"
import hero from "./hero.jpg?adaptv-image"

// hero: { src: string; width: number; height: number; lqip?: string }
<Image src={hero} alt="The harbour at dawn" />`,
    },
    {
      type: "props",
      rows: [
        {
          name: "src",
          type: "string",
          description: "The emitted asset URL, hashed by Vite.",
        },
        {
          name: "width",
          type: "number",
          description:
            "Intrinsic width in CSS pixels, with EXIF orientation already applied.",
        },
        {
          name: "height",
          type: "number",
          description:
            "Intrinsic height in CSS pixels, with EXIF orientation already applied.",
        },
        {
          name: "lqip",
          type: "string | undefined",
          description:
            "A 16px blurred WebP `data:` URL. Absent for SVGs, animations, sources under 40px, and when `images.placeholder` is `false`.",
        },
      ],
    },
    {
      type: "ul",
      items: [
        "Supported: `.jpg`, `.jpeg`, `.png`, `.webp`, `.avif`, `.gif`, `.tif`, `.tiff` and `.svg`. Any other extension is a build error.",
        "An SVG is measured from its `width` and `height` attributes, then its `viewBox`. One with neither is a build error.",
        "A file that cannot be read or decoded is a build error. A missing placeholder is cosmetic. A missing dimension is a layout shift, so there is no way to continue without it.",
        'A plain `import logo from "./logo.png"` is untouched and is still a URL string. `<Image src={aString}>` without `width` and `height` or an `aspectRatio` does not compile, which is how a forgotten suffix gets caught.',
        "Placeholders are cached in `node_modules/.cache/adaptv/lqip`.",
        "Measuring uses `sharp`. If it cannot load, the build says so and names the package-manager fix.",
      ],
    },
    { type: "h2", text: "Types for the virtual modules" },
    {
      type: "p",
      text: "The `?adaptv-image` import and adaptv's virtual modules are typed by ambient declaration files inside the package. Add them to `tsconfig.json` `include` once. The plugin adds the first line for you, the second is yours to add:",
    },
    {
      type: "code",
      label: "tsconfig.json",
      lang: "ts",
      code: `{
  "include": [
    "node_modules/@arrzdev/adaptv/src/interface/route-globals.d.ts",
    "node_modules/@arrzdev/adaptv/src/**/virtual-adaptv-*.d.ts",
    ".adaptv/**/*.ts",
    "**/*.ts",
    "**/*.tsx"
  ]
}`,
    },
    { type: "h3", text: "Virtual modules" },
    {
      type: "p",
      text: "These are how your config reaches framework code. You do not import them. They are listed so a stack trace or a bundle report is readable.",
    },
    {
      type: "table",
      head: ["Module", "Carries"],
      rows: [
        [
          "`virtual:adaptv/root-route`",
          "The root route, built from `adaptv.config.ts`, with your screen components statically imported.",
        ],
        [
          "`virtual:adaptv/router-config`",
          "The runtime half of the `router` block, handed to the router.",
        ],
        [
          "`virtual:adaptv/pwa-register`",
          "Service-worker registration and the `serviceWorkerUpdate` policy. A stub in native builds and in dev.",
        ],
        [
          "`virtual:adaptv/route-tints`",
          "Every route's `chromeTint`, read from the route files at build time.",
        ],
        [
          "`virtual:adaptv/ota-config`",
          "`origin`, the public key and the poll interval, for the updater.",
        ],
        [
          "`virtual:adaptv/secure-storage`",
          "The native backend for [secure storage](/docs/storage).",
        ],
        ["`#adaptv-route-tree`", "An alias to `.adaptv/routeTree.gen.ts`."],
      ],
    },
    { type: "h2", text: "Dev server behaviour" },
    {
      type: "ul",
      items: [
        "Saving `adaptv.config.ts`, or a module it imports, reloads the config and the page. `render`, `router.routesDirectory` and `router.routerConfig` configure the router once at startup, so changing them needs a restart.",
        "A route added to the route config reaches a running dev server without a restart.",
        "Dev has no service worker: a worker would serve a stale bundle into the next session and break hot reload. To exercise your own `serviceWorkers` modules in dev, set `ADAPTV_DEV_SW=1`. That serves your modules alone at `/sw.js`, rebundled on every request. adaptv's precaching and navigation handling need a build, so test those with `adaptv preview web`.",
        "When adaptv is linked from outside the app root, the plugin adds the package to Vite's `server.fs.allow` so the dev server can read its modules.",
      ],
    },
    { type: "h2", text: "Ejecting an entry" },
    {
      type: "p",
      text: "The plugin checks for these files and uses yours when they exist. Most apps never need one.",
    },
    {
      type: "table",
      head: ["File", "Replaces"],
      rows: [
        [
          "`src/router.tsx`",
          "The router entry. Export a `getRouter` function. `createAdaptvRouter` from `@arrzdev/adaptv/router` builds the same router adaptv would.",
        ],
        ["`src/client.tsx`", "The client entry that hydrates the app."],
        [
          "`router.serverEntry` in the config",
          'The server entry for `render: "ssr"`.',
        ],
      ],
    },
    {
      type: "note",
      text: 'The root route is ejected from the route config, by passing a file to `rootRoute("layouts/_root.tsx", [...])`. See the [Router API](/docs/router-api).',
    },
    { type: "h2", text: "Environment variables" },
    {
      type: "table",
      head: ["Variable", "Effect"],
      rows: [
        [
          "`ADAPTV_TARGET=capacitor`",
          "Build the native bundle. Set by the CLI. The `target` option wins over it.",
        ],
        [
          "`ADAPTV_DEV_NATIVE=1`",
          "Set by `adaptv dev ios|android|all`. Makes the dev server render as a SPA, because native WebViews attach to it.",
        ],
        ["`ADAPTV_DEV_SW=1`", "Serve your own service-worker modules in dev."],
        [
          "`ADAPTV_VERBOSE=1`",
          "Set by `--verbose`. Prints the image pipeline's per-build cost summary.",
        ],
        [
          "`NITRO_PRESET`",
          "The deploy target of an SSR build, when it is not auto-detected.",
        ],
      ],
    },
  ],
}
