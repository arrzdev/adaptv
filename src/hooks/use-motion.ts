import { useCallback, useEffect, useState } from "react"
import type {
  MotionSample,
  MotionStatus,
} from "#adaptv/capabilities/motion"
import {
  getMotionStatus,
  requestMotionPermission,
  subscribeMotion,
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
   * event where there is no sensor.
   */
  silent: boolean
  /** Ask, from a gesture; resolves the new status and updates the hook. */
  request: () => Promise<MotionStatus>
}

/**
 * Accelerometer and gyroscope samples, with the permission step and the
 * no-sensor case named. `status` is `unsupported` on the server and stays so
 * until the client reads the real engine after hydration.
 */
export function useMotion(
  options: UseMotionOptions = {},
): UseMotionResult {
  const {
    enabled = true,
    throttleMs = 100,
    silentAfterMs = 1500,
  } = options
  const [status, setStatus] = useState<MotionStatus>("unsupported")
  const [sample, setSample] = useState<MotionSample | null>(null)
  const [silent, setSilent] = useState(false)

  useEffect(() => {
    setStatus(getMotionStatus())
  }, [])

  useEffect(() => {
    if (!enabled || status !== "granted") {
      setSilent(false)
      return
    }
    let timer: ReturnType<typeof setTimeout> | null = setTimeout(
      () => setSilent(true),
      silentAfterMs,
    )
    const off = subscribeMotion(
      (next) => {
        if (timer) {
          clearTimeout(timer)
          timer = null
        }
        setSilent(false)
        setSample(next)
      },
      { throttleMs },
    )
    return () => {
      if (timer) clearTimeout(timer)
      off()
    }
  }, [enabled, status, throttleMs, silentAfterMs])

  const request = useCallback(async () => {
    const next = await requestMotionPermission()
    setStatus(next)
    return next
  }, [])

  return { status, sample, silent, request }
}
