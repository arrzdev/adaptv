import {
  useCallback,
  useEffect,
  useState,
  useSyncExternalStore,
} from "react"
import type {
  MotionSample,
  MotionStatus,
} from "#adaptv/capabilities/motion"
import {
  getMotionStatus,
  requestMotionPermission,
  subscribeMotion,
  subscribeMotionStatus,
} from "#adaptv/capabilities/motion"

export type UseMotionOptions = {
  /** Subscribe at all; false keeps the listener off (and the battery cool). */
  enabled?: boolean
  /** At most one re-render per this many ms; 0 renders every event. Default 100. */
  throttleMs?: number
  /** Report `silent` after this many ms without a usable sample. Default 1500. */
  silentAfterMs?: number
}

export type UseMotionResult = {
  status: MotionStatus
  /** The latest sample; null before the first. */
  sample: MotionSample | null
  /**
   * Granted, subscribed, and nothing readable has arrived within
   * `silentAfterMs`. A desktop, the iOS simulator, a device with the sensor
   * off. Decided on usable samples, not events: Chromium fires one all-null
   * event where there is no sensor. The window re-arms after every sample
   * (plus `throttleMs`, the gap the throttle itself withholds), so samples
   * that stop arriving read as silent again.
   */
  silent: boolean
  /** Ask, from a gesture; resolves the new status and updates every hook. */
  request: () => Promise<MotionStatus>
}

const UNSUPPORTED_ON_SERVER = (): MotionStatus => "unsupported"

/**
 * Accelerometer and gyroscope samples, with the permission step and the
 * no-sensor case named. `status` is `unsupported` on the server; the client
 * reads the engine from its first render, and every instance shares the one
 * permission answer.
 */
export function useMotion(
  options: UseMotionOptions = {},
): UseMotionResult {
  const {
    enabled = true,
    throttleMs = 100,
    silentAfterMs = 1500,
  } = options
  const status = useSyncExternalStore(
    subscribeMotionStatus,
    getMotionStatus,
    UNSUPPORTED_ON_SERVER,
  )
  const [sample, setSample] = useState<MotionSample | null>(null)
  const [silent, setSilent] = useState(false)

  useEffect(() => {
    if (!enabled || status !== "granted") {
      setSilent(false)
      return
    }
    let timer = setTimeout(() => setSilent(true), silentAfterMs)
    const off = subscribeMotion(
      (next) => {
        clearTimeout(timer)
        timer = setTimeout(
          () => setSilent(true),
          throttleMs + silentAfterMs,
        )
        setSilent(false)
        setSample(next)
      },
      { throttleMs },
    )
    return () => {
      clearTimeout(timer)
      off()
    }
  }, [enabled, status, throttleMs, silentAfterMs])

  const request = useCallback(() => requestMotionPermission(), [])

  return { status, sample, silent, request }
}
