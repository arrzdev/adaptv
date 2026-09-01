/// <reference lib="webworker" />

import { createHandlerBoundToURL, matchPrecache } from "workbox-precaching"
import { registerRoute } from "workbox-routing"
import { registerNavigationPreload } from "#adaptv/sw/sw.lifecycle"
import type {
  NavigationMode,
  NavigationPolicy,
} from "#adaptv/sw/sw.navigation-policy"
import { resolveNavigationPolicy } from "#adaptv/sw/sw.navigation-policy"

export type NavigationRouteOptions = {
  /** the app config`s `render` for a web build, or `"capacitor"` for native. */
  mode: NavigationMode
  /**
   * The precached app shell URL the fallback binds to — a **generated,
   * user-agnostic** document whose only job is to boot the client router at
   * `location.pathname`. It must be generated, never a captured response, so it
   * is user-agnostic by construction rather than by luck.
   */
  appShellUrl: string
  /**
   * Path prefixes the SW must not claim — API routes, auth callbacks, asset dirs.
   * **Replaces** {@link DEFAULT_DENY_PREFIXES}, it does not extend them: pass
   * `["/auth/"]` and `/api/`, `/assets/` and `/_serverFn/` stop being denied, so
   * restate the ones you still need. The file heuristic below applies either way;
   * it is not a prefix and cannot be switched off.
   */
  denyPathPrefixes?: readonly string[]
  /**
   * Seconds an SSR navigation waits for the network before falling back to the
   * shell. Ignored in `spa` mode, which never goes to the network.
   */
  networkTimeoutSeconds?: number
}

const DEFAULT_DENY_PREFIXES = [
  "/api/",
  "/assets/",
  //The server-function endpoint the data layer posts to. Not a navigation today
  //(those requests are `mode: "cors"`), so this is not load-bearing — it is here
  //so that a future request shape cannot quietly turn into a hijacked document.
  "/_serverFn/",
] as const

/**
 * A last path segment containing a dot is a **file**, not a navigation.
 *
 * `mode: "navigate"` is what a browser sends for a plain LINK to a file, and
 * Workbox's `NavigationRoute` has no default that excludes them — so without this
 * the SW treats `/whitepaper.pdf` as a route. Neither it nor `/sitemap.xml` is in
 * the precache glob (§3.2), so there is nothing to serve them from.
 *
 * Borrowed from Angular's ngsw, including its known cost: a route whose **last**
 * segment contains a dot (`/blog/hello.world`) is read as a file. Segments before
 * the last are unaffected (`/v1.2/docs` is a navigation), and so is the query
 * string. Worth it — the alternative is an allowlist of extensions that is wrong
 * the moment someone serves a format nobody listed.
 */
const FILE_LIKE_PATHNAME = /\/[^/?]+\.[^/]+$/

/** Paths the SW must not claim at all — API routes, asset dirs, server fns. */
export function isDeniedPath(
  pathname: string,
  denyPathPrefixes: readonly string[] = DEFAULT_DENY_PREFIXES,
): boolean {
  return denyPathPrefixes.some((prefix) => pathname.startsWith(prefix))
}

/** @see FILE_LIKE_PATHNAME */
export function isFileLikePath(pathname: string): boolean {
  return FILE_LIKE_PATHNAME.test(pathname)
}

/**
 * Whether the SW may answer `pathname` **with the app shell**.
 *
 * This is the one rule the file heuristic actually encodes, and stating it that
 * way is what lets the two render modes apply it correctly instead of
 * identically:
 *
 * - `spa` serves the shell and nothing else, so "may not serve the shell" is the
 *   same as "may not claim it" — the route declines and the browser takes it.
 * - `ssr` goes to the network first and only *falls back* to the shell, so it
 *   still claims the navigation — for why claiming matters there, see the
 *   matcher comment in {@link registerNavigationRoute} — and simply has no
 *   shell to fall back to.
 */
