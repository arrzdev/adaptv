import { useSyncExternalStore } from "react"
import { getOnline, subscribeOnline } from "#adaptv/capabilities/network"

/**
 * Connectivity, phrased the way UI code asks the question.
 *
 * One of exactly **two** obligations adaptv takes on for the offline story — the
 * other is shipping an `Offline` component. adaptv owns connectivity *truth*; it
 * never decides when to render offline UI, because that depends on a data layer
 * adaptv deliberately does not assume. → `docs/design/rendering.md §3.1.1`
 *
 * Backed by the accessor pair, so it is accurate on every target:
 * `@capacitor/network` on native when the binary carries it, `navigator.onLine` +
 * `online`/`offline` events on web and on a binary without it. Optimistically `false` (online) during SSR and before hydration.
 *
 * ## ⚠︎ `isOffline` alone is a poor test, in both directions
 *
 * - **Offline with a warm cache should render normally.** Blocking the UI because
 *   the radio is off, when you already have the data, is a self-inflicted outage.
 * - **Online-but-the-request-failed usually wants the same UI as offline.** The
 *   user cannot tell the difference and does not care.
 *
 * The better question is *"do I have anything to show?"*, however the app's data
 * layer expresses it. `docs/guides/cookbook.md §1` has the worked example — with TanStack
 * Query, `fetchStatus === "paused"` is a far more precise signal, and it recovers
 * automatically on reconnect.
 *
 * Use this hook for what it actually answers: a connectivity *indicator*, a
 * disabled submit button, a "you're offline" banner over otherwise-live content.
 */
export function useIsOffline(): boolean {
  return useSyncExternalStore(
    subscribeOnline,
    () => !getOnline(),
    //server snapshot: assume online. Rendering an offline screen into SSR HTML
    //would be wrong for every user and would flash on hydration.
    () => false,
  )
}
