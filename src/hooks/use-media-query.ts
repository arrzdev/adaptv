import { useCallback, useSyncExternalStore } from "react"

/**
 * Reactive `matchMedia` boolean. SSR-safe: returns `false` on the server and
 * during hydration, then syncs to the live match on mount and tracks changes
 * for the lifetime of the component. Pass `null` to disable (always `false`)
 * without breaking hook order.
 */
export function useMediaQuery(query: string | null): boolean {
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      if (query === null || typeof window === "undefined")
        return () => undefined
      const mql = window.matchMedia(query)
      mql.addEventListener("change", onStoreChange)
      return () => mql.removeEventListener("change", onStoreChange)
    },
    [query],
  )

  const getSnapshot = useCallback(() => {
    if (query === null || typeof window === "undefined") return false
    return window.matchMedia(query).matches
  }, [query])

  return useSyncExternalStore(subscribe, getSnapshot, () => false)
}
