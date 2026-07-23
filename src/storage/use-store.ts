import { useCallback, useEffect, useState } from "react"
import { store } from "#adaptv/storage/store"

export type StoreValue<T> = {
  data: T | undefined
  isLoading: boolean
  /** Write a new value and update this hook's state. */
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
 * Use `storage.kv` when a value must be readable *during* render (flags,
 * settings). Use this for large or structured values where a frame of loading is
 * acceptable.
 */
export function useStore<T>(key: string): StoreValue<T> {
  const [data, setData] = useState<T | undefined>(undefined)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setIsLoading(true)
    void store.get<T>(key).then((value) => {
      //a key change mid-flight would otherwise write the OLD key's value into
      //state, which reads as random data appearing under the wrong key
      if (cancelled) return
      setData(value)
      setIsLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [key])

  const set = useCallback(
    async (value: T) => {
      await store.set(key, value)
      setData(value)
    },
    [key],
  )

  return { data, isLoading, set }
}
