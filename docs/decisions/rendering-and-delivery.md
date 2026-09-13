# adaptv — rendering & delivery: the settled deploy keys

> 🔒 **LOCKED.** Two decisions that together fix how an adaptv app is delivered on the web:
> what `render` defaults to, and why it is the *only* deploy key in `adaptv.config.ts`.
>
> Lifted out of the decision register 2026-08-30 (was `DECISIONS.md §6.3`/`§6.4`) — unchanged
> in substance. Enforced by `src/config/web-config.ts`, `src/vite/deploy-server.ts`.

---

## 1. 🔒 `render` defaults to `"ssr"` — and the asymmetry of being wrong settles it

> **Renamed 2026-08-09: `web.render` → a top-level `render`.** The decision below is unchanged; only the
> key moved. It sits at the top level because it is not a tuning knob next to `host` — it is the choice
> that determines what a deploy can even be: `"ssr"` needs something that runs per request (a Node
> process, a Worker, a function), `"spa"` needs nothing but somewhere to put files, which is what makes
> GitHub Pages, Netlify or a bucket viable.
>
> **Amended 2026-08-10:** `web` and `host` are now deleted outright, which makes `render` the *only*
> deploy-shaping key rather than the most important of two. → §2

I previously leaned SPA (client-held token + offline-first ⇒ SSR buys little). **That reasoning was
scoped too narrowly — to the authenticated app, ignoring everything around it.**

The case that decides it: someone picks adaptv *because* they want one codebase everywhere, and that app
has a public surface — a landing page, pricing, docs, a shareable product page. **Defaulting to SPA
kills SEO for all of it**, and the failure is silent and discovered late, after the marketing page is
already ranking badly.

**The asymmetry is the argument:**

| Wrong default | Cost | Recoverable? |
|---|---|---|
| SPA when SSR was needed | dead SEO, no social previews, slow first paint | only by re-architecting deploy — and you find out from analytics, months later |
| SSR when SPA would do | a server/adapter you didn't strictly need | flip one config key |

**And nothing is given up.** `docs/design/lifecycle.md`'s two-lineage model means `render:"ssr"` on web coexists with
the forced-SPA Capacitor bundle from the same source. Per `docs/design/rendering.md §3.2`, SSR also does **not**
restrict route-chunk precaching — warm routes and instant navigation are identical in both modes — so
choosing SSR costs nothing on the app side.

**⚠︎ The one real build-step consequence:** TanStack Start emits `_shell.html` **only in SPA mode**, so
`render:"ssr"` has no artifact for the SW's offline fallback to bind to. adaptv must **generate** a
static, user-agnostic shell for the SSR case. Generated, never a captured response — so it's
user-agnostic by construction rather than by luck. This is the single piece of offline behaviour that
cannot move up to the JS layer (§3.0).

Note this also reconciles `docs/design/lifecycle.md §1.2`'s flag that the code currently defaults to `spa` — that's
legacy, and the resolved default is `ssr`.

---

## 2. 🔒 `web.host` is deleted — `render` is the only deploy key (2026-08-10)

`AdaptvWebConfig` and the whole `web` block are gone. `render: "ssr" | "spa"` is the only thing in
`adaptv.config.ts` that shapes a deploy, and the deploy *target* is named nowhere at all — adaptv wires
the server build itself and the platform is detected at build time. See the second half of this section:
the target briefly lived in the consumer's `vite.config.ts` (Start's model), and then stopped needing to
live anywhere.

**The key was theatre, and it was measurable.** `web.host` had exactly one behavioural consumer:
`static-host.ts`, acting only on `"static"`. `cloudflare`, `vercel` and `node` were indistinguishable at
build time — setting `host: "node"` still produced `dist/server/wrangler.json`, because the Cloudflare
plugin in the consumer's Vite config was what decided. And `"static"` was not a fifth thing either: it
forced `render: "spa"`, so it was the same statement made twice, in two places that could disagree.

**Start has no adapters to expose.** Its plugin schema (`start-plugin-core` 1.171.24) has no `target`,
`preset`, `deployment` or `host` key at all. The target is *which plugin is present*: `@cloudflare/vite-plugin`
for Workers, `@netlify/vite-plugin-tanstack-start` for Netlify, and `nitro/vite` for everything else —
Vercel, Railway, Node, Bun, AWS Amplify, Azure, Firebase, Stormkit, Zeabur, Zephyr. With no plugin at
all, `vite build` emits a bare fetch handler at `dist/server/server.js` (verified in this repo by
removing `cloudflare()` from the playground). TanStack's own reasoning: writing ~10 adapters would have
consumed the framework budget, so they delegate to Nitro on H3.

