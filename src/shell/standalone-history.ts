import type { RouterHistory } from "@tanstack/react-router"
import { createMemoryHistory } from "@tanstack/react-router"
import { isInstalledApp } from "#adaptv/utils/platform"

/**
 * The history `standaloneMemoryHistory` returns: the router's own, under adaptv's
 * name. An interface rather than an alias, so a hover prints this name.
 * → docs/decisions/facade-and-opacity.md §1
 */
export interface AdaptvHistory extends RouterHistory {}

/**
 * History for `createRouter`: in-memory when installed (standalone PWA **or** a
 * native Capacitor build) so the OS edge-swipe / hardware back is inert — no entry
 * to navigate away to — and `undefined` in a browser tab so `createRouter` keeps
 * its default browser history. On native the app owns back via the hardware-back
 * handler.
 *
 * Opt in by passing it as `history`. To disable, just don't pass it — `history` is
 * optional and defaults to browser history everywhere.
 *
 * @example
 * ```ts
 * createRouter({ routeTree, history: standaloneMemoryHistory() })
 * ```
 */
export function standaloneMemoryHistory(): AdaptvHistory | undefined {
  if (!isInstalledApp()) return undefined
  return createMemoryHistory({
    initialEntries: [window.location.pathname + window.location.search],
  })
}