export function mayServeAppShell(
  pathname: string,
  denyPathPrefixes: readonly string[] = DEFAULT_DENY_PREFIXES,
): boolean {
  return (
    !isDeniedPath(pathname, denyPathPrefixes) && !isFileLikePath(pathname)
  )
}

/**
 * How long an SSR navigation waits before booting from the shell instead.
 *
 * With no timeout the navigation only falls back when the network **errors** —
 * so on a live-but-terrible connection (a tunnel, congested 3G, a captive
 * portal) the cold load hangs indefinitely while a perfectly good shell sits in
 * the precache. Three seconds is long enough that a normal slow server still
 * wins the race and the user gets the real server render.
 */
const DEFAULT_NAVIGATION_TIMEOUT_SECONDS = 3

/**
 * Everything the SSR navigation handler touches outside itself, passed in.
 *
 * This is the one code path every single navigation goes through, and its
 * failure modes are all *timing* — a preload that never settles, a network that
 * hangs, a shell that is missing. Injecting them is what makes those testable
 * without a `ServiceWorkerGlobalScope`.
 */
export type NavigationRequestIO = {
  /**
   * `event.preloadResponse` — the request the **browser** started in parallel
   * with worker startup. Absent where the browser has no preload at all; may
   * still resolve to `undefined` when the registration has not applied
   * `enable()` yet (the very first navigation after an install can land here).
   */
  preload?: Promise<Response | undefined>
  /** The network attempt to make when there is no usable preload. */
  fetch: () => Promise<Response>
  /** The precached app shell. */
  shell: () => Promise<Response | undefined>
  /** `event.waitUntil` — keeps an abandoned preload alive so it can settle. */
  keepAlive: (work: Promise<unknown>) => void
  timeoutMs: number
}

/**
 * Serve one SSR navigation: preload if the browser started one, otherwise the
 * network, and the precached shell if neither lands in time.
 *
 * **Consuming the preload is not optional.** A preload that is enabled and never
 * read is worse than no preload: the browser issues the request anyway, then
 * logs *"The service worker navigation preload request was cancelled before
 * 'preloadResponse' settled"* on every single navigation. Workbox's `NetworkOnly`
 * does not read it, which is why this handler is written out rather than
 * configured — the two halves (`enable()` in activate, this read) only work as a
 * pair. → `docs/design/rendering.md §3.3`
 *
 * A preload resolving `undefined` means "the browser did not preload this one",
 * **not** "the network failed" — falling back to the shell there would serve a
 * cold boot to an online user with a perfectly good server sitting there.
 */
export async function serveNavigation(
  io: NavigationRequestIO,
): Promise<Response> {
  //Never rejects. Once the deadline wins the race nothing is listening any more,
  //so a rejection arriving later would surface as an unhandled rejection in the
  //worker — on a path whose only sin is being slow.
  const network = (async () => {
    try {
      const preloaded = io.preload ? await io.preload : undefined
      return preloaded ?? (await io.fetch())
    } catch {
      return undefined
    }
  })()

  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => resolve(undefined), io.timeoutMs)
  })

  try {
    const response = await Promise.race([network, deadline])
    if (response) return response
  } finally {
    clearTimeout(timer)
  }

  //The network lost the race but is still in flight. If it is a *preload*, the
  //browser owns that request and dropping the FetchEvent here cancels it — which
  //is exactly the case that logs the warning above, on a path behaving as
  //designed. Holding the event open lets it settle quietly.
  io.keepAlive(network)

  const shell = await io.shell()
  //the shell is precached unconditionally (§3.2), so this is the storage-is-gone
  //case: there is nothing left to serve and the browser shows its own error
  return shell ?? Response.error()
}

