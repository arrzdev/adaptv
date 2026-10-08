import { useHaptics as useBaseHaptics } from "adaptv/hooks"
import { useMemo } from "react"
import { useSettings } from "@/data/collections/preferences/settings"

type Haptics = ReturnType<typeof useBaseHaptics>

//App-scoped haptics: the framework's unified `useHaptics()`, gated by the user's
//`settings.haptics` preference. Same imperative API — `impact` / `notify` /
//`selection` / `isSupported` — call it inside a real gesture handler
//(onClick / onPress / onChange), never from an effect or render.
export function useHaptics(): Haptics {
  const { settings } = useSettings()
  const base = useBaseHaptics()

  return useMemo((): Haptics => {
    if (settings.haptics) return base

    //preference off: firing is a no-op; `isSupported` still answers honestly
    return {
      impact: () => {},
      notify: () => {},
      selection: () => {},
      isSupported: base.isSupported,
    }
  }, [base, settings.haptics])
}
