//Geolocation accessor — the exemplar for every permission-gated device API:
//  • native → @capacitor/geolocation (triggers the OS permission prompt)
//  • web/PWA → navigator.permissions + navigator.geolocation
//Both normalise to one shape so callers never branch on platform.
import { Geolocation } from "@capacitor/geolocation"
import { isNativePlatform } from "#adaptv/utils/platform"

export type GeoCoords = {
  latitude: number
  longitude: number
  accuracy: number
}
/**
 * Permission state, normalised across platforms.
 *
 * `"unavailable"` is NOT a permission — it means the capability cannot be used at
 * all right now, so prompting is pointless. Callers must branch on it separately:
 * `"denied"` sends the user to APP settings, `"unavailable"` to SYSTEM settings
 * (or nowhere, if the platform simply lacks the API).
 *
 * Every permission-gated capability in adaptv uses this four-state shape.
 */
export type GeoPermission = "granted" | "denied" | "prompt" | "unavailable"

export type GeoOptions = {
  highAccuracy?: boolean
  timeoutMs?: number
}

function normalize(state: string): GeoPermission {
  if (state === "granted") return "granted"
  if (state === "denied") return "denied"
  //android also reports "prompt-with-rationale" — still "you may ask"
  return "prompt"
}

/** Web only: can we ask at all? Absent API ⇒ prompting cannot help. */
function webGeolocationPresent(): boolean {
  return typeof navigator !== "undefined" && !!navigator.geolocation
}

/**
 * Current permission without prompting. Never rejects — an accessor that throws
 * forces every caller into a try/catch, which is exactly the per-platform burden
 * adaptv exists to absorb (doctrine §0.2).
 */
export async function checkGeoPermission(): Promise<GeoPermission> {
  if (isNativePlatform()) {
    try {
      const status = await Geolocation.checkPermissions()
      return normalize(status.location)
    } catch {
      //@capacitor/geolocation THROWS here when system location services are
      //switched off — a device state, not a permission state. Surface it.
      return "unavailable"
    }
  }
  if (!webGeolocationPresent()) return "unavailable"
  if (!navigator.permissions) {
    //can request but not query (older Safari/Firefox) ⇒ "you may ask"
    return "prompt"
  }
  try {
    const status = await navigator.permissions.query({
      name: "geolocation" as PermissionName,
    })
    return normalize(status.state)
  } catch {
    //query unsupported for this name — asking still works
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
 * request API, so a `getCurrentPosition` call raises the browser prompt, and a
 * failed read re-reads the resolved state. A refusal on a browser without the
 * Permissions API answers `"denied"`, since a re-read there can only say
 * `"prompt"`.
 */
export async function requestGeoPermission(): Promise<GeoPermission> {
  if (isNativePlatform()) {
    try {
      const status = await Geolocation.requestPermissions()
      return normalize(status.location)
    } catch {
      //same device-level failure as checkGeoPermission — prompting cannot help
      return "unavailable"
    }
  }
  if (!webGeolocationPresent()) return "unavailable"
  try {
    await getCurrentPosition()
    return "granted"
  } catch (err) {
    //the read rejects with the browser's GeolocationPositionError. Code 1 is
    //PERMISSION_DENIED, but Chromium also uses it for a dismissed prompt, so
    //only a browser that cannot query the state (Safari before 16) takes it as
    //the answer; everywhere else, and for a timeout or no fix, re-read it
    const refused =
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      err.code === 1
    if (refused && !navigator.permissions) return "denied"
    return checkGeoPermission()
  }
}
