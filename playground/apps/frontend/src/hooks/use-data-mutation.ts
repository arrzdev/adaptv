import tryCatch from "@repo/shared/try-catch"
import { useCallback, useState } from "react"

//---- useDataMutation ----------------------------------------------
//the DRY home for the "run a data mutation, surface its error/pending" wrapper
//that pages used to re-implement. mutations here are OPTIMISTIC LOCAL writes
//(synq), so this is intentionally NOT TanStack's useMutation — there's no server
//cache/retry to manage, just the run + error + pending a form or action needs.
//`run` resolves to `true` on success so a caller can close its drawer on it.

export type DataMutation = {
  run: (
    mutate: () => Promise<unknown>,
    fallbackMessage: string,
  ) => Promise<boolean>
  error: Error | null
  isPending: boolean
  reset: () => void
}

export function useDataMutation(): DataMutation {
  const [error, setError] = useState<Error | null>(null)
  const [isPending, setIsPending] = useState(false)

  const run = useCallback(
    async (mutate: () => Promise<unknown>, fallbackMessage: string) => {
      setError(null)
      setIsPending(true)
      const [, mutationError] = await tryCatch(mutate)
      setIsPending(false)
      if (mutationError) {
        //surface a stable, one-line message so a drawer's error slot can keep a
        //fixed height (no layout shift); the raw write error rides along as the
        //cause for logging
        setError(new Error(fallbackMessage, { cause: mutationError }))
        return false
      }
      return true
    },
    [],
  )

  const reset = useCallback(() => setError(null), [])

  return { run, error, isPending, reset }
}
