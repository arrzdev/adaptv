import tryCatch from "@repo/shared/try-catch"
import type { ReactNode } from "react"
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react"
import {
  resetAppBootstrapReady,
  setAppBootstrapReady,
} from "@/data/app-bootstrap-ready"
import { seedInitialDataIfEmpty } from "@/data/seed"

//---- App store bootstrap ------------------------------------------
//synq owns persistence (IndexedDB) and inits lazily, so this provider only
//seeds first-run data and exposes a readiness/error gate for the shell.
//reactive reads go through synq's useCollection / useSingleton directly.

type AppDbContextValue = {
  isReady: boolean
  error: Error | null
  retry: () => void
}

const AppDbCtx = createContext<AppDbContextValue>({
  isReady: false,
  error: null,
  retry: () => {},
})

let initGeneration = 0

export function AppDbProvider({ children }: { children: ReactNode }) {
  const [isReady, setIsReady] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  const init = useCallback(() => {
    const generation = ++initGeneration

    setIsReady(false)
    setError(null)
    resetAppBootstrapReady()

    void (async () => {
      const [, seedError] = await tryCatch(() => seedInitialDataIfEmpty())
      //a superseded run (retry fired mid-flight) must not touch state
      if (generation !== initGeneration) return

      if (seedError) {
        setError(
          seedError instanceof Error
            ? seedError
            : new Error("Local store init failed"),
        )
        setIsReady(false)
      } else {
        setError(null)
        setIsReady(true)
      }

      setAppBootstrapReady()
    })()
  }, [])

  useEffect(() => {
    init()
  }, [init])

  const retry = useCallback(() => {
    init()
  }, [init])

  return (
    <AppDbCtx.Provider value={{ isReady, error, retry }}>
      {children}
    </AppDbCtx.Provider>
  )
}

export function useAppDb() {
  return useContext(AppDbCtx)
}
