import tryCatch from "@repo/shared/try-catch"
import { useCallback, useRef, useState } from "react"

//localStorage-backed view preference — read synchronously on mount so the first
//paint already reflects the stored choice (no flash of the default view). The
//app never needs these in the URL: shareability isn't a goal, and surviving a
//reload is exactly what localStorage gives us. `parse` validates the stored raw
//string (stale/garbage falls back); `format` returning null clears the key, so
//"default" values stay out of storage.
export function usePersistentState<T>(
  key: string,
  fallback: T,
  parse: (raw: string) => T | null,
  format: (value: T) => string | null,
): readonly [T, (next: T) => void] {
  const [value, setValue] = useState<T>(() => {
    if (typeof window === "undefined") return fallback
    const [raw] = tryCatch(() => localStorage.getItem(key))
    if (raw == null) return fallback
    return parse(raw) ?? fallback
  })

  //callers pass an inline `format`, so its identity churns every render; read it
  //through a ref so `set` stays stable (deps = [key]) without going stale
  const formatRef = useRef(format)
  formatRef.current = format

  const set = useCallback(
    (next: T) => {
      setValue(next)
      if (typeof window === "undefined") return
      const serialized = formatRef.current(next)
      tryCatch(() =>
        serialized == null
          ? localStorage.removeItem(key)
          : localStorage.setItem(key, serialized),
      )
    },
    [key],
  )

  return [value, set] as const
}
