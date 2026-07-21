/**
 * The `precacheDocuments` allowlist. → `RENDERING.md §3.2`
 *
 * Route **chunks** are precached aggressively and automatically: they are static,
 * content-hashed and byte-identical for every user, and precaching all of them is
 * what makes an installed PWA navigate like the native build.
 *
 * **Documents are the opposite kind of thing.** Under SSR a document is rendered
 * per-request and carries a session, while Cache Storage is keyed by URL and
 * scoped per-*origin*, not per-user. Precaching one means user A logs in, their
 * dashboard HTML is cached, and user B on the same device is served it.
 *
 * But *public* documents — a landing page, pricing, a blog post — are identical
 * for every visitor, and precaching them gives an instant, offline-capable cold
 * load. That is what makes "landing page + app in one codebase" actually work:
 * SEO comes from the crawler receiving real SSR HTML (crawlers don't run service
 * workers), and the allowlist additionally makes that page instant for humans.
 *
 * Only the app knows which routes are which, so this is an **explicit allowlist,
 * empty by default**. Safe by construction: naming a route is a deliberate act.
 */

/** Path segments that mark a route as dynamic in the supported router syntaxes. */
const DYNAMIC_SEGMENT = /(^|\/)[$:*]/

/**
 * Map an app path to the static artifact a host serves for it.
 * `/` → `index.html`, `/pricing` → `pricing/index.html`.
 */
export function documentPathToArtifact(path: string): string {
  const trimmed = path.replace(/^\/+/, "").replace(/\/+$/, "")
  return trimmed === "" ? "index.html" : `${trimmed}/index.html`
}

/**
 * Validate the allowlist and map it to precache artifact paths.
 *
 * Throws rather than skipping on a bad entry. A silently-dropped path would look
 * exactly like a working one — the page just wouldn't be offline-capable, which
 * nobody would notice until a user did.
 */
export function resolvePrecacheDocuments(
  paths: readonly string[] | undefined,
): string[] {
  if (!paths || paths.length === 0) return []

  const artifacts = new Set<string>()
  for (const path of paths) {
    if (!path.startsWith("/")) {
      throw new Error(
        `[nativ] precacheDocuments: "${path}" must start with "/" — it names an app route, not a URL or a relative path.`,
      )
    }
    if (path.includes("?") || path.includes("#")) {
      throw new Error(
        `[nativ] precacheDocuments: "${path}" must not contain a query or hash — those are not separate documents.`,
      )
    }
    if (DYNAMIC_SEGMENT.test(path)) {
      throw new Error(
        `[nativ] precacheDocuments: "${path}" is a dynamic route. There is no single artifact to precache, and per-item routes are usually per-user — which is exactly what this allowlist exists to keep out of a shared cache.`,
      )
    }
    //dedupe: Workbox precache is all-or-nothing, and a duplicate URL with a
    //different revision throws at install, failing the entire worker
    artifacts.add(documentPathToArtifact(path))
  }
  return [...artifacts]
}
