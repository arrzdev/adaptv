import { useCallback, useMemo, useSyncExternalStore } from "react"
import { kv, subscribeKv } from "#nativ/storage/kv"

/**
 * Reactive `storage.kv` binding — `useState` for a persisted value.
 *
 * ```tsx
 * const [onboarded, setOnboarded] = useKv("onboarded", false)
 * ```
 *
 * Reads are synchronous, so there is no loading state and no boot gate — that is
 * the whole reason `kv` is the sync tier. Updates propagate to every component
 * watching the key, and to other tabs.
 */
export function useKv<T>(
  key: string,
  fallback: T,
): [T, (value: T) => void] {
  const subscribe = useCallback(
    (listener: () => void) => subscribeKv(key, listener),
    [key],
  )

  //`getSnapshot` must return a referentially stable value or
  //useSyncExternalStore re-renders forever. `kv.get` reads the already-parsed
  //value straight out of the map, so identity holds between calls — the fallback
  //is deliberately NOT passed here, because an object literal default would be a
  //new reference on every read and reintroduce exactly that loop.
  const stored = useSyncExternalStore(
    subscribe,
    () => kv.get<T>(key),
    () => undefined,
  )

  //applied outside the snapshot, memoised so an object fallback stays stable
  const value = useMemo(
    () => (stored === undefined ? fallback : stored),
    [stored, fallback],
  )

  const set = useCallback((next: T) => kv.set(key, next), [key])

  return [value, set]
}