**So an adaptv enum could only ever be a worse copy of that.** It would be permanently incomplete against
~20 real targets, it would need updating whenever Nitro adds a provider, and it would drag adaptv through
the Nitro 2 → 3 migration on its consumers' behalf.

**CI/CD needed nothing from us either.** Nitro auto-detects eight providers with zero configuration (AWS
Amplify, Azure, Cloudflare, Firebase App Hosting, Netlify, Stormkit, Vercel, Zeabur), and pipelines that
build outside the target platform set `NITRO_PRESET` / `SERVER_PRESET` — which Nitro's docs explicitly
recommend for CI/CD. An `adaptv build web --host vercel` would have been a narrower duplicate of that. It
would also have collided with `adaptv dev web --host`, where `--host` already means Vite's bind address.

**On opacity — the rule was being applied one layer too wide.** Opacity exists so adaptv can swap
TanStack or Capacitor without consumers noticing; those are *adaptv's* platform choices. A hosting
provider is the consumer's own choice, and hiding Cloudflare from the developer who chose Cloudflare buys
nothing while costing a permanently-wrong enum.

**What replaced the one real behaviour:** `adaptvStaticHostPlugin` now gates on `render === "spa"`. All
four files (`index.html`, `404.html`, `.nojekyll`, `_redirects`) are written for every SPA build, because
each is read by one platform and ignored by the rest — correct wherever the bucket lands, and the build
never has to be told where that is. Under `"ssr"` they are never written: `_redirects` would answer
navigations from a static file and take them away from the server.

### ✅ adaptv injects the deploy plugin itself (same day)

The deferral above lasted one conversation. The reasoning that ended it: adaptv is pre-alpha with a long
runway, so adopting the forward path **while it is still beta** costs nothing, whereas building against
the legacy `@tanstack/nitro-v2-vite-plugin` would buy a migration to perform later on consumers' behalf.
The version is **pinned exactly** (`nitro@3.0.260610-beta`) so the beta cannot move under a build, and
the bump is an explicit, reviewable change. → `src/vite/deploy-server.ts`

The consumer's `vite.config.ts` now names no host at all:

```ts
plugins: [adaptv(), tailwindcss()]
```

Each deferral reason, resolved:

1. **Beta** — accepted deliberately, pinned. Note it belongs to **UnJS, not TanStack**, so no Start
   release would have stabilised it; waiting had no end date to wait for.
2. **Cloudflare** — MEASURED, and it works. `NITRO_PRESET=cloudflare_module` emits
   `.output/server/wrangler.json` with `assets.directory: "../public"`, and `.output/public` contains
   `adaptv-shell.html` and **no `index.html`** — so the §3.3 shadowing fix carries over unchanged: no
   asset matches `/`, and the worker renders it. 111 precache entries, complete.

   **The app's `wrangler.toml` is merged, not replaced** — worth stating precisely, because "the build
   generates its own wrangler config" reads like the app's is discarded. VERIFIED by adding each binding
   kind to the playground's toml and reading the generated file back: `vars`, `kv_namespaces`,
   `d1_databases` and `observability` all came through intact, alongside `name`, `compatibility_date`,
   `compatibility_flags` and `upload_source_maps`. Nitro *adds* `assets`, `no_bundle` and `rules`.

   The single key the build owns is **`main`**, which has to point at the bundle it just produced — and
   it says so out loud (`WARN [cloudflare] Wrangler config main is overridden and will be ignored`)
   rather than silently. An app should simply not declare `main`; the playground's no longer does.
3. **`dist/client`** — deleted. The client output directory is now read from Vite's resolved config
   (`captureClientOutDir` in `adaptv-context.ts`) and never assumed.

**The hook is `buildApp` at `order: "post"`, and that distinction was expensive to find.** All three
emitters used to run on the `ssr` environment's `closeBundle`. With a deploy plugin present that is *too
early*: Nitro is still assembling the output directory afterwards. The first Nitro build produced a
worker with **21 files silently missing** from the precache — every favicon, the offline illustrations,
`robots.txt` — because the glob ran against a half-populated directory. No error, no warning; it would
have surfaced as a broken offline render months later. `buildApp` at `post` runs after every environment
*and* after the deploy plugin's own `post` hook. VERIFIED: 111/111, and the six previously-missing assets
all resolve from Cache Storage with the server killed.

