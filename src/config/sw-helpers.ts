/**
 * Build-time constants for the service worker. → `RENDERING.md §3`
 *
 * There is no `defineSwConfig` any more, and no app-owned `sw.config.ts`. The
 * worker is framework-owned: an app contributes modules through
 * `serviceWorkers: []` and nothing else. → `AdaptvAppConfig.serviceWorkers`
 */

/**
 * The generated app shell, relative to the client output dir.
 *
 * Precached unconditionally, and that is infrastructure rather than an opinion:
 * the navigation route BINDS to this URL, so a build where it is absent from the
 * manifest produces a worker that either falls through to the browser error page
 * (ssr) or throws `non-precached-url` at evaluation and never installs (spa).
 *
 * ## Why the name depends on `render`
 *
 * `index.html` is the *directory index* on every static file server there is. In
 * a SPA build that is exactly right — nothing else is competing for `/`, and deep
 * links need it. In an **SSR** build it is a trap: the shell lives in the client
 * output directory, which asset-first hosts serve **before** they run the server.
 *
 * MEASURED on Cloudflare Workers Assets (`assets.directory` is `dist/client`):
 * `GET /` returned the 3 079-byte shell while `GET /settings` returned 76 741
 * bytes of real server render — so the home route silently lost SSR and its SEO
 * with it. Vercel resolves static before functions the same way. Naming the SSR
 * shell something that is not a directory index means no asset matches `/`, the
 * request falls through to the server, and the shell stays a plain file the
 * worker can still precache and serve offline. → `RENDERING.md §3.3`
 */
export const SPA_APP_SHELL_FILE = "index.html"

/**
 * The SSR shell's name. Deliberately **not** `_`-prefixed: GitHub Pages runs
 * Jekyll, which strips `_`-prefixed files, and while a static host is always SPA
 * today, a name that breaks on one host is a trap waiting for the next change.
 */
export const SSR_APP_SHELL_FILE = "adaptv-shell.html"

/** The shell filename for a render mode. One source of truth for every caller. */
export function appShellFile(render: "ssr" | "spa"): string {
  return render === "spa" ? SPA_APP_SHELL_FILE : SSR_APP_SHELL_FILE
}

/**
 * Everything precached besides the shell: every route chunk, the stylesheet, the
 * icons, the fonts.
 *
 * **`html` is deliberately absent.** Route documents are per-request under SSR
 * and Cache Storage is keyed by URL and scoped per-ORIGIN, not per-user — so a
 * pattern that swept them in would serve one user's rendered page to the next.
 * The shell is the single exception and it is added by name, because it is
 * generated and identical for everybody. → `RENDERING.md §3.2`
 */
export const DEFAULT_SW_GLOB_PATTERNS = [
  "**/*.{js,css,ico,png,svg,woff2,json,txt}",
] as const

/** The worker's own output, plus the esbuild bundle it is stamped from. */
export const DEFAULT_SW_GLOB_IGNORES = ["sw.js", "sw-src.js"] as const

export const DEFAULT_SW_MAX_FILE_BYTES = 5 * 1024 * 1024
