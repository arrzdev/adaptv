import {
  createHandlerBoundToURL,
  PrecacheFallbackPlugin,
} from "workbox-precaching"
import { NavigationRoute, registerRoute } from "workbox-routing"
import { NetworkOnly } from "workbox-strategies"
import type {
  NavigationMode,
  NavigationPolicy,
} from "#nativ/sw/sw.navigation-policy"
import { resolveNavigationPolicy } from "#nativ/sw/sw.navigation-policy"

export type NavigationRouteOptions = {
  /** `web.render` for a web build, or `"capacitor"` for the native target. */
  mode: NavigationMode
  /**
   * The precached app shell URL the fallback binds to — a **generated,
   * user-agnostic** document whose only job is to boot the client router at
   * `location.pathname`. It must be generated, never a captured response, so it
   * is user-agnostic by construction rather than by luck.
   */
  appShellUrl: string
  /** Paths the SW must not claim — API routes, auth callbacks, asset dirs. */
  denyPathPrefixes?: readonly string[]
}

const DEFAULT_DENY_PREFIXES = ["/api/", "/assets/"] as const

/**
 * Register navigation handling for the build's render mode.
 *
 * ## Why documents are never cached
 *
 * The previous implementation cached navigation responses into a `pages-<tag>`
 * bucket and warmed it at install time by fetching every route's HTML with
 * `credentials: "same-origin"`. Under SSR those responses are **per-user**, and
 * the cache is keyed by URL alone — so user A logs in, their dashboard HTML is
 * cached, and user B on the same device is served it whenever the network is
 * slow. NetworkFirst falls back to cache on timeout, so this was not an
 * offline-only exposure. → `DECISIONS.md` B5/B25
 *
 * The fix is not "cache less". It is that **route chunks and documents are
 * different kinds of thing**: chunks are static, content-hashed and identical for
 * every user, so precaching all of them is exactly right — it is what makes an
 * installed PWA navigate like the native build. Documents are per-request and
 * carry a session. → `RENDERING.md §3.2`
 *
 * ## Why SSR uses a fallback rather than a NavigationRoute
 *
 * A blanket `NavigationRoute` hijacks *online* navigations too, which silently
 * converts an SSR app into a stale SPA for every returning visitor.
 * `NetworkOnly` + a precache **fallback** gives SSR-on-every-navigation *and* a
 * fully functional offline app: the shell boots React, the router resolves the
 * real path, and the route renders its own offline UI in place — no redirect, no
 * `offline.html`, and the same mechanism the native target gets for free.
 */
export function registerNavigationRoute(
  options: NavigationRouteOptions,
): NavigationPolicy {
  const policy = resolveNavigationPolicy(options.mode)
  if (policy.kind === "none") return policy

  const deny = options.denyPathPrefixes ?? DEFAULT_DENY_PREFIXES

  if (policy.kind === "app-shell") {
    //SPA: no per-request render to preserve, so serving the shell for every
    //navigation is simply correct.
    registerRoute(
      new NavigationRoute(createHandlerBoundToURL(options.appShellUrl), {
        denylist: deny.map((prefix) => new RegExp(`^${prefix}`)),
      }),
    )
    return policy
  }

  //SSR: always hit the network; fall back to the precached shell only when the
  //network fails. NetworkOnly has no cache-write path at all — that absence is
  //the property that makes this safe, not a configuration choice that could be
  //flipped later.
  registerRoute(
    ({ request, url }) =>
      request.mode === "navigate" &&
      !deny.some((prefix) => url.pathname.startsWith(prefix)),
    new NetworkOnly({
      plugins: [
        new PrecacheFallbackPlugin({ fallbackURL: options.appShellUrl }),
      ],
    }),
  )
  return policy
}
