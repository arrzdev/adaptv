//Battery — the charge level and whether the device is charging, on every target,
//with an honest third answer for "the API is there and has no number":
//  • native → @capacitor/device `getBatteryInfo`, a one-shot read with no event. The
//             snapshot is re-read when the app returns to the foreground and on a
//             60 s timer while anything is subscribed; a battery moves about a
//             percent every few minutes, so that is the whole event story.
//  • web    → `navigator.getBattery` and its BatteryManager events (`levelchange`,
//             `chargingchange`). Chromium only: WebKit never shipped it and Firefox
//             removed it, so those report unsupported rather than a stale guess.
//  • server → unsupported.
//
//Verified 2026-09-02: the iOS simulator answers `batteryLevel: -1` (UIDevice has no
//battery to monitor), which is why `unknown` exists as a status and not as a `-1`
//leaking into a progress bar. A desktop Chromium with no battery answers level 1,
//charging true — a real BatteryManager, and reported as such.
//
//Exposed as a subscribe/get pair (not just a hook) on the network capability's
//pattern, so a data layer or a logger can read it without React.
import { Device } from "@capacitor/device"
import { onResume } from "#adaptv/capabilities/app-state"
import { isNativePlatform } from "#adaptv/utils/platform"

/**
 * `ok` carries numbers; `unknown` means the platform has a battery API and gave
 * no usable level (the iOS simulator, or a native read that has not returned
 * yet); `unsupported` means there is no battery API on this target at all.
 */
export type BatteryStatus = "ok" | "unknown" | "unsupported"

export type BatteryState = {
  status: BatteryStatus
  /** Charge as a fraction, 0 to 1; null unless `status` is `ok`. */
  level: number | null
  /** Plugged in and taking charge; null when the platform cannot say. */
  charging: boolean | null
}

/** How often a subscribed native app re-reads the plugin while foregrounded. */
export const BATTERY_POLL_MS = 60_000

const UNSUPPORTED: BatteryState = {
  status: "unsupported",
  level: null,
  charging: null,
}
const UNKNOWN: BatteryState = {
  status: "unknown",
  level: null,
  charging: null,
}

type BatteryManagerLike = {
  level: number
  charging: boolean
  addEventListener: (type: string, listener: () => void) => void
  removeEventListener: (type: string, listener: () => void) => void
}
type NavigatorWithBattery = Navigator & {
  getBattery?: () => Promise<BatteryManagerLike>
}

const listeners = new Set<() => void>()
let snapshot: BatteryState | null = null
let webManager: BatteryManagerLike | null = null
let webBinding: Promise<void> | null = null
let nativeBound = false
let nativeTimer: ReturnType<typeof setInterval> | null = null
let nativeResume: (() => void) | null = null

function webApi(): NavigatorWithBattery["getBattery"] | null {
  if (typeof navigator === "undefined") return null
  const fn = (navigator as NavigatorWithBattery).getBattery
  return typeof fn === "function" ? fn.bind(navigator) : null
}

function toState(level: unknown, charging: unknown): BatteryState {
  const n = typeof level === "number" ? level : Number.NaN
  const ok = Number.isFinite(n) && n >= 0 && n <= 1
  return {
    status: ok ? "ok" : "unknown",
    level: ok ? n : null,
    charging: typeof charging === "boolean" ? charging : null,
  }
}

/** Replace the snapshot only when a value moved, so a store sees one object per change. */
function commit(next: BatteryState): BatteryState {
  const prev = snapshot
  if (
    prev &&
    prev.status === next.status &&
    prev.level === next.level &&
    prev.charging === next.charging
  )
    return prev
  snapshot = next
  for (const cb of listeners) cb()
  return next
}

function readWeb(): void {
  if (!webManager) return
  commit(toState(webManager.level, webManager.charging))
}

async function readNative(): Promise<BatteryState> {
  try {
    const info = await Device.getBatteryInfo()
    return commit(toState(info.batteryLevel, info.isCharging))
  } catch {
    return commit(UNKNOWN)
  }
}

function bindWeb(): void {
  if (webBinding) return
  const api = webApi()
  if (!api) {
    commit(UNSUPPORTED)
    return
  }
  webBinding = api()
    .then((manager) => {
      webManager = manager
      manager.addEventListener("levelchange", readWeb)
      manager.addEventListener("chargingchange", readWeb)
      readWeb()
    })
    .catch(() => {
      //Chromium rejects in some sandboxed documents; that is "no API" to a consumer
      commit(UNSUPPORTED)
    })
}

function bindNative(): void {
  if (nativeBound) return
  nativeBound = true
  void readNative()
  nativeResume = onResume(() => void readNative())
  nativeTimer = setInterval(() => void readNative(), BATTERY_POLL_MS)
}

function unbindNative(): void {
  if (!nativeBound) return
  nativeBound = false
  nativeResume?.()
  nativeResume = null
  if (nativeTimer) clearInterval(nativeTimer)
  nativeTimer = null
}

/**
 * The current snapshot. Stable between changes, so it can back
 * `useSyncExternalStore`. Before any subscriber or read: `unsupported` where
 * there is no API, `unknown` where there is one and it has not answered.
 */
export function getBatteryState(): BatteryState {
  if (snapshot) return snapshot
  if (typeof window === "undefined") return UNSUPPORTED
  if (isNativePlatform()) return UNKNOWN
  return webApi() ? UNKNOWN : UNSUPPORTED
}

/** One read, resolved with the new snapshot. On the web this also binds the manager. */
export async function readBattery(): Promise<BatteryState> {
  if (typeof window === "undefined") return UNSUPPORTED
  if (isNativePlatform()) return readNative()
  bindWeb()
  await webBinding
  return getBatteryState()
}

/**
 * Subscribe to changes; returns an unsubscribe. SSR-safe (no-op on the server).
 * The web manager stays bound for the life of the page, as its events are free;
 * the native timer and resume hook go away with the last subscriber.
 */
export function subscribeBattery(cb: () => void): () => void {
  if (typeof window === "undefined") return () => {}
  listeners.add(cb)
  if (isNativePlatform()) bindNative()
  else bindWeb()
  return () => {
    listeners.delete(cb)
    if (listeners.size === 0) unbindNative()
  }
}

/** Test seam: drop the snapshot and every binding, as a fresh page would have. */
export function resetBattery(): void {
  unbindNative()
  if (webManager) {
    webManager.removeEventListener("levelchange", readWeb)
    webManager.removeEventListener("chargingchange", readWeb)
  }
  webManager = null
  webBinding = null
  snapshot = null
  listeners.clear()
}
