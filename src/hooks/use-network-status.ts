import { useSyncExternalStore } from "react"
import { getOnline, subscribeOnline } from "#adaptv/capabilities/network"

/**
 * Reactive network reachability — `true` when online. Backed by the connectivity
 * accessor: `@capacitor/network` on a native build, `navigator.onLine` + events on
 * web/PWA. Optimistically `true` during SSR / before hydration. The web signal is
 * coarse (a network interface, not real reachability); native is accurate.
 */
export function useNetworkStatus(): boolean {
  return useSyncExternalStore(subscribeOnline, getOnline, () => true)
}
