/**
 * How navigations are served, and which caches get swept.
 *
 * Both are pure decisions, kept apart from the Workbox wiring so they can be
 * reasoned about and tested without a `ServiceWorkerGlobalScope`.
 */

/** The build's render mode. `capacitor` is a target, not a `web.render` value. */
export type NavigationMode = "ssr" | "spa" | "capacitor"

export type NavigationPolicy = {
  kind: "network-only-with-shell-fallback" | "app-shell" | "none"
  /**
   * Always `false`. Present as an explicit, asserted field rather than an
   * unwritten rule, because "cache the HTML too" is the single most tempting
   * wrong turn available here and it is a **cross-user data leak**, not a
   * performance trade-off. → `RENDERING.md §3.2`, `DECISIONS.md` B5/B25.
   */
  cachesDocuments: false
}

/**
 * The navigation strategy is a pure function of the render mode — the same config
 * that produced the build decides how navigation is served, so the two cannot
 * drift. → `RENDERING.md §3.1`
 *
 * | mode | handling | why |
 * |---|---|---|
 * | `ssr` | `NetworkOnly` + precache **fallback** | preserves the per-request render on every *online* navigation. A blanket `NavigationRoute` would hijack online navigations too and silently turn an SSR app into a stale SPA for returning visitors. |
 * | `spa` | `NavigationRoute` → app shell | there is no per-request render to preserve, so the classic app shell is simply correct. |
 * | `capacitor` | none | §3.5 — impossible on iOS (custom scheme origin), silently inconsistent on Android, redundant (the bundle is on-disk), and actively hostile to OTA. |
 */
export function resolveNavigationPolicy(
  mode: NavigationMode,
): NavigationPolicy {
  if (mode === "capacitor") return { kind: "none", cachesDocuments: false }
  if (mode === "spa") return { kind: "app-shell", cachesDocuments: false }
  return {
    kind: "network-only-with-shell-fallback",
    cachesDocuments: false,
  }
}

/* ============================================================================
 * Cache sweep — B2
 * ========================================================================== */

/**
 * Runtime buckets nativ owns. A cache is only ever deleted if it starts with one
 * of these *and* carries a build tag that is not the current one.
 */
const NATIV_RUNTIME_BUCKETS = ["static", "pages", "documents"] as const

/**
 * Whether `cacheName` is one of nativ's runtime caches from a **previous** build.
 *
 * Runtime buckets are namespaced `<bucket>-<buildTag>`, so every deploy mints new
 * ones — but only `cleanupOutdatedCaches()` ran, and that purges *precaches*
 * only. Every prior deploy's runtime caches therefore accumulated forever, which
 * on a frequently-deployed app is unbounded storage growth ending in a quota
 * error. → `DECISIONS.md` B2
 *
 * Deliberately conservative: an unrecognised bucket is never touched. Deleting a
 * cache nativ does not own would break whatever created it — another app on the
 * same origin, a third-party worker, or Workbox's own precache bookkeeping.
 */
export function isStaleRuntimeCache(
  cacheName: string,
  currentBuildTag: string,
): boolean {
  for (const bucket of NATIV_RUNTIME_BUCKETS) {
    const prefix = `${bucket}-`
    //require the separator so `staticky-…` is not read as the `static` bucket
    if (!cacheName.startsWith(prefix)) continue
    return cacheName.slice(prefix.length) !== currentBuildTag
  }
  return false
}

/** The subset of `cacheNames` safe to delete on activate. */
export function selectStaleCaches(
  cacheNames: readonly string[],
  currentBuildTag: string,
): string[] {
  return cacheNames.filter((name) =>
    isStaleRuntimeCache(name, currentBuildTag),
  )
}
