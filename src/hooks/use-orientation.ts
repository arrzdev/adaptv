import { useCallback, useState, useSyncExternalStore } from "react"
import type {
  OrientationLockOutcome,
  ScreenOrientationLock,
  ScreenOrientationType,
} from "#adaptv/capabilities/orientation"
import {
  getScreenOrientation,
  isOrientationLockSupported,
  lockScreenOrientation,
  subscribeScreenOrientation,
  unlockScreenOrientation,
} from "#adaptv/capabilities/orientation"

export type UseOrientationResult = {
  /** Live orientation. Reading always works, on every target. */
  orientation: ScreenOrientationType
  /** Coarse axis, for the common case where primary/secondary doesn't matter. */
  isPortrait: boolean
  /**
   * Whether a lock can even be attempted. **`false` on all of iOS** — WebKit
   * has never shipped `screen.orientation.lock()`. Render `OrientationGuard`
   * (or your own rotate prompt) instead of a lock button when this is `false`.
   */
  lockSupported: boolean
  /** Hold the screen in an orientation. Resolves to the outcome; never rejects. */
  lock: (lock: ScreenOrientationLock) => Promise<OrientationLockOutcome>
  /** Release the lock. Resolves to the outcome; never rejects. */
  unlock: () => Promise<OrientationLockOutcome>
  /** Outcome of the last lock/unlock, or `null` before the first attempt. */
  lastOutcome: OrientationLockOutcome | null
}

const NEVER_CHANGES = () => () => {}
const NOT_SUPPORTED_ON_SERVER = () => false
//SSR has no screen; portrait is the safe assumption on a phone-first framework
const SERVER_ORIENTATION = (): ScreenOrientationType => "portrait-primary"

/**
 * Screen orientation as a hook: read + subscribe + lock + unlock.
 *
 * The reason this returns an object rather than just the orientation string is
 * `lockSupported`. Locking is the half that doesn't exist everywhere, and an
 * app that calls `lock()` and assumes it took is broken on every iPhone — so
 * the gap is a field, not a silent failure.
 */
export function useOrientation(): UseOrientationResult {
  const orientation = useSyncExternalStore(
    subscribeScreenOrientation,
    getScreenOrientation,
    SERVER_ORIENTATION,
  )
  const lockSupported = useSyncExternalStore(
    NEVER_CHANGES,
    isOrientationLockSupported,
    NOT_SUPPORTED_ON_SERVER,
  )
  const [lastOutcome, setLastOutcome] =
    useState<OrientationLockOutcome | null>(null)

  const lock = useCallback(async (next: ScreenOrientationLock) => {
    const outcome = await lockScreenOrientation(next)
    setLastOutcome(outcome)
    return outcome
  }, [])

  const unlock = useCallback(async () => {
    const outcome = await unlockScreenOrientation()
    setLastOutcome(outcome)
    return outcome
  }, [])

  return {
    orientation,
    isPortrait: orientation.startsWith("portrait"),
    lockSupported,
    lock,
    unlock,
    lastOutcome,
  }
}
