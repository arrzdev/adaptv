import { useCallback, useSyncExternalStore } from "react"

/*
 * One live `MediaQueryList` per query for the whole app.
 *
 * `matchMedia` hands out a fresh list object on every call, and the previous
 * shape of this hook called it once per subscriber and again on every snapshot
 * read — so N components asking the same question meant N lists, N `change`
 * listeners and 4N calls. On the image lab page that was 16 lists for the
 * reduced-motion query alone. A list is live for as long as it is referenced,
 * so holding one per distinct query here and fanning its `change` out to the
 * subscribers is both cheaper and exactly as reactive.
 *
 * The registry belongs to one `window.matchMedia`: when that function is
 * replaced — a test stubbing it per case — the lists it handed out are stale,
 * and the registry starts over rather than answer from the old one.
 */
type Entry = {
  list: MediaQueryList
  listeners: Set<() => void>
}

let registry = new Map<string, Entry>()
let registryOwner: typeof window.matchMedia | null = null

function entryFor(query: string): Entry {
  const matchMedia = window.matchMedia
  if (registryOwner !== matchMedia) {
    registry = new Map()
    registryOwner = matchMedia
  }
  let entry = registry.get(query)
  if (!entry) {
    const listeners = new Set<() => void>()
    const list = window.matchMedia(query)
    list.addEventListener("change", () => {
      for (const listener of listeners) listener()
    })
    entry = { list, listeners }
    registry.set(query, entry)
  }
  return entry
}

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
      const { listeners } = entryFor(query)
      listeners.add(onStoreChange)
      return () => {
        listeners.delete(onStoreChange)
      }
    },
    [query],
  )

  const getSnapshot = useCallback(() => {
    if (query === null || typeof window === "undefined") return false
    return entryFor(query).list.matches
  }, [query])

  return useSyncExternalStore(subscribe, getSnapshot, () => false)
}
