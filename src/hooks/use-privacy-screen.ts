import { useCallback, useEffect, useState } from "react"
import type {
  PrivacyScreenOptions,
  PrivacyScreenOutcome,
  PrivacyScreenSupport,
} from "#adaptv/capabilities/privacy-screen"
import {
  disablePrivacyScreen as disableNow,
  enablePrivacyScreen as enableNow,
  getPrivacyScreenCaveat,
  getPrivacyScreenSupport,
  readPrivacyScreen,
} from "#adaptv/capabilities/privacy-screen"

export type UsePrivacyScreenResult = {
  /** Whether this binary can take it; `null` on the server and until the client has read the header. */
  support: PrivacyScreenSupport | null
  /** Whether it is on right now, as the OS last answered; `null` where nothing can be asked. */
  enabled: boolean | null
  /** One sentence on what "enabled" means on this target; empty until `support` is known. */
  caveat: string
  /** Turn it on. Resolves the outcome; never rejects. */
  enable: (options?: PrivacyScreenOptions) => Promise<PrivacyScreenOutcome>
  /** Turn it off. Resolves the outcome; never rejects. */
  disable: () => Promise<PrivacyScreenOutcome>
  /** Outcome of the most recent enable or disable, or `null` before the first. */
  last: PrivacyScreenOutcome | null
}

/**
 * The privacy screen, as a hook. `support` is read in an effect rather than
 * during render — the answer comes off the binary's plugin header, which the
 * server does not have, and a row that hydrates from `unsupported` to
 * `available` is a mismatch — so it reads `null` until the client has looked.
 * `enabled` is the OS's own answer, re-read after any outcome that was not
 * `applied`, because a failed call leaves the true state unknown.
 */
export function usePrivacyScreen(): UsePrivacyScreenResult {
  const [support, setSupport] = useState<PrivacyScreenSupport | null>(null)
  const [caveat, setCaveat] = useState("")
  const [enabled, setEnabled] = useState<boolean | null>(null)
  const [last, setLast] = useState<PrivacyScreenOutcome | null>(null)

  useEffect(() => {
    let live = true
    setSupport(getPrivacyScreenSupport())
    setCaveat(getPrivacyScreenCaveat())
    void readPrivacyScreen().then((on) => {
      if (live) setEnabled(on)
    })
    return () => {
      live = false
    }
  }, [])

  const settle = useCallback(
    async (outcome: PrivacyScreenOutcome, intended: boolean) => {
      setLast(outcome)
      if (outcome === "applied") setEnabled(intended)
      else setEnabled(await readPrivacyScreen())
      return outcome
    },
    [],
  )

  const enable = useCallback(
    async (options?: PrivacyScreenOptions) =>
      settle(await enableNow(options), true),
    [settle],
  )
  const disable = useCallback(
    async () => settle(await disableNow(), false),
    [settle],
  )

  return { support, enabled, caveat, enable, disable, last }
}
