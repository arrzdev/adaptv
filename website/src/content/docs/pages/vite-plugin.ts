import type { DocPage } from "@/content/docs/types"

export const page: DocPage = {
  slug: "vite-plugin",
  title: "Vite plugin",
  summary:
    "adaptv() is the one plugin in vite.config.ts. It reads adaptv.config.ts and sets up routing, rendering, the manifest, the service worker and images.",
  platforms: ["Web", "PWA", "iOS", "Android"],
  importLine: 'import { adaptv } from "@arrzdev/adaptv/vite"',
  source: "src/vite/adaptv-plugin.ts",
  blocks: [
    {
      type: "p",
      text: "`adaptv()` loads `adaptv.config.ts` and returns every plugin the app needs. It takes no arguments in an ordinary app. adaptv needs Vite 8: `resolve.tsconfigPaths` does nothing on older Vite.",
    },
    { type: "h2", text: "vite.config.ts" },
    {
      type: "code",
      label: "vite.config.ts",
      lang: "ts",
      code: `import { adaptv } from "@arrzdev/adaptv/vite"
import { defineConfig } from "vite"

export default defineConfig({
  server: { host: "0.0.0.0", port: 3000 },
  preview: { host: "0.0.0.0", port: 3000 },
  resolve: {
    tsconfigPaths: true,
    dedupe: ["react", "react-dom"],
  },
  plugins: [adaptv()],
})`,
    },
    {
      type: "ul",
      items: [
        "With Tailwind, add `tailwindcss()` from `@tailwindcss/vite` after `adaptv()`.",
        "Do not add `@vitejs/plugin-react`, a router plugin, a PWA plugin or a deploy plugin. adaptv adds what it needs. A second copy fails the build.",
        "Use one port for `server` and `preview`. The [CLI](/docs/cli) starts Vite with `--strictPort`.",
      ],
    },
    { type: "h2", text: "Options" },
    {
      type: "api",
      name: "adaptv()",
      signature:
        "function adaptv(options?: AdaptvOptions): Promise<PluginOption[]>",
      description: "For the CLI and aliased installs.",
      params: [
        {
          name: "appRoot",
          type: "string",
          default: "process.cwd()",
          description: "The directory with `adaptv.config.ts`.",
        },
        {
          name: "target",
          type: '"web" | "capacitor"',
          default: '"web"',
          description:
            'Which bundle to build. `"capacitor"` builds the native bundle. `ADAPTV_TARGET` sets it too.',
        },
        {
          name: "routerSpecifier",
          type: "string",
          default: '"@arrzdev/adaptv/router"',
          description:
            "Where route files import `createFileRoute` from. Change it only if your project aliases the package.",
        },
      ],
      returns:
        "The plugin array. It throws before Vite starts when `adaptv.config.ts` is missing, is not an object, or fails validation.",
    },
    { type: "h2", text: "What it changes in your project" },
    {
      type: "p",
      text: "On every config load, the plugin makes these changes.",
    },
    {
      type: "ul",
      items: [
        "`.gitignore` gains `.adaptv/` and `capacitor.config.json`.",
        "`tsconfig.json` `include` gains `.adaptv/**/*.ts`, if it has an `include` array.",
        '`tsconfig.json` `paths` gains `"#adaptv-route-tree": ["./.adaptv/routeTree.gen.ts"]`, if it has a `paths` object. Without it, `navigate` and `redirect` accept any `to`. Add it by hand if you have no `paths`.',
        "`.adaptv/adaptv-env.d.ts` is written. It points the type checker at adaptv's types, so `include` needs no `node_modules/@arrzdev/adaptv/...` entry.",
      ],
    },
    {
      type: "code",
      label: "tsconfig.json",
      lang: "text",
      code: `{
  "include": [".adaptv/**/*.ts", "**/*.ts", "**/*.tsx"],
  "compilerOptions": {
    "paths": {
      "#adaptv-route-tree": ["./.adaptv/routeTree.gen.ts"],
      "@/*": ["./src/*"]
    }
  }
}`,
    },
    {
      type: "p",
      text: "`.adaptv/` holds the generated route tree (`routeTree.gen.ts`), the type reference, a stamp per build (`build/web.json`, `build/capacitor.json`, which the CLI reads) and the native bundle (`web/`). See [Project structure](/docs/project-structure).",
    },
    { type: "h2", text: "What a build writes" },
    {
      type: "table",
      head: ["target", "render", "Service worker", "Server", "Output"],
      rows: [
        [
          "`web`",
          "`ssr` (default)",
          "yes",
          "yes",
          "`.output/server`, `.output/public`",
        ],
        ["`web`", "`spa`", "yes", "no", "`dist/client`"],
        ["`capacitor`", "forced `spa`", "no", "no", "`.adaptv/web`"],
      ],
    },
    {
      type: "p",
      text: "A web build writes these into the client output:",
    },
    {
      type: "ul",
      items: [
        "`manifest.json`, built from your config.",
        "The app shell: static HTML with the pre-paint theme script, the critical CSS and your `bootErrorScreen`. It is `index.html` under `spa`, and `adaptv-shell.html` under `ssr`, so a static host does not answer `/` before the server.",
        "`sw.js`: the service worker with your `serviceWorkers` modules. It precaches route chunks, stylesheets, icons, fonts and the shell. Files over 5 MB are left out.",
        "`404.html`, `.nojekyll` and `_redirects`, under `spa` only. Each is read by one kind of host.",
      ],
    },
    {
      type: "p",
      text: 'Under `render: "ssr"`, the plugin adds the server build. It detects AWS Amplify, Azure, Cloudflare, Firebase App Hosting, Netlify, Stormkit, Vercel and Zeabur. On another host, set `NITRO_PRESET`. See [Deploying](/docs/deploying).',
    },
    { type: "h3", text: "The native bundle" },
    {
      type: "p",
      text: 'With `target: "capacitor"`, the same source builds a static SPA into `.adaptv/web`, with no service worker. The build removes the icon art, the head icon links, the manifest `icons` array, `.vite/` and `_shell.html`. `manifest.json` stays, because the orientation guard reads it. The plugin also writes the iOS privacy manifest and logs `[adaptv] wrote <path>`. See [Native builds](/docs/native-builds).',
    },
    { type: "h2", text: "Server-only code is refused" },
    {
      type: "p",
      text: "A native app has no server. The plugin refuses these in your `.js`, `.jsx`, `.ts` and `.tsx` files, in every build, and you cannot turn it off. A build exits with code 1.",
    },
    {
      type: "ul",
      items: [
        "An import of the server-function package (`createServerFn`, `createMiddleware`) or its `/server` subpath. Use your own API over the network.",
        "A `server: { ... }` key in the options of `createFileRoute(...)({ ... })`. Use a `loader`. adaptv misses a key in options built in a variable first.",
      ],
    },
    {
      type: "p",
      text: "See [Rendering](/docs/rendering).",
    },
    { type: "h2", text: "?adaptv-image" },
    {
      type: "p",
      text: "Add `?adaptv-image` to an image import. The plugin measures the file at build time. [Image](/docs/image) accepts the result as `src`, so the box has its size before the image loads. See [Layout shift](/docs/layout-shift).",
    },
    {
      type: "code",
      label: "hero.tsx",
      lang: "tsx",
      code: `import { Image } from "@arrzdev/adaptv/components"
import hero from "./hero.jpg?adaptv-image"

// hero: { src: string; width: number; height: number; lqip?: string }
export const Hero = () => <Image src={hero} alt="The harbour at dawn" />`,
    },
    {
      type: "ul",
      items: [
        "`width` and `height` are CSS pixels after EXIF rotation. `lqip` is a 16px blurred WebP `data:` URL. It is missing for SVGs, animations, sources under 40px, and when `images.placeholder` is `false`.",
        "Supported: `.jpg`, `.jpeg`, `.png`, `.webp`, `.avif`, `.gif`, `.tif`, `.tiff`, `.svg`. Any other extension is a build error. An SVG needs `width` and `height`, or a `viewBox`.",
      ],
    },
    { type: "h2", text: "Dev server" },
    {
      type: "ul",
      items: [
        "A save to `adaptv.config.ts`, or a module it imports, reloads the config and the page. Changes to `render`, `router.routesDirectory` and `router.routerConfig` need a restart. A new route in the route config does not.",
        "A save that fails to load or validate does not stop the server. The terminal prints `did not reload, so the dev server keeps the last config that loaded`. The next good save reloads the page.",
        "Dev has no service worker. `ADAPTV_DEV_SW=1` serves your own `serviceWorkers` modules at `<base>sw.js`. Test precaching with `adaptv preview web`.",
      ],
    },
    { type: "h2", text: "Eject an entry" },
    {
      type: "p",
      text: 'Write `src/router.tsx` to replace the router entry. Export `getRouter`, built with `createAdaptvRouter`. Write `src/client.tsx` to replace the client entry. Set `router.serverEntry` for `render: "ssr"`. To replace the root route, pass a file: `rootRoute("layouts/_root.tsx", [...])`. See the [Router API](/docs/router-api).',
    },
    { type: "h2", text: "Environment variables" },
    {
      type: "table",
      head: ["Variable", "Effect"],
      rows: [
        [
          "`ADAPTV_TARGET=capacitor`",
          "Build the native bundle. The CLI sets it.",
        ],
        [
          "`ADAPTV_DEV_NATIVE=1`",
          'Set by `adaptv dev ios|android|all`. Forces `render: "spa"` on `web`.',
        ],
        ["`ADAPTV_DEV_SW=1`", "Serve your own service-worker modules in dev."],
        [
          "`ADAPTV_BUILD_TAG`",
          "The service worker's cache namespace. Default: a hash of the client build.",
        ],
        [
          "`ADAPTV_VERBOSE=1`",
          "Prints the image pipeline's cost. `--verbose` sets it.",
        ],
        [
          "`NITRO_PRESET`",
          "The deploy target of an SSR build, when adaptv does not detect it.",
        ],
      ],
    },
  ],
}
