//Geolocation accessor — the exemplar for every permission-gated device API:
//  • native → @capacitor/geolocation (triggers the OS permission prompt)
//  • web/PWA → navigator.permissions + navigator.geolocation
//Both normalise to one shape so callers never branch on platform.
import { Geolocation } from "@capacitor/geolocation"
import { isNativePlatform } from "#nativ/utils/platform"

export type GeoCoords = {
  latitude: number
  longitude: number
  accuracy: number
}
export type GeoPermission = "granted" | "denied" | "prompt"

export type GeoOptions = {
  highAccuracy?: boolean
  timeoutMs?: number
}

function normalize(state: string): GeoPermission {
  if (state === "granted") return "granted"
  if (state === "denied") return "denied"
  return "prompt"
}

/** Current permission without prompting. */
export async function checkGeoPermission(): Promise<GeoPermission> {
  if (isNativePlatform()) {
    const status = await Geolocation.checkPermissions()
    return normalize(status.location)
  }
  if (typeof navigator === "undefined" || !navigator.permissions) {
    return "prompt"
  }
  try {
    const status = await navigator.permissions.query({
      name: "geolocation" as PermissionName,
    })
    return normalize(status.state)
  } catch {
    return "prompt"
  }
}

/** Read the device position once, normalised. Rejects on error / no permission. */
export function getCurrentPosition(
  options?: GeoOptions,
): Promise<GeoCoords> {
  const enableHighAccuracy = options?.highAccuracy ?? false
  const timeout = options?.timeoutMs ?? 10_000
  if (isNativePlatform()) {
    return Geolocation.getCurrentPosition({
      enableHighAccuracy,
      timeout,
    }).then((p) => ({
      latitude: p.coords.latitude,
      longitude: p.coords.longitude,
      accuracy: p.coords.accuracy,
    }))
  }
  return new Promise<GeoCoords>((resolve, reject) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      reject(new Error("Geolocation unavailable"))
      return
    }
    navigator.geolocation.getCurrentPosition(
      (p) =>
        resolve({
          latitude: p.coords.latitude,
          longitude: p.coords.longitude,
          accuracy: p.coords.accuracy,
        }),
      (err) => reject(err),
      { enableHighAccuracy, timeout },
    )
  })
}

/**
 * Ask for permission. Native shows the OS dialog directly; web has no explicit
 * request API, so a `getCurrentPosition` call raises the browser prompt, then we
 * re-read the resolved state.
 */
export async function requestGeoPermission(): Promise<GeoPermission> {
  if (isNativePlatform()) {
    const status = await Geolocation.requestPermissions()
    return normalize(status.location)
  }
  try {
    await getCurrentPosition()
    return "granted"
  } catch {
    return checkGeoPermission()
  }
}
