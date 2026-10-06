import type { DocPage } from "@/content/docs/types"

export const page: DocPage = {
  slug: "deploying",
  title: "Deploying the web app",
  summary: "Build the site, host it, set the headers and make it installable.",
  blocks: [
    {
      type: "p",
      text: "adaptv builds the site. You upload it with your host's own tool. The `render` key in `adaptv.config.ts` decides what the build writes.",
    },
    {
      type: "table",
      head: ["`render`", "Output", "Host needs"],
      rows: [
        [
          '`"ssr"` (default)',
          "`.output/`. The server is `.output/server/index.mjs`. The client files are in `.output/public/`.",
          "Something that runs the server: Node, a Cloudflare Worker, a Vercel or Netlify function.",
        ],
        [
          '`"spa"`',
          "`dist/client/`. Static files only.",
          "Any host that serves files, such as GitHub Pages or an S3 bucket.",
        ],
      ],
    },
    {
      type: "p",
      text: "Native builds are always a static SPA, whatever `render` says. See [Rendering](/docs/rendering) and [Native builds](/docs/native-builds).",
    },
    { type: "h2", text: "Build and check" },
    {
      type: "code",
      label: "Terminal",
      lang: "bash",
      code: `adaptv build web
adaptv preview web`,
    },
    {
      type: "p",
      text: "`build web` prints the directory it wrote. With `origin` set, it also writes the [update channel](/docs/ota-updates) for native apps. Use it, not plain `vite build`, for deploys. `build web` refuses `-o` with a usage error (exit 2): the site lands where its render mode puts it. `preview web` builds and serves the production site with its service worker. Arguments after `--` go to Vite, for example `adaptv preview web -- --port 4000`.",
    },
    { type: "h2", text: "Host an SSR build" },
    {
      type: "p",
      text: "adaptv detects AWS Amplify, Azure, Cloudflare, Firebase App Hosting, Netlify, Stormkit, Vercel and Zeabur from the build environment. Elsewhere, set `SERVER_PRESET`. With neither, you get a Node server.",
    },
    {
      type: "code",
      label: "Terminal",
      lang: "bash",
      code: `# Node server
adaptv build web
node .output/server/index.mjs

# Cloudflare Workers, built in your own CI
SERVER_PRESET=cloudflare_module adaptv build web`,
    },
    {
      type: "p",
      text: "On Cloudflare, the build merges your `wrangler.toml` (bindings, vars) into a generated config. Leave `main` out. It is set for you.",
    },
    {
      type: "note",
      tone: "warn",
      text: "A server-function import fails the build, because native apps have no server. Call your own API over the network, or use a route `loader`.",
    },
    { type: "h2", text: "Host a static build" },
    {
      type: "p",
      text: "Upload `dist/client/`. The build adds the files that make deep links work. Each host reads its own and ignores the rest.",
    },
    {
      type: "table",
      head: ["File", "Read by"],
      rows: [
        ["`index.html`", "Every host. It is the app shell."],
        ["`404.html`", "GitHub Pages, Netlify. Same content as `index.html`."],
        ["`.nojekyll`", "GitHub Pages. Stops Jekyll removing `_` files."],
        [
          "`_redirects`",
          "Netlify, Cloudflare Pages. A `200` rewrite to `index.html`.",
        ],
      ],
    },
    {
      type: "p",
      text: "On S3, CloudFront or nginx, answer unknown paths with `/index.html` and status 200. Exclude `/.well-known/` if you publish OTA updates.",
    },
    {
      type: "p",
      text: 'To deploy under a subpath, such as a GitHub Pages project site, set `base: "/my-repo/"` in `vite.config.ts`. The worker, `start_url`, `id`, icons and `_redirects` follow it.',
    },
    { type: "h2", text: "Set the headers" },
    {
      type: "p",
      text: "The build writes no headers file. Set these on your host.",
    },
    {
      type: "table",
      head: ["Path", "Header"],
      rows: [
        ["`/sw.js`", "`Cache-Control: no-cache`"],
        ["`/assets/*`", "`Cache-Control: public, max-age=31536000, immutable`"],
        [
          "`/manifest.json`, icons, the shell HTML",
          "`Cache-Control: no-cache`",
        ],
        [
          "`/.well-known/adaptv/ota/manifest.json`",
          "`Cache-Control: no-cache`",
        ],
      ],
    },
    {
      type: "code",
      label: "public/_headers (Netlify, Cloudflare Pages)",
      lang: "text",
      code: `/sw.js
  Cache-Control: no-cache
/assets/*
  Cache-Control: public, max-age=31536000, immutable
/manifest.json
  Cache-Control: no-cache
/.well-known/adaptv/ota/manifest.json
  Cache-Control: no-cache`,
    },
    {
      type: "ul",
      items: [
        "Serve over `https`. A service worker needs a secure origin. On plain `http://` (not `localhost`) the app loses offline support, and adaptv logs a warning.",
        "Keep the previous build's `assets/` files after a deploy. Open tabs still load old chunks. adaptv has no retention setting, so keep them until open tabs have reloaded. Hosts that replace the whole site on each deploy, such as Cloudflare and Vercel, cannot do this. Open tabs there reload once, then show the [offline screen](/docs/offline).",
      ],
    },
    { type: "h2", text: "Make it installable" },
    {
      type: "p",
      text: "Every web build is installable. adaptv generates `manifest.json` from your config. `theme_color` is the light theme colour. `manifestExtra` merges extra fields into it. `router.memoryHistoryInStandalone: true` keeps history in memory in an installed app, which disables the OS edge swipe back.",
    },
    {
      type: "table",
      head: ["", "iOS", "Android"],
      rows: [
        [
          "Install",
          "Safari, Share, Add to Home Screen. There is no prompt.",
          "Chrome shows a prompt or an Install app menu item.",
        ],
        [
          "Status bar",
          "The app draws under it. Pad with [safe areas](/docs/safe-areas).",
          "Chrome tints it from `theme-color`.",
        ],
        [
          "Back",
          "No back button. Add one in your UI.",
          "The system back gesture uses your router history.",
        ],
      ],
    },
    {
      type: "p",
      text: "Style per target with `app:` and `web:`. See [The six targets](/docs/six-targets). An installed PWA has no haptics or secure storage. See [Capabilities](/docs/capabilities).",
    },
    { type: "h2", text: "What goes wrong" },
    {
      type: "ul",
      items: [
        "**Blank page or 404 for assets on GitHub Pages.** `base` is missing.",
        "**The home page shows an empty shell on a static layer in front of an SSR server.** The shell file is `adaptv-shell.html` for this reason. Do not rename it to `index.html`.",
        "**Installed apps stop updating.** The deploy runs `vite build`. Use `adaptv build web`.",
        "**Users see old code after a deploy.** `sw.js` is cached. Set `no-cache`.",
        "**The build fails on a server import.** See the warning above.",
      ],
    },
  ],
}
