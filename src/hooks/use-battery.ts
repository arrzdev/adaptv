import { useSyncExternalStore } from "react"
import type { BatteryState } from "#adaptv/capabilities/battery"
import {
  getBatteryState,
  subscribeBattery,
} from "#adaptv/capabilities/battery"

/**
 * The battery, as a snapshot that re-renders when it moves: a fraction and a
 * charging flag under `ok`, `unknown` where the platform has an API and no
 * number (the iOS simulator), `unsupported` where there is no API (WebKit and
 * Firefox on the web, and the server).
 *
 * Backed by `@capacitor/device` on native, re-read on resume and every minute
 * while mounted, and by `navigator.getBattery` and its events on Chromium.
 * The server snapshot is `unsupported`, so nothing battery-shaped is ever in
 * the HTML; the client replaces it after hydration.
 */
export function useBattery(): BatteryState {
  return useSyncExternalStore(
    subscribeBattery,
    getBatteryState,
    serverSnapshot,
  )
}

const SERVER: BatteryState = {
  status: "unsupported",
  level: null,
  charging: null,
}
function serverSnapshot(): BatteryState {
  return SERVER
}
