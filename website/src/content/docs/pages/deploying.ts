import type { DocPage } from "@/content/docs/types"

export const page: DocPage = {
  slug: "deploying",
  title: "Deploying the web app",
  summary:
    "Build the site with one command, host it with a server or as static files, set two cache headers, and let people install it as an app.",
  blocks: [
    {
      type: "p",
      text: "adaptv builds the web app and stops there. It does not own your continuous deployment: the upload is your host's own tool (`wrangler deploy`, `vercel`, a Node process, copying files to a bucket). What adaptv decides is the shape of the output, and that is driven by one config key.",
    },
    { type: "h2", text: "Pick how it renders" },
    {
      type: "p",
      text: "`render` in `adaptv.config.ts` is the only key that shapes the deploy. There is no `host` key. Choose the render mode you want and it tells you where you can deploy.",
    },
    {
      type: "table",
      head: ["`render`", "What is built", "What the host needs"],
      rows: [
        [
          '`"ssr"` (default)',
          "A server that renders each request, plus the client assets.",
          "Something that runs your server on every request: a Node process, a Cloudflare Worker, a Vercel or Netlify function.",
        ],
        [
          '`"spa"`',
          "A folder of static files. One HTML shell; the client router resolves the URL.",
          "Anywhere files can be served: GitHub Pages, Netlify, Cloudflare Pages, an S3 bucket, any CDN.",
        ],
      ],
    },
    {
      type: "p",
      text: "SSR is the default because being wrong about it is cheap in one direction only. An accidental SPA silently loses SEO and link previews and is discovered late. An accidental SSR app costs one config change on the day you notice. After the first page, both modes navigate client-side from the same precached chunks, so an SPA is not faster to move around in. More in [Rendering](/docs/rendering).",
    },
    {
      type: "note",
      text: "This key is about the web only. The iOS and Android builds are always a static SPA with no server, whatever `render` says. See [Native builds](/docs/native-builds).",
    },
    { type: "h2", text: "Build" },
    {
      type: "code",
      label: "Terminal",
      lang: "bash",
      code: `adaptv build web`,
    },
    {
      type: "p",
      text: "The command prints the directory it wrote. If the app sets `origin`, it also builds the bundle installed native apps download and writes the [over-the-air update](/docs/ota-updates) channel into the client output, so deploying the site is what publishes the update. A plain `vite build` produces the same site without the channel; use `adaptv build web` for deploys once your native apps use OTA.",
    },
    {
      type: "table",
      head: ["`render`", "Output", "Contents"],
      rows: [
        [
          '`"ssr"`',
          "`.output/`",
          "`.output/server/index.mjs` is the server entry. `.output/public/` holds the client: hashed JS and CSS under `assets/`, `sw.js`, `manifest.json`, your `public/` files, and `adaptv-shell.html`.",
        ],
        [
          '`"spa"`',
          "`dist/client/`",
          "The same client files, with the shell as `index.html`, plus `404.html`, `.nojekyll` and `_redirects`. No server is built.",
        ],
      ],
    },
    {
      type: "p",
      text: "With `origin` set, both layouts also contain `.well-known/adaptv/ota/manifest.json` and the bundle zip inside the client directory.",
    },
    { type: "h3", text: "The app shell" },
    {
      type: "p",
      text: "Every web build contains one generated HTML document: the app shell. It carries the pre-paint theme and platform script, inlined critical CSS, the hashed stylesheet and entry script, and an empty root. It is generated from your config and is identical for every visitor. It is never a saved copy of a rendered page, which would bake one user's session into a file served to everyone.",
    },
    {
      type: "ul",
      items: [
        "In an SPA build it is `index.html`, and it is the document every URL is answered with.",
        "In an SSR build it is `adaptv-shell.html`, and only the service worker reads it, as the offline fallback. It is deliberately not named `index.html`: static layers serve a directory index before they run the server, which would silently replace the server-rendered home page with an empty shell.",
      ],
    },
    { type: "h2", text: "Hosting an SSR build" },
    {
      type: "p",
      text: "Your `vite.config.ts` names no host: `plugins: [adaptv(), tailwindcss()]` is the whole list. adaptv adds the server build itself, and the deploy target is detected from the platform's own build environment on AWS Amplify, Azure, Cloudflare, Firebase App Hosting, Netlify, Stormkit, Vercel and Zeabur. Build anywhere else, or in your own CI, and you name the target with the `NITRO_PRESET` environment variable.",
    },
    {
      type: "code",
      label: "Terminal",
      lang: "bash",
      code: `# A Node server (the default when nothing is detected)
adaptv build web
node .output/server/index.mjs

# Cloudflare Workers, built in your own CI
NITRO_PRESET=cloudflare_module adaptv build web`,
    },
    {
      type: "p",
      text: "On Cloudflare the build generates its own wrangler config next to the server and merges your `wrangler.toml` into it: `vars`, KV, D1 and other bindings carry through. The one key the build owns is `main`, so leave it out of yours.",
    },
    {
      type: "note",
      tone: "warn",
      text: "Server-only code cannot ship to every target. A module that imports the underlying framework's server-function API fails the build, because the same source also builds into native apps that have no server. Put that logic behind your API and call it over the network, or use a route `loader`, which runs everywhere.",
    },
    { type: "h2", text: "Hosting a static build" },
    {
      type: "p",
      text: "Upload `dist/client/`. The four extra files make deep links work without telling adaptv which host you use. Each is read by one platform and ignored by the rest.",
    },
    {
      type: "table",
      head: ["File", "Read by", "Purpose"],
      rows: [
        [
          "`index.html`",
          "Every host",
          "The app shell under the name static hosts look for.",
        ],
        [
          "`404.html`",
          "GitHub Pages, Netlify",
          "The same shell, so `/settings` boots the app and the client router resolves it. It is byte-identical to `index.html`.",
        ],
        [
          "`.nojekyll`",
          "GitHub Pages",
          "Turns Jekyll off, which would otherwise strip build files whose names start with `_`.",
        ],
        [
          "`_redirects`",
          "Netlify, Cloudflare Pages",
          "`/*  /index.html  200`. A rewrite, not a redirect, so the URL is preserved.",
        ],
      ],
    },
    {
      type: "p",
      text: "On a host that reads none of these (S3 with CloudFront, nginx), configure the equivalent yourself: answer unknown paths with `/index.html` and status 200. Exclude `/.well-known/` from that rule if you publish OTA updates.",
    },
    { type: "h2", text: "Headers and caching" },
    {
      type: "p",
      text: "The build emits no headers file, so these are yours to set on the host. The `sw.js` and OTA manifest rows are requirements; the other two are the usual choice for hashed and unhashed files.",
    },
    {
      type: "table",
      head: ["Path", "Header", "Why"],
      rows: [
        [
          "`/sw.js`",
          "`Cache-Control: no-cache`",
          'A cached worker script delays every update. adaptv already registers it with `updateViaCache: "none"`; the header covers intermediaries.',
        ],
        [
          "`/assets/*`",
          "`Cache-Control: public, max-age=31536000, immutable`",
          "File names contain a content hash, so a URL never changes its bytes.",
        ],
        [
          "`/manifest.json`, icons, the shell HTML",
          "`Cache-Control: no-cache`",
          "Their URLs are not versioned.",
        ],
        [
          "`/.well-known/adaptv/ota/manifest.json`",
          "`Cache-Control: no-cache`",
          'A cached OTA manifest looks, from inside an installed app, exactly like "no update".',
        ],
      ],
    },
    {
      type: "p",
      text: "Three more requirements, all of which fail quietly:",
    },
    {
      type: "ul",
      items: [
        "**Serve over `https`.** Service workers need a secure context. On plain `http://` (other than `localhost`) the app renders and loses offline support and instant navigation; adaptv logs a console warning and nothing else happens.",
        "**Do not delete the previous build's files when you deploy.** A tab opened before the deploy still imports the old hashed chunks. `aws s3 sync --delete` and its equivalents turn a harmless deploy into broken sessions. Hashed names let build N-1 and build N coexist.",
        "**Subpath deploys**: the service worker registration follows Vite's `base`. The generated manifest's `start_url` is `/`, so override it through `manifestExtra` when the app lives under a subpath.",
      ],
    },
    {
      type: "p",
      text: "What the worker caches, and when a new deploy takes effect for a returning visitor, is covered in [Offline and the service worker](/docs/offline).",
    },
    { type: "h2", text: "Check it before you ship" },
    {
      type: "code",
      label: "Terminal",
      lang: "bash",
      code: `adaptv preview web`,
    },
    {
      type: "p",
      text: "`preview web` builds the production site and serves it locally, service worker included. `adaptv dev` has no worker, so this is the only local way to test offline behaviour, the update flow and installation. Everything after `--` is passed to Vite, for example `adaptv preview web -- --port 4000`.",
    },
    { type: "h2", text: "Installing as an app" },
    {
      type: "p",
      text: 'Every web build is installable. adaptv generates `manifest.json` from your config (`name`, `shortName`, `description`, `themeColor`, `backgroundColor`, `orientation`, the [icon set](/docs/icons-and-splash)) with `display: "standalone"` and `start_url: "/"`, and adds the head tags iOS needs. `manifestExtra` merges extra fields into it. The install flow is the browser\'s:',
    },
    {
      type: "table",
      head: ["", "iOS", "Android"],
      rows: [
        [
          "How",
          "Safari ▸ Share ▸ Add to Home Screen. There is no install prompt and no API to trigger one.",
          "Chrome shows an install prompt or a menu item (Install app / Add to Home screen) once the manifest, icons and worker qualify.",
        ],
        [
          "Icon",
          "The Apple touch icon from your icon set.",
          "The manifest icons. Maskable icons fill the launcher shape instead of sitting in a white box.",
        ],
        [
          "Launch screen",
          "None from the OS. adaptv paints `themeColor` before first frame and mounts your `splashScreen` component.",
          "Chrome draws one from the manifest's name, icon and `background_color`, then hands over to the same component.",
        ],
        [
          "Status bar",
          "The app draws under it (`black-translucent`). Pad with the [safe-area utilities](/docs/safe-areas).",
          "Chrome tints it from `theme-color`. The top inset reads `0`.",
        ],
        [
          "Bottom system bar",
          "The home indicator overlays your content. Pad the bottom inset.",
          "The navigation bar follows the device theme, not your app's. Only the native build controls it.",
        ],
        [
          "Back",
          "No browser back button. Provide one in the UI.",
          "The system back gesture or button navigates your router history.",
        ],
      ],
    },
    {
      type: "p",
      text: "Inside an installed app the `app:` style variant applies and `web:` does not, so a back arrow can be `web:hidden app:flex`. See [The six targets](/docs/six-targets). Setting `router.memoryHistoryInStandalone: true` switches an installed app to in-memory history, which makes the OS edge-swipe-back inert and keeps navigation under the app's control.",
    },
    {
      type: "note",
      text: "An installed PWA is still your website: it loads from your origin, updates when you deploy, and has no store review. It does not get native haptics, secure storage or the other capabilities that need the native shell. The per-capability tables on the [Capabilities](/docs/capabilities) page list what each target can do.",
    },
    { type: "h2", text: "Where it works" },
    {
      type: "targets",
      rows: [
        { target: "Desktop web", status: "yes", note: "SSR or SPA." },
        { target: "Mobile web", status: "yes", note: "The same deploy." },
        {
          target: "Installed PWA",
          status: "yes",
          note: "The same deploy, installed from the browser.",
        },
        {
          target: "iOS",
          status: "no",
          note: "Not deployed to a host. Built with `adaptv build ios` and updated over the air from this deploy.",
        },
        {
          target: "Android",
          status: "no",
          note: "Built with `adaptv build android` and updated over the air from this deploy.",
        },
      ],
    },
  ],
}
