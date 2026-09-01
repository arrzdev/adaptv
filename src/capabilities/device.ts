//Device info accessor — what hardware/OS am I on:
//  • native   → @capacitor/device (the real record: model, manufacturer, …)
//  • web/PWA  → navigator.userAgentData + the UA string (much less, honestly so)
//
//## Relationship to `utils/platform`
//
//`utils/platform` stays the answer to "which of the six targets am I?" — it is
//synchronous, imports nothing, and every render-time branch in adaptv keys off
//it. This capability does NOT re-detect any of that: `platform` and `os` below
//are literally `resolvePlatformTag()` and `getOS()`. What it adds is the part
//that needs a plugin or a UA parse — model, manufacturer, OS version, whether
//this is a simulator.
//
//## Why this is a memoised async read and not exported constants
//
//`docs/research/capability-surface.md` §3.4 records Expo's rule — constants for what cannot change
//during the process lifetime, functions for what can — and `expo-device` ships
//`Device.modelName` as a plain constant. adaptv cannot: Capacitor's bridge has
//no synchronous path, so the value simply does not exist at module-evaluation
//time. {@link getDeviceInfo} is the rule kept in spirit — it resolves once and
//caches forever, because none of it can change — while {@link getLanguageTag},
//which the user CAN change from Settings, is a plain call that re-reads.
import { Device } from "@capacitor/device"
import type { PlatformOS, PlatformTag } from "#adaptv/utils/platform"
import {
  getOS,
  getOSVersion,
  isNativePlatform,
  resolvePlatformTag,
} from "#adaptv/utils/platform"

/**
 * One normalised record across all six targets. Every field a given platform
 * cannot answer is `null` rather than `""` or `"unknown"` — a caller rendering
 * a device sheet needs to tell "this platform won't say" apart from "the value
 * is empty", and only `null` does that.
 */
export type DeviceInfo = {
  /** Runtime tag — browser tab / installed PWA / native shell. */
  platform: PlatformTag
  os: PlatformOS
  /** `"18.4"`, `"14"`. `null` on desktop and anywhere the UA has no version. */
  osVersion: string | null
  /** `"iPhone15,2"`, `"Pixel 8"`. On web only Android Chromium reports it (a high-entropy UA hint); `null` everywhere else. */
  model: string | null
  /** `"Apple"`, `"Google"`. `null` on web. */
  manufacturer: string | null
  /**
   * `true` in a simulator/emulator, `false` on real hardware, `null` when the
   * platform cannot tell you — which is always, on web.
   */
  isVirtual: boolean | null
  /** Native: the WebView build. Web: the browser engine version. */
  webViewVersion: string | null
}

/** Chromium-only client hints. Absent in every WebKit and Gecko build. */
type UserAgentData = {
  platform?: string
  getHighEntropyValues?: (
    hints: string[],
  ) => Promise<{ platformVersion?: string; model?: string }>
}

function userAgentData(): UserAgentData | undefined {
  if (typeof navigator === "undefined") return undefined
  return (navigator as { userAgentData?: UserAgentData }).userAgentData
}

/** Browser engine version — the closest web analogue of `webViewVersion`. */
function webEngineVersion(): string | null {
  if (typeof navigator === "undefined") return null
  const ua = navigator.userAgent
  //Chrome must be matched before Safari: every Chromium UA also says "Safari"
  const match =
    ua.match(/(?:Chrome|CriOS)\/(\d+(?:\.\d+)*)/) ??
    ua.match(/Version\/(\d+(?:\.\d+)*).*Safari/) ??
    ua.match(/Firefox\/(\d+(?:\.\d+)*)/)
  return match ? match[1] : null
}

async function readWebDeviceInfo(): Promise<DeviceInfo> {
  const hints = userAgentData()
  let platformVersion: string | null = null
  let model: string | null = null
  if (typeof hints?.getHighEntropyValues === "function") {
    try {
      const high = await hints.getHighEntropyValues([
        "platformVersion",
        "model",
      ])
      platformVersion = high.platformVersion || null
      //Android Chromium fills this in; desktop Chromium returns ""
      model = high.model || null
    } catch {
      //the user agent may refuse high-entropy hints (privacy settings, or a
      //Permissions-Policy on the document) — the UA string still has a version
    }
  }
  return {
    platform: resolvePlatformTag(),
    os: getOS(),
    osVersion: getOSVersion() ?? platformVersion,
    model,
    //no browser exposes a manufacturer, and inferring one from the UA would be
    //a guess dressed up as a fact
    manufacturer: null,
    isVirtual: null,
    webViewVersion: webEngineVersion(),
  }
}

async function readNativeDeviceInfo(): Promise<DeviceInfo> {
  const info = await Device.getInfo()
  return {
    platform: resolvePlatformTag(),
    os: getOS(),
    osVersion: info.osVersion || null,
    model: info.model || null,
    manufacturer: info.manufacturer || null,
    isVirtual: info.isVirtual,
    webViewVersion: info.webViewVersion || null,
  }
}

let cached: Promise<DeviceInfo> | null = null

/**
 * The immutable device record. Resolves once per process and caches — none of
 * it can change while the app is running, so a second caller pays nothing.
 * Never rejects: a missing plugin degrades to the web record, which is at worst
 * `platform`/`os` (both always knowable) plus nulls.
 */
export function getDeviceInfo(): Promise<DeviceInfo> {
  if (cached) return cached
  cached = (
    isNativePlatform() ? readNativeDeviceInfo() : readWebDeviceInfo()
  ).catch(readWebDeviceInfo)
  return cached
}

/** Test seam — drops the memoised record so the next read re-branches. */
export function resetDeviceInfo(): void {
  cached = null
}

/**
 * A stable per-install identifier, or `null` on web.
 *
 * `null` is the whole point. `@capacitor/device` has a real one (iOS
 * `identifierForVendor`, an Android UUID kept in app storage); a browser has
 * nothing equivalent, and the only way to manufacture one is to fingerprint the
 * user. adaptv will not, so the web tier reports the gap and lets the app
 * decide (a random id in `storage.kv` is usually the right answer, and it is
 * the app's decision to make, not the framework's).
 */
export async function getDeviceId(): Promise<string | null> {
  if (!isNativePlatform()) return null
  try {
    const { identifier } = await Device.getId()
    return identifier || null
  } catch {
    return null
  }
}

/**
 * Current BCP-47 language tag (`"en-GB"`). A function, not part of
 * {@link DeviceInfo}, because the user can change it in Settings and come back
 * — §3.4's mutable half.
 *
 * Synchronous, and reads `navigator.language` on native too: a Capacitor
 * WebView inherits the OS locale, so `Device.getLanguageTag()` returns the same
 * string one bridge hop later. Reach for the plugin directly only if you need
 * its exact normalisation.
 */
export function getLanguageTag(): string {
  if (typeof navigator === "undefined") return "en"
  return navigator.language || "en"
}
