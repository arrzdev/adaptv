import { useCallback, useState } from "react"
import type {
  GeoCoords,
  GeoOptions,
  GeoPermission,
} from "#nativ/capabilities/geolocation"
import {
  checkGeoPermission,
  getCurrentPosition,
  requestGeoPermission,
} from "#nativ/capabilities/geolocation"

export type UseGeolocationResult = {
  coords: GeoCoords | null
  permission: GeoPermission
  error: Error | null
  loading: boolean
  /** Request permission (if needed) then read the position once. */
  locate: (options?: GeoOptions) => Promise<GeoCoords | null>
  /** Re-read the current permission without prompting. */
  refreshPermission: () => Promise<GeoPermission>
}

/**
 * Device location as a hook — same API on web, standalone PWA, and native. Web uses
 * `navigator.geolocation` (+ Permissions), native uses `@capacitor/geolocation`
 * (OS prompt). Call `locate()` from a user gesture.
 */
export function useGeolocation(): UseGeolocationResult {
  const [coords, setCoords] = useState<GeoCoords | null>(null)
  const [permission, setPermission] = useState<GeoPermission>("prompt")
  const [error, setError] = useState<Error | null>(null)
  const [loading, setLoading] = useState(false)

  const locate = useCallback(async (options?: GeoOptions) => {
    setLoading(true)
    setError(null)
    try {
      const perm = await requestGeoPermission()
      setPermission(perm)
      if (perm !== "granted") {
        throw new Error("Location permission not granted")
      }
      const next = await getCurrentPosition(options)
      setCoords(next)
      return next
    } catch (cause) {
      setError(
        cause instanceof Error ? cause : new Error("Location failed"),
      )
      return null
    } finally {
      setLoading(false)
    }
  }, [])

  const refreshPermission = useCallback(async () => {
    const perm = await checkGeoPermission()
    setPermission(perm)
    return perm
  }, [])

  return { coords, permission, error, loading, locate, refreshPermission }
}
