import { useLocation } from "@tanstack/react-router"
import { useEffect, useRef } from "react"

const FPS_SAMPLE_MS = 333
const CONSECUTIVE_DROP_THRESHOLD = 2
//how long to keep sampling after the last activity signal before going idle
const IDLE_TIMEOUT_MS = 1000

export function useGlobalFpsSentinel({
  enabled = true,
  thresholdFps = 46,
}: {
  enabled?: boolean
  thresholdFps?: number
} = {}) {
  const { pathname } = useLocation()
  const pathnameRef = useRef(pathname)
  pathnameRef.current = pathname

  const frameCountRef = useRef(0)
  const lastTimeRef = useRef(performance.now())
  const consecutiveDropsRef = useRef(0)

  useEffect(() => {
    if (!enabled) return
    if (typeof window === "undefined") return

    frameCountRef.current = 0
    lastTimeRef.current = performance.now()
    consecutiveDropsRef.current = 0
    document.documentElement.removeAttribute("data-gpu-boost")

    const mountedPath = pathname
    let animationFrameId: number | null = null
    let idleTimerId: ReturnType<typeof setTimeout> | null = null
    let sampling = false

    function stopSampling() {
      sampling = false
      if (animationFrameId !== null) {
        cancelAnimationFrame(animationFrameId)
        animationFrameId = null
      }
    }

    function checkFps() {
      animationFrameId = null
      if (pathnameRef.current !== mountedPath) return stopSampling()

      const now = performance.now()
      frameCountRef.current++

      if (now >= lastTimeRef.current + FPS_SAMPLE_MS) {
        const currentFps = Math.round(
          (frameCountRef.current * 1000) / (now - lastTimeRef.current),
        )

        if (currentFps < thresholdFps) {
          consecutiveDropsRef.current++
          if (consecutiveDropsRef.current >= CONSECUTIVE_DROP_THRESHOLD) {
            document.documentElement.setAttribute("data-gpu-boost", "true")
          }
        } else {
          consecutiveDropsRef.current = 0
          document.documentElement.removeAttribute("data-gpu-boost")
        }

        frameCountRef.current = 0
        lastTimeRef.current = now
      }

      //keep chaining only while activity is keeping us awake
      if (sampling) animationFrameId = requestAnimationFrame(checkFps)
    }

    function wake() {
      if (document.visibilityState === "hidden") return

      //extend the active window on every activity signal
      if (idleTimerId !== null) clearTimeout(idleTimerId)
      idleTimerId = setTimeout(stopSampling, IDLE_TIMEOUT_MS)

      if (sampling) return
      sampling = true
      //reset the window so the resumed sample starts clean
      frameCountRef.current = 0
      lastTimeRef.current = performance.now()
      animationFrameId = requestAnimationFrame(checkFps)
    }

    function handleVisibility() {
      if (document.visibilityState === "hidden") {
        if (idleTimerId !== null) {
          clearTimeout(idleTimerId)
          idleTimerId = null
        }
        stopSampling()
        return
      }
      wake()
    }

    const activityEvents = [
      "pointerdown",
      "pointermove",
      "wheel",
      "scroll",
      "keydown",
      "touchmove",
    ] as const
    for (const type of activityEvents) {
      window.addEventListener(type, wake, { passive: true })
    }
    document.addEventListener("visibilitychange", handleVisibility)

    return () => {
      for (const type of activityEvents) {
        window.removeEventListener(type, wake)
      }
      document.removeEventListener("visibilitychange", handleVisibility)
      if (idleTimerId !== null) clearTimeout(idleTimerId)
      stopSampling()
      document.documentElement.removeAttribute("data-gpu-boost")
    }
  }, [pathname, thresholdFps, enabled])
}