/**
 * Register navigation handling for the build's render mode.
 *
 * ## Documents are never cached. Route chunks always are.
 *
 * They are **different kinds of thing**: chunks are static, content-hashed and
 * identical for every user, so precaching all of them is exactly right — it is
 * what makes an installed PWA navigate like the native build. Documents are
 * per-request and carry a session, so nothing here writes one to a cache.
 * → `docs/design/rendering.md §3.2`
 *
 * The rule is not "cache less"; it is that caching a document is a **cross-user
 * data leak**. An earlier implementation cached navigation responses into a
 * `pages-<tag>` bucket and warmed it at install by fetching every route's HTML
 * with `credentials: "same-origin"`. Under SSR those responses are per-user and
 * the cache is keyed by URL alone — user A logs in, their dashboard HTML is
 * cached, and user B on the same device is served it whenever the network is
 * slow. NetworkFirst falls back to cache on timeout, so that was not an
 * offline-only exposure. → `docs/decisions/register.md` B5/B25
 *
 * ## Why SSR uses a fallback rather than a NavigationRoute
 *
 * A blanket `NavigationRoute` hijacks *online* navigations too, which silently
 * converts an SSR app into a stale SPA for every returning visitor. Network-only
 * plus a precache **fallback** gives SSR-on-every-navigation *and* a fully
 * functional offline app: the shell boots React, the router resolves the real
 * path, and the route renders its own offline UI in place — no redirect, no
 * `offline.html`, and the same mechanism the native target gets for free.
 */
export function registerNavigationRoute(
  options: NavigationRouteOptions,
): NavigationPolicy {
  const policy = resolveNavigationPolicy(options.mode)
  if (policy.kind === "none") return policy

  if (policy.kind === "app-shell") {
    //SPA: no per-request render to preserve, so serving the shell for every
    //navigation is simply correct — for everything the shell is allowed to
    //answer. `NavigationRoute`'s own `denylist` is deliberately not used: it
    //takes prefixes only, so the file rule would have had to live somewhere
    //else, and a second place to decide this is how it drifted from the docs
    //in the first place.
    registerRoute(
      ({ request, url }) =>
        request.mode === "navigate" &&
        mayServeAppShell(url.pathname, options.denyPathPrefixes),
      createHandlerBoundToURL(options.appShellUrl),
    )
    //...and precisely because navigations never reach the network here, a
    //preload would be a document fetched for every navigation and thrown away.
    registerNavigationPreload(false)
    return policy
  }

  //SSR: always hit the network; fall back to the precached shell when the network
  //fails OR takes too long. There is no cache-write path at all — that absence is
  //the property that makes this safe, not a configuration choice that could be
  //flipped later. The timeout therefore costs nothing in privacy terms: what it
  //falls back to is the generated, user-agnostic shell, never a document some
  //other user's session produced. The preload is the same request with the same
  //credentials the browser would have sent anyway, and it is never cached either.
  const timeoutMs =
    (options.networkTimeoutSeconds ?? DEFAULT_NAVIGATION_TIMEOUT_SECONDS) *
    1000

  registerRoute(
    //Files are claimed here, unlike in `spa` — the browser has already started a
    //preload for them, and declining leaves that response unread and costs a
    //second request for every file link (MEASURED: two document hits at the
    //origin for one `/whitepaper.pdf` navigation). They are excluded from the
    //*fallback* instead, below.
    ({ request, url }) =>
      request.mode === "navigate" &&
      !isDeniedPath(url.pathname, options.denyPathPrefixes),
    ({ request, url, event }) => {
      //the route only matches `mode: "navigate"`, so this is always a FetchEvent
      const fetchEvent = event as FetchEvent
      return serveNavigation({
        preload:
          "preloadResponse" in fetchEvent
            ? fetchEvent.preloadResponse
            : undefined,
        fetch: () => fetch(request),
        //offline, a file link has nothing to fall back TO: answering it with the
        //app shell hands the browser HTML where it asked for a PDF. No shell →
        //`serveNavigation` returns a network error, which is the honest outcome.
        shell: () =>
          isFileLikePath(url.pathname)
            ? Promise.resolve(undefined)
            : matchPrecache(options.appShellUrl),
        keepAlive: (work) => fetchEvent.waitUntil(work),
        timeoutMs,
      })
    },
  )
  //the other half of the preload — enabled here, next to the only code that
  //reads it, so neither can be added or removed without the other
  registerNavigationPreload(true)
  return policy
}
