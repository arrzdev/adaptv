import { createRouter } from "@tanstack/react-router"
import { standaloneMemoryHistory } from "#nativ/shell/standalone-history"

export type NativRouterOptions = {
  /** The generated route tree. The one genuinely app-specific input. */
  routeTree: unknown
  /** Use in-memory history when installed/standalone. */
  memoryHistoryInStandalone?: boolean
  /** Everything else is forwarded to `createRouter`. */
  options?: Record<string, unknown>
}

/**
 * Build the app router. **Framework code, not codegen.**
 *
 * The generated `router.gen.tsx` used to inline all of this into every app — the
 * `createRouter` call, the memory-history choice, the `notFoundMode` opinion —
 * even though the only app-specific input is the route tree and a bag of config
 * values. That is codegen used as a substitute for a function.
 *
 * Keeping it here means an opinion can be *changed* in the framework rather than
 * re-emitted into every consumer on their next build, and a consumer reading
 * their own `.nativ/` sees a call, not a copy of nativ's decisions.
 */
export function createNativRouter({
  routeTree,
  memoryHistoryInStandalone,
  options = {},
}: NativRouterOptions) {
  return createRouter({
    routeTree,
    //Memory history in standalone is opt-in: overriding router history is a real
    //behaviour change, so it must be asked for.
    ...(memoryHistoryInStandalone
      ? { history: standaloneMemoryHistory() }
      : {}),
    //nativ owns not-found — `notFoundScreen` renders at the root — so root mode
    //is the framework's opinion. Still overridable via router config.
    ...(("notFoundMode" in options
      ? {}
      : { notFoundMode: "root" }) as object),
    ...options,
    //The option bag is config-shaped (a plain record from nativ.config.ts), so
    //it cannot be statically matched against createRouter's deeply-generic
    //constructor type. The route tree carries the real typing, which is what
    //`Register` in the generated entry binds.
  } as never)
}
