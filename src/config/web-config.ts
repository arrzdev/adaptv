/**
 * The `web` deployment block — intent-level config, resolved.
 * → `LIFECYCLE.md §1.2` (D4), `DECISIONS.md §6.3`
 *
 * The deploy shape used to be two low-level fields (`router.render` + `sw`) with
 * the web adapter hardcoded in the app's `vite.config`. That is mechanism leaking
 * into config: the consumer states *how* rather than *what*. This resolves an
 * intent-level block instead, and keeps the old fields working as escape hatches
 * so existing apps keep building.
 */
import type { NativAppConfig } from "#nativ/config/app-config.ts"
import { resolvePrecacheDocuments } from "#nativ/config/precache-documents.ts"
import type { ServiceWorkerUpdateMode } from "#nativ/config/types.ts"

/** Where the web build is deployed. Maps to a TanStack Start deploy preset. */
export type NativHost = "cloudflare" | "vercel" | "node" | "static"

export type ResolvedWebConfig = {
  render: "ssr" | "spa"
  host: NativHost
  sw: {
    enabled: boolean
    precacheDocuments: string[]
    register: ServiceWorkerUpdateMode
  }
}

/**
 * Resolve the effective web config.
 *
 * `target: "capacitor"` is an **override, not a default** (L12): a Capacitor
 * WebView loads on-device files, so there is no server to SSR against, and a
 * service worker is impossible on iOS's custom-scheme origin, redundant (the
 * bundle is already local) and actively breaks OTA. Nothing in the config can
 * turn either back on.
 */
export function resolveWebConfig(
  config: NativAppConfig,
  target: "web" | "capacitor" = "web",
): ResolvedWebConfig {
  const web = config.web ?? {}

  if (target === "capacitor") {
    return {
      render: "spa",
      host: "static",
      sw: { enabled: false, precacheDocuments: [], register: "manual" },
    }
  }

  //`web.render` wins over the legacy `router.render`; absent both, SSR.
  //Defaulting to SSR is the asymmetry argument, not a performance one: a wrong
  //SPA default silently kills SEO and is found late, by someone reading a
  //ranking report. A wrong SSR default costs one config flip, immediately.
  const render = web.render ?? config.router.render ?? "ssr"

  const legacySwDisabled = config.sw === false
  const swBlock = web.sw ?? {}
  const swObject = typeof config.sw === "object" ? config.sw : undefined

  return {
    render,
    host: web.host ?? "node",
    sw: {
      enabled: (swBlock.enabled ?? true) && !legacySwDisabled,
      precacheDocuments: resolvePrecacheDocuments(
        swBlock.precacheDocuments ?? swObject?.precacheDocuments,
      ),
      register: swBlock.register ?? "prompt",
    },
  }
}

/**
 * The files a static host needs, keyed by output-relative path.
 *
 * None of these were emitted before, so `host: "static"` was documented but not
 * actually deployable (`DECISIONS.md` B26). Each one exists for a specific host
 * behaviour, not for symmetry:
 *
 * - **`index.html`** — TanStack Start emits `_shell.html`, and *only* in SPA
 *   mode. GitHub Pages runs Jekyll, which **strips `_`-prefixed files**, and
 *   Cloudflare Workers Assets looks for `/index.html`. The shell is invisible to
 *   both under its own name.
 * - **`404.html`** — a static host has no router, so `/settings` is a hard 404
 *   unless the shell is served for unknown paths. `404.html` is the convention
 *   GitHub Pages and Netlify both honour, and it must be the *same* shell.
 * - **`.nojekyll`** — turns Jekyll off entirely, which is the only reliable way
 *   to stop it eating `_`-prefixed build output.
 * - **`_redirects`** — the Netlify/Cloudflare Pages SPA rule. `200` rather than
 *   `301`: the URL must be preserved so the client router can resolve it.
 */
export function staticHostFiles(
  shellHtml: string,
): Record<string, string> {
  return {
    "index.html": shellHtml,
    //deliberately identical to index.html — a different document here would
    //render a different app for anyone who deep-linked
    "404.html": shellHtml,
    ".nojekyll": "",
    _redirects: "/*    /index.html   200\n",
  }
}
