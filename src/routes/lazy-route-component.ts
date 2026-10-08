import type { ComponentType } from "react"
import { createElement, use } from "react"

/**
 * The `lazyRouteComponent` TanStack's code-splitter writes into every split route of the
 * app. `tanstack-resolve.ts` serves the app this one in place of the router's own.
 *
 * A route whose chunk is gone (the deploy moved on under an open tab) reloads the page
 * once, guarded by a `tanstack_router_reload:` sessionStorage key so a chunk that is
 * really missing does not loop. The decision is LATCHED when the import fails: every
 * render after it suspends until the reload lands.
 *
 * react-router 1.170.19 moved the decision into the render: the first render sets the key
 * and reloads, and the next one, before the page has gone, finds the key set and throws
 * the import error to the route's error boundary. React renders a suspended route more
 * than once, so the app's error screen drew over the reload, and `stale-chunk.spec.ts`
 * failed on both engines. That release is also the first with the fix for
 * TanStack/router#7759 (a preload reading a match a navigation had just evicted), so
 * adaptv keeps the router and owns this one function, as 1.170.18 shipped it.
 */
export function lazyRouteComponent<
  TModule extends Record<string, unknown>,
  TKey extends keyof TModule = "default",
>(importer: () => Promise<TModule>, exportName?: TKey) {
  let loadPromise: Promise<void> | undefined
  let comp: ComponentType<object> | undefined
  let error: unknown
  let reload = false

  const load = () => {
    if (!loadPromise)
      loadPromise = importer()
        .then((res) => {
          loadPromise = undefined
          comp = res[exportName ?? "default"] as ComponentType<object>
        })
        .catch((err: unknown) => {
          error = err
          if (
            isModuleNotFoundError(err) &&
            typeof window !== "undefined" &&
            typeof sessionStorage !== "undefined"
          ) {
            const storageKey = `tanstack_router_reload:${err.message}`
            if (!sessionStorage.getItem(storageKey)) {
              sessionStorage.setItem(storageKey, "1")
              reload = true
            }
          }
        })
    return loadPromise
  }

  const lazyComp = function Lazy(props: object) {
    if (reload) {
      window.location.reload()
      throw new Promise(() => {})
    }
    if (error) throw error
    if (!comp) use(load())
    return createElement(comp as ComponentType<object>, props)
  }
  lazyComp.preload = load
  return lazyComp
}

//router-core's `isModuleNotFoundError`, copied: router-core is not adaptv's dependency.
//The three engines' messages for a dynamic import that failed to fetch.
function isModuleNotFoundError(error: unknown): error is Error {
  if (!(error instanceof Error)) return false
  return (
    error.message.startsWith(
      "Failed to fetch dynamically imported module",
    ) ||
    error.message.startsWith(
      "error loading dynamically imported module",
    ) ||
    error.message.startsWith("Importing a module script failed")
  )
}
