import { useCallback, useEffect, useState } from "react"
import { store, subscribeStore } from "#adaptv/storage/store"

export type StoreValue<T> = {
  data: T | undefined
  isLoading: boolean
  /** Write a new value. Every `useStore` watching the key re-renders with it. */
  set: (value: T) => Promise<void>
}

/**
 * Reactive read of a `storage.store` key.
 *
 * Unlike `useKv`, this **has** a loading state, and that is inherent rather than
 * an oversight: the backing store is asynchronous, so there is genuinely a moment
 * before the value is known. A hook that hid it would have to either block render
 * or lie with a default — both worse than saying so.
 *
 * Like `useKv`, it follows the key: a write from anywhere in this page — another
 * component, or `store.set` outside React — re-renders it. Other tabs are not
 * observed.
 *
 * Use `storage.kv` when a value must be readable *during* render (flags,
 * settings). Use this for large or structured values where a frame of loading is
 * acceptable.
 */
export function useStore<T>(key: string): StoreValue<T> {
  const [data, setData] = useState<T | undefined>(undefined)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    let latest = 0
    setIsLoading(true)
    const load = () => {
      const read = ++latest
      void store.get<T>(key).then((value) => {
        //a key change mid-flight would otherwise write the OLD key's value into
        //state, which reads as random data appearing under the wrong key
        if (cancelled) return
        //and only the newest read may land: the mount's read goes to the
        //database, while a re-read after a write is answered from memory, so an
        //older read can settle last and put the old value back
        if (read !== latest) return
        setData(value)
        setIsLoading(false)
      })
    }
    load()
    const unsubscribe = subscribeStore(key, load)
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [key])

  const set = useCallback((value: T) => store.set(key, value), [key])

  return { data, isLoading, set }
}
