import {
  useCallback,
  useEffect,
  useState,
  useSyncExternalStore,
} from "react"
import type { KeepAwakeOutcome } from "#adaptv/capabilities/keep-awake"
import {
  getKeepAwakeCaveat,
  isKeepAwakeActive,
  isKeepAwakeSupported,
  releaseKeepAwake,
  requestKeepAwake,
  subscribeKeepAwake,
} from "#adaptv/capabilities/keep-awake"

export type UseKeepAwakeOptions = {
  /**
   * Hold the lock for as long as the component is mounted, releasing on
   * unmount. Leave it off and drive `request`/`release` yourself when the lock
   * should follow a user toggle rather than a screen.
   */
  enabled?: boolean
}

export type UseKeepAwakeResult = {
  /** Whether `navigator.wakeLock` exists here. */
  supported: boolean
  /** Whether the screen is being held on right now. */
  active: boolean
  /**
   * A way this can fail *while reporting success*, or `null`. Render it — it is
   * the one gap the return values cannot express, because the platform lies
   * (see the capability's docblock for the two known cases).
   */
  caveat: string | null
  /** Take the lock. Resolves to the outcome; never rejects. */
  request: () => Promise<KeepAwakeOutcome>
  /** Release it. */
  release: () => Promise<void>
  /** Outcome of the last request, or `null` before the first. */
  lastOutcome: KeepAwakeOutcome | null
}

const NEVER_CHANGES = () => () => {}
const FALSE_ON_SERVER = () => false

/**
 * Keep the screen awake, as a hook.
 *
 * `supported` **and** `caveat` are both returned because they answer different
 * questions: `supported: false` means the toggle should not exist, while a
 * non-null `caveat` means it should exist but come with a warning. Collapsing
 * them would hide the worse of the two failures — a wake lock that resolves and
 * then lets the screen dim anyway.
 */
export function useKeepAwake(
  options: UseKeepAwakeOptions = {},
): UseKeepAwakeResult {
  const { enabled = false } = options
  const supported = useSyncExternalStore(
    NEVER_CHANGES,
    isKeepAwakeSupported,
    FALSE_ON_SERVER,
  )
  const active = useSyncExternalStore(
    subscribeKeepAwake,
    isKeepAwakeActive,
    FALSE_ON_SERVER,
  )
  const [caveat, setCaveat] = useState<string | null>(null)
  const [lastOutcome, setLastOutcome] = useState<KeepAwakeOutcome | null>(
    null,
  )

  //the caveat depends on the UA, so it can only be read on the client
  useEffect(() => {
    setCaveat(getKeepAwakeCaveat())
  }, [])

  const request = useCallback(async () => {
    const outcome = await requestKeepAwake()
    setLastOutcome(outcome)
    return outcome
  }, [])

  const release = useCallback(() => releaseKeepAwake(), [])

  useEffect(() => {
    if (!enabled) return
    void requestKeepAwake().then(setLastOutcome)
    return () => {
      void releaseKeepAwake()
    }
  }, [enabled])

  return { supported, active, caveat, request, release, lastOutcome }
}
