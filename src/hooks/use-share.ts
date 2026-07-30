import { useCallback, useState, useSyncExternalStore } from "react"
import type { ShareOutcome, ShareTarget } from "#adaptv/capabilities/share"
import {
  canShareTarget,
  isShareSupported,
  share as shareTarget,
} from "#adaptv/capabilities/share"

export type UseShareResult = {
  /** Whether a share sheet exists here. `false` on desktop Chrome/Firefox. */
  supported: boolean
  /** Whether a specific payload would go through — check this for file shares. */
  canShare: (target: ShareTarget) => boolean
  /**
   * Open the sheet. Resolves to the outcome, or `null` when the attempt threw —
   * in which case {@link UseShareResult.error} holds why.
   */
  share: (target: ShareTarget) => Promise<ShareOutcome | null>
  /** The last outcome, or `null` before the first attempt. */
  outcome: ShareOutcome | null
  /** True while the sheet is open. */
  sharing: boolean
  /** A genuine failure — e.g. `navigator.share` called outside a user gesture. */
  error: Error | null
}

//support is fixed for the life of the process, so there is nothing to subscribe
//to — but it must still be read through useSyncExternalStore rather than during
//render, so SSR gets `false` and the client corrects it without a hydration
//mismatch (the server has no `navigator` to ask)
const NEVER_CHANGES = () => () => {}
const NOT_SUPPORTED_ON_SERVER = () => false

/**
 * The OS share sheet as a hook.
 *
 * Returns an object, not a bare `share` function, because `supported` is the
 * half that matters: on desktop Chrome and every Firefox there is no share
 * sheet, and an app that renders the button anyway ships a control that does
 * nothing. Branch on `supported` to hide or replace it.
 */
export function useShare(): UseShareResult {
  const supported = useSyncExternalStore(
    NEVER_CHANGES,
    isShareSupported,
    NOT_SUPPORTED_ON_SERVER,
  )
  const [outcome, setOutcome] = useState<ShareOutcome | null>(null)
  const [sharing, setSharing] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  const share = useCallback(async (target: ShareTarget) => {
    setSharing(true)
    setError(null)
    try {
      const next = await shareTarget(target)
      setOutcome(next)
      return next
    } catch (cause) {
      //the accessor only rejects for a real caller error (no user gesture);
      //surface it as state rather than making every call site try/catch
      setError(cause instanceof Error ? cause : new Error("Share failed"))
      setOutcome(null)
      return null
    } finally {
      setSharing(false)
    }
  }, [])

  return {
    supported,
    canShare: canShareTarget,
    share,
    outcome,
    sharing,
    error,
  }
}
