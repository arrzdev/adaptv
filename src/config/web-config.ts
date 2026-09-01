/**
 * The resolved web build settings.
 * → `docs/design/lifecycle.md §1.2` (D4), `docs/decisions/rendering-and-delivery.md §1`, `docs/decisions/rendering-and-delivery.md §2`
 *
 * The consumer states *what* (ship SSR), not *how* (which navigation strategy,
 * which shell filename). Everything mechanical is derived.
 *
 * There is no `host` here. It existed, and it was theatre: the only value that
 * ever changed a byte of output was `"static"`, which is just `render: "spa"`
 * said twice. → `docs/decisions/rendering-and-delivery.md §2`
 */
import type { AdaptvAppConfig } from "#adaptv/config/app-config.ts"

export type ResolvedWebConfig = {
  render: "ssr" | "spa"
  sw: {
    /**
     * Whether a service worker is built and registered. Derived from the TARGET
     * alone — there is no config key behind it.
     *
     * The worker is core product behaviour, not a feature flag: it is what makes
     * a web build navigate like the native one. The single case where it is off
     * is Capacitor, where a worker is impossible on iOS, silently inconsistent on
     * Android, redundant (the bundle is on-disk) and hostile to OTA. → §3.5
     */
    enabled: boolean
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
  config: AdaptvAppConfig,
  target: "web" | "capacitor" = "web",
): ResolvedWebConfig {
  if (target === "capacitor") {
    return { render: "spa", sw: { enabled: false } }
  }

  //Defaulting to SSR is the asymmetry argument, not a performance one: a wrong
  //SPA default silently kills SEO and is found late, by someone reading a
  //ranking report. A wrong SSR default costs one config flip, immediately.
  return {
    render: config.render ?? "ssr",
    //`true`, with no key behind it. Every web build gets the worker.
    sw: { enabled: true },
  }
}

/**
 * The files a static host needs, keyed by output-relative path.
 *
 * Emitted for **every `render: "spa"` build**, not for a nominated host. Each one
 * is read by a different platform and ignored by the rest, so emitting all four
 * unconditionally is correct wherever the build lands and inert everywhere else —
 * which is precisely why adaptv no longer asks *which* host. They are never
 * emitted under `"ssr"`: `_redirects` there would answer every navigation from a
 * static file and hijack it away from the server. → `docs/decisions/rendering-and-delivery.md §2`
 *
 * Each one exists for a specific host behaviour, not for symmetry:
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
