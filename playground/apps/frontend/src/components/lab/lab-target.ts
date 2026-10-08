import { getOS, isNativePlatform, isStandaloneDisplay } from "adaptv/utils"
import { useEffect, useState } from "react"

/**
 * The four surfaces a page is walked on by hand.
 *
 * Coarser than {@link TargetStrip}'s label on purpose: the strip says
 * `standalone PWA · ios` so a screenshot identifies itself exactly, while this
 * is the axis every expectation table is written against. An installed PWA is
 * ONE target whichever OS it is installed on — the thing that changes the answer
 * is the shell (no Capacitor bridge, display-mode standalone), not the vendor.
 */
export type LabTarget = "web" | "pwa" | "ios" | "android"

/** Table order. Widest reach first, most-capable last. */
export const LAB_TARGETS = ["web", "pwa", "ios", "android"] as const

export const LAB_TARGET_LABEL: Record<LabTarget, string> = {
  web: "browser tab",
  pwa: "installed PWA",
  ios: "iOS native",
  android: "Android native",
}

/** Client-only — every input is a `window` read. */
export function resolveLabTarget(): LabTarget {
  if (isNativePlatform()) return getOS() === "ios" ? "ios" : "android"
  return isStandaloneDisplay() ? "pwa" : "web"
}

/**
 * Which target is this, or `null` before mount.
 *
 * `null` is rendered rather than guessed: the server has no platform, and a
 * table that highlights the wrong row for one frame is worse than one that
 * highlights nothing.
 */
export function useLabTarget(): LabTarget | null {
  const [target, setTarget] = useState<LabTarget | null>(null)
  useEffect(() => setTarget(resolveLabTarget()), [])
  return target
}
