import type { DocPage } from "@/content/docs/types"

export const page: DocPage = {
  slug: "rendering",
  title: "Rendering",
  summary:
    "What `render` decides for the web build, why a native bundle is always static files, and why the build refuses server-only code.",
  blocks: [
    {
      type: "p",
      text: "One source tree produces two kinds of output. The **web build** serves browsers and installed PWAs, and is server-rendered or static depending on one config key. The **native bundle** is a folder of static files copied into the iOS and Android apps, and no config key changes that. Code that runs in both has to be isomorphic, and adaptv enforces the one rule that keeps it so: no server-only code in application source.",
    },
    { type: "h2", text: "The `render` key" },
    {
      type: "code",
      label: "adaptv.config.ts",
      lang: "ts",
      code: `export default defineApp({
  // "ssr" is the default. "spa" is the only other value.
  render: "ssr",
})`,
    },
    {
      type: "props",
      rows: [
        {
          name: '"ssr"',
          type: "default",
          description:
            "A server renders the HTML for each request and the client hydrates it. Every route arrives as real markup, so crawlers and link previews see the page without running JavaScript. The deploy needs something that runs per request: a Node process, a Worker, a serverless function.",
        },
        {
          name: '"spa"',
          type: "",
          description:
            "No per-request render. The host serves one static shell, the client router resolves the URL, and React draws the page. The deploy needs only somewhere to put files: GitHub Pages, Netlify, a bucket, any CDN.",
        },
      ],
    },
    {
      type: "p",
      text: '`render` is about the web only, and it is the only key in the config that shapes a deploy. There is no `host` key. Under `"ssr"` adaptv wires the server build itself, and the hosting provider is detected from the build environment or named with the `NITRO_PRESET` environment variable, so `vite.config.ts` stays at `[adaptv(), tailwindcss()]`. Under `"spa"` the build also writes `index.html`, `404.html`, `.nojekyll` and `_redirects`, each read by one static host and ignored by the rest. [Deploying](/docs/deploying) covers both.',
    },
    {
      type: "p",
      text: 'The default is `"ssr"` because the two ways of being wrong are not equal. A wrong SPA default kills search indexing and link previews for a landing page, and you find out months later from a ranking report. A wrong SSR default costs one config flip, found immediately by the person who wanted a static site.',
    },
    {
      type: "note",
      text: "Server rendering buys the **first paint**. After hydration the client router handles every navigation on every target, so moving between routes is equally fast in both modes, and the service worker precaches every route's code in both.",
    },
    { type: "h2", text: "What each target gets" },
    {
      type: "table",
      head: [
        "Target",
        "Build",
        "Rendered by a server",
        "Service worker",
        "Updates arrive by",
      ],
      rows: [
        [
          "Desktop and mobile web",
          '`"ssr"` or `"spa"`',
          'Yes under `"ssr"`',
          "adaptv's, always",
          "The worker. By default a new build is applied at the next cold launch",
        ],
        [
          "Installed PWA",
          "The same web build",
          'Yes under `"ssr"`',
          "adaptv's, always",
          "The worker. By default a new build is applied at the next cold launch",
        ],
        [
          "iOS and Android",
          "Static SPA, forced",
          "Never",
          "None, and any found is unregistered",
          "A store release, or a signed [OTA bundle](/docs/ota-updates)",
        ],
        [
          "`adaptv dev`, any target",
          "Dev server",
          "As configured",
          "None, and any found is destroyed",
          "Live reload",
        ],
      ],
    },
    {
      type: "p",
      text: "The native row cannot be configured. A native web view loads `index.html` from the app's own bundle on the device. No server sits behind it, so nothing can render per request. A service worker is impossible on iOS's custom-scheme origin, redundant when every file is already local, and would fight the OTA channel. When the CLI builds for iOS or Android it runs a second build of the same source with the target set to native, which forces `render: \"spa\"`, turns the worker off, writes to `.adaptv/web` and drops what a web view can never use (icon art, static-host files, the worker registration).",
    },
    {
      type: "p",
      text: 'So an app with `render: "ssr"` ships a server-rendered website and a static native bundle from the same routes, and nothing is given up on either side.',
    },
    { type: "h3", text: "How navigations are served offline" },
    {
      type: "p",
      text: 'Under `"ssr"` the worker sends every online navigation to the network so the per-request render is preserved, waits up to three seconds, and then falls back to a precached app shell. The shell is generated at build time and is user-agnostic; it is never a captured response. Under `"spa"` the worker answers every navigation from the precached shell. In both cases the shell boots the client router at the current URL, and being offline becomes something a route renders in place. See [Offline](/docs/offline).',
    },
    { type: "h2", text: "What is isomorphic, and what is server-only" },
    {
      type: "p",
      text: "`loader` and `beforeLoad` are router features. They run wherever the router runs: on the server for the first request of a server-rendered page, and in the browser for everything else, which includes every run inside a native app. Use them freely.",
    },
    {
      type: "table",
      head: [
        "Works on every target",
        "Needs a server, so dead in a native bundle",
      ],
      rows: [
        [
          "A `loader` that fetches an **absolute** API URL.",
          "A server function: it compiles to an RPC against the app's own server.",
        ],
        [
          "A `loader` that reads [storage](/docs/storage) or IndexedDB.",
          "A route's `server: { handlers }` block, or any API route.",
        ],
        [
          "A `beforeLoad` guard that checks a client-held token and throws `redirect()`.",
          "Reading request headers or cookies, setting response headers, reading server environment.",
        ],
        [
          "Fetching in components with a query library, with an optional persister for offline.",
          "Any `loader` or `beforeLoad` that calls one of the above.",
        ],
      ],
    },
    {
      type: "p",
      text: "The failure is what makes this worth a framework rule. A server function works in `dev`, works in a server-rendered deploy, and then fails on a phone, at the end of the pipeline, long after the code was written. Cookies are the same story: they do not work on device, so auth in an adaptv app is a client-held bearer token, kept in [secure storage](/docs/storage), and a server-side loader could not see it anyway.",
    },
    { type: "h2", text: "The build refuses server-only code" },
    {
      type: "p",
      text: "The rule is enforced inside the `adaptv()` plugin, so it cannot be disabled or forgotten. Two checks run in `dev` and in every build:",
    },
    {
      type: "ul",
      items: [
        "**Imports.** Application source may not import `@tanstack/react-start` or `@tanstack/react-start/server`. Application source means a JS or TS module outside `node_modules`; dependencies and virtual modules are exempt.",
        "**Route server handlers.** A `server:` key at the top level of a `createFileRoute(...)({ ... })` options object is refused. No import rule can see a config property, so this one is found in the syntax. A property named `server` deeper in the object, inside loader data for instance, is yours and is left alone.",
      ],
    },
    {
      type: "p",
      text: "A violation is reported with the file and a caret on the line. In `dev` it appears in the error overlay; in a build it exits with a failure.",
    },
    {
      type: "code",
      label: "Terminal",
      lang: "text",
      code: `"@tanstack/react-start" is server-only and cannot be imported from application source.
It needs a server to run, and the native app has none — the app is a folder of files on
the device, so this would work in dev and in an SSR deploy, then fail on iOS and Android.
Move the logic to your API and call it over the network, or use a route \`loader\`, which
is isomorphic and fully supported.`,
    },
    {
      type: "p",
      text: "The bundler error is the backstop. adaptv also exports a shared Biome config, `@arrzdev/adaptv/biome-shared.json`, whose `noRestrictedImports` rule puts the same message in your editor as you type.",
    },
    {
      type: "note",
      tone: "warn",
      text: '**Where server functions are allowed today: nowhere in application source.** The check is on the import and does not look at the target, so a web-only app with `render: "ssr"` is refused too, even though it has a server that could run one. Nothing in `@arrzdev/adaptv/router` re-exports a server-function API. Put server logic in an API of your own and call it over the network. Treat this as the current state of a pre-alpha framework; the scan for `server:` also has a known gap, since it misses a route whose options object is assembled in a variable and passed in.',
    },
    { type: "h2", text: "The pattern that works everywhere" },
    {
      type: "code",
      label: "src/routing/pages/orders.page.tsx",
      lang: "tsx",
      code: `import { createFileRoute, redirect } from "@arrzdev/adaptv/router"
import { storage } from "@arrzdev/adaptv/storage"

const API = "https://api.acme.com"

export const Route = createFileRoute("/orders")({
  // A client-side guard. Runs in the browser on native and on client navigations.
  beforeLoad: async () => {
    const token = await storage.secure.get("token")
    if (!token) throw redirect({ to: "/sign-in" })
    return { token }
  },
  // An absolute URL: the same request from a server, a browser tab and a web view.
  loader: async ({ context }) => {
    const response = await fetch(\`\${API}/orders\`, {
      headers: { authorization: \`Bearer \${context.token}\` },
    })
    return response.json()
  },
  component: Orders,
})`,
    },
    {
      type: "note",
      text: 'On the first request of a server-rendered page this `beforeLoad` runs on the server, where secure storage reads as empty, so the guard redirects. For pages behind a client-held token that is the correct first paint. An app that is entirely behind sign-in gains little from `"ssr"` beyond its public pages.',
    },
    { type: "h2", text: "What goes wrong" },
    {
      type: "ul",
      items: [
        "**A relative fetch (`/api/orders`) in a loader.** Fine on the web, where the origin is your server. In a native app the origin is the device. Use an absolute URL.",
        "**Branching markup on something the server cannot know** (the resolved theme, the platform, a stored flag). The server render and the first client render disagree and React reports a hydration mismatch. Let CSS decide with `dark:`, `app:` and `web:`, which are stamped before first paint. See [Theming](/docs/theming).",
        '**Expecting `render: "spa"` to change the native app.** It does not. The native bundle is always a static SPA.',
        "**Expecting a service worker in `dev`.** Dev URLs are not cache-stable, so the shell destroys workers in dev. Test the worker with `adaptv preview web`.",
        "**Adding a hosting plugin to `vite.config.ts`.** adaptv already injects the server build. Name a provider with `NITRO_PRESET` when the build environment does not identify itself.",
      ],
    },
  ],
}