**Amended 2026-09-13: `buildApp` post was right for the precache and too late for the node server.**
Nitro's own `post` hook does not just assemble the directory; it ends by bundling the server, and the
`node-server` preset bakes a public asset table into that bundle from whatever `.output/public` holds at
that moment (the inline presets bake the bytes as well). The shell and the worker were written after it.
MEASURED: `node .output/server/index.mjs` answered **404 for `/sw.js` and `/adaptv-shell.html`** with
both files on disk, while `/manifest.json` and `/favicons/favicon.ico` answered 200 — so a production SSR app never
installed its worker and had no offline path. Every suite missed it because they serve with `vite
preview`, which reads the directory. The two emitters now run at the start of Nitro's server
environment (`emitIntoClientOutput` in `src/vite/deploy-server.ts`): after the client build and after
Nitro has copied `public/` in, so the precache still sees all 121 entries, and before the table exists.
Without a server build (`spa`, the native lineage) the moment is still `buildApp` post.
`playwright.sw-node.config.ts` runs the worker suite against the node server so the two cannot drift
again.

**Also found, and it is a harness bug rather than an adaptv one.** Removing `@cloudflare/vite-plugin`
from the playground broke Start's SPA prerender with `Cannot read properties of null (reading
'useEffect')` — two React instances. `playground/` is its own pnpm project, so it had its own `react`
copy while `react-dom` resolved from the repo root; the Cloudflare plugin had been hiding it by bundling
everything for workerd. Fixed the way `vite` already was in that file: `"react": "link:../../../node_modules/react"`.
A real consumer installs adaptv into one tree and cannot hit this.

**What CI/CD looks like now:** nothing. On the eight zero-config providers the preset comes from the
platform's own build environment; everywhere else it is `NITRO_PRESET`. adaptv adds no key and no flag.

### ✅ The fallout: `render` was answering a question only `target` can answer

Deleting `web.host` left `render` as the only build-shaping key, and three decisions were quietly
re-pointed at it that are not about rendering at all. A Capacitor bundle is `render: "spa"` too, so
every `render === "spa"` gate now fires on the native lineage as well. Two things were measured:

1. **Every `.ipa`/`.apk` shipped `_redirects`, `404.html` and `.nojekyll`** — files that answer to an
   HTTP host a WebView does not have. *(Pre-existing, not a regression from `host`'s deletion: the old
   code gave the capacitor target `host: "static"`, so the same emitter already fired. The deletion is
   what made it visible.)*
2. **`dist/client` was written by both lineages.** They were kept apart *in time* — the CLI runs a fresh
   `ADAPTV_TARGET=capacitor` build before every `cap sync` — which holds under `ssr` only because the
   server build relocates the web output to `.output/`. Under `render: "spa"` they collided, and the
   collision lands in the middle of `adaptv preview all`: web build → **native build** → serve. MEASURED:
   `sw.js` present after the web build, gone after the native one, `index.html` byte-identical
   (`572b120d…`) both times. A SPA app previewed with `all` was served the WebView bundle, with no
   service worker and nothing in the output saying so.

So `AdaptvContext` now carries `target` alongside `web`. `render` says how the app renders; `target`
says where the bundle is loaded from. Anything a browser tab has and a WebView does not — a URL bar, a
favicon, an install prompt, an HTTP host — keys off `target`.

**Fixed, and it paid for itself in bytes.** The native lineage moved to `.adaptv/web` (an intermediate
the native project consumes, not something a host deploys), the static-host emitter is registered only
on `target: "web"`, and a mirror-image `adaptvNativeBundlePlugin` drops what a WebView can never read:
the icon art, `registerSW`'s body (`virtual:adaptv/pwa-register` emits a stub when
`sw.enabled` is false) and the manifest's `icons` array. Head links and manifest entries are suppressed
at their source, not merely deleted — a dangling `<link rel="icon">` is a burst of 404s on every cold
launch. **4.5 MB → 3.1 MB on the playground**, 1.3 MB of it icon art. → `docs/design/lifecycle.md §3.2a`

`manifest.json` itself stays on the native target: `useManifestOrientation` fetches it on device so the
iOS guard mirrors the `orientation` Android enforces natively.

**One thing was tried and reverted:** moving the `ssr` environment's `outDir` as well, so the native
build touched no part of `dist/`. The prerender boots the freshly built server to crawl the routes and
came back `Internal Server Error` on every request — `Failed to fetch /`, zero pages, failed build.
`dist/server` stays shared. It is scratch nothing syncs; the directory that **ships** is the one that
had to stop being shared.

