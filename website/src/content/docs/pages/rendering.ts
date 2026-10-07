import type { DocPage } from "@/content/docs/types"

export const page: DocPage = {
  slug: "rendering",
  title: "Rendering",
  summary:
    "What `render` changes for the web build, why a native bundle is always static, and why the build refuses server-only code.",
  blocks: [
    {
      type: "p",
      text: "One source tree makes two outputs. The **web build** serves browsers and installed PWAs. It is server-rendered or static, as `render` says. The **native bundle** is a folder of static files inside the iOS and Android apps. No key changes that.",
    },
    { type: "h2", text: "The `render` key" },
    {
      type: "props",
      rows: [
        {
          name: '"ssr"',
          type: "default",
          description:
            "A server renders the HTML for each request, and the client hydrates it. Crawlers see the page without JavaScript. The host must run code per request: Node, a Worker or a serverless function.",
        },
        {
          name: '"spa"',
          type: "",
          description:
            "The host serves one static shell. The client router reads the URL. The host only stores files, such as GitHub Pages or a CDN. The build also writes `404.html`, `.nojekyll` and `_redirects`.",
        },
      ],
    },
    {
      type: "p",
      text: 'Under `"ssr"`, adaptv adds the server build. It detects AWS Amplify, Azure, Cloudflare, Firebase App Hosting, Netlify, Stormkit, Vercel and Zeabur from the build environment. On another host, set `NITRO_PRESET` (or `SERVER_PRESET`). `vite.config.ts` stays `[adaptv()]`. See [Deploying](/docs/deploying). For build-time pages, see `prerender` in the [config](/docs/config). Server rendering improves the first paint only.',
    },
    { type: "h2", text: "What each target gets" },
    {
      type: "table",
      head: ["Target", "Server render", "Service worker", "Updates by"],
      rows: [
        [
          "Web, PWA",
          'Under `"ssr"`',
          "adaptv's",
          'The worker: at the next cold launch, or after a prompt (`serviceWorkerUpdate: "prompt"`)',
        ],
        [
          "iOS, Android",
          "Never",
          "None",
          "A store release, or a signed [OTA bundle](/docs/ota-updates)",
        ],
        [
          "`adaptv dev`",
          "As configured",
          "None. `ADAPTV_DEV_SW=1` serves your own worker modules",
          "Live reload",
        ],
      ],
    },
    {
      type: "p",
      text: 'A native web view loads `index.html` from the device, so no server can render. For iOS and Android, the CLI makes a second build that forces `render: "spa"`, turns the worker off and writes to `.adaptv/web`.',
    },
    {
      type: "p",
      text: 'Offline, under `"ssr"`, the worker sends each navigation to the network, waits 3 seconds, then serves a precached shell. Under `"spa"` it serves the shell at once. File-like paths such as `/whitepaper.pdf` always go to the network. See [Offline](/docs/offline).',
    },
    { type: "h2", text: "What runs where" },
    {
      type: "p",
      text: "`loader` and `beforeLoad` run where the router runs: on the server for the first request of a server-rendered page, in the browser after that, and on the device in a native app. Fetch an **absolute** URL, or read [storage](/docs/storage). A server function, a route `server: { handlers }` block, and reading request headers or cookies need a server. They work in `dev` and in a server-rendered deploy, then fail on a phone. Keep a bearer token in [secure storage](/docs/storage), not a cookie.",
    },
    {
      type: "note",
      tone: "warn",
      text: '**Do not guard a route on a client-held token under `"ssr"`.** On the server, secure storage reads as empty. A `beforeLoad` that throws `redirect({ to: "/sign-in" })` then redirects every hard load, deep link and refresh, even for a signed-in user. Use `render: "spa"` for an app behind sign-in.',
    },
    { type: "h2", text: "The build refuses server-only code" },
    {
      type: "p",
      text: "The `adaptv()` plugin enforces this in `dev` and in every build. You cannot turn it off. It checks your own JS and TS modules. Dependencies and virtual modules are exempt.",
    },
    {
      type: "ul",
      items: [
        "**Imports.** Your source may not import the server-function package the router ships with (the one that exports `createServerFn`) or its `/server` subpath (`getRequest`, `setCookie`, …). These hold server functions, middleware and request helpers.",
        "**Route handlers.** A `server:` key at the top level of the options in `createFileRoute(...)({ ... })` is refused. adaptv does not see options built in a variable first.",
      ],
    },
    {
      type: "p",
      text: 'The error names the file. In `dev` it shows in the overlay. A build fails. The shared Biome config (`@arrzdev/adaptv/biome-shared.json`) flags `createServerFn`, `createMiddleware` and any `/server` import in your editor. Any other import from the package root passes the editor and fails the build. A web-only app with `render: "ssr"` is refused too. Put server logic in your own API and call it over the network.',
    },
    {
      type: "code",
      label: "src/routing/pages/orders.page.tsx",
      lang: "tsx",
      code: `import { createFileRoute } from "@arrzdev/adaptv/router"

export const Route = createFileRoute("/orders")({
  // An absolute URL: the same request from a server, a tab and a web view.
  loader: async () => {
    const response = await fetch("https://api.acme.com/orders")
    return response.json()
  },
  component: Orders,
})`,
    },
    {
      type: "p",
      text: "To use your own server entry, set `router.serverEntry` and re-export `@arrzdev/adaptv/server-entry` from it. That file counts as app source, so the ban applies to it.",
    },
    { type: "h2", text: "Common problems" },
    {
      type: "ul",
      items: [
        "**A relative fetch (`/api/orders`) in a loader.** In a native app the origin is the device. Use an absolute URL.",
        "**Markup that depends on the theme or the platform.** The server and the first client render disagree, and React reports a hydration mismatch. Use the CSS variants `dark:`, `app:` and `web:`. See [Theming](/docs/theming).",
        '**`render: "spa"` does not change the native app.** The native bundle is always static.',
        "**No service worker in `dev`.** Test the worker with `adaptv preview web`.",
        "**A hosting plugin in `vite.config.ts`.** adaptv already adds the server build.",
      ],
    },
  ],
}
