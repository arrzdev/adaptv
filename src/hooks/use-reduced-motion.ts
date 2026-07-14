import { useEffect, useState } from "react"

const MQL_QUERY = "(prefers-reduced-motion: reduce)"

// Returns a reactive boolean that tracks the `prefers-reduced-motion` media
// query. Subscribes to changes for the lifetime of the component — no polling.
// Starts false on server and during hydration, then syncs on mount.
export function useReducedMotion(): boolean {
  const [reducedMotion, setReducedMotion] = useState(false)

  useEffect(() => {
    if (typeof window === "undefined") return

    const mql = window.matchMedia(MQL_QUERY)
    setReducedMotion(mql.matches)

    function handleChange(e: MediaQueryListEvent) {
      setReducedMotion(e.matches)
    }

    mql.addEventListener("change", handleChange)
    return () => mql.removeEventListener("change", handleChange)
  }, [])

  return reducedMotion
}
