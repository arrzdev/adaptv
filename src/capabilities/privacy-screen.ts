//Privacy screen — keep the app's content out of the app switcher and, where the
//OS allows it, out of screenshots and recordings. ONE mechanism per native OS,
//both behind `@capacitor/privacy-screen`, and an honest `unsupported` everywhere
//else: no browser exposes a way to keep a page out of a capture, so the web and
//the installed PWA answer that plainly rather than pretending.
//
//## What each OS can actually do
//
//Android sets `FLAG_SECURE` on the window: screenshots and screen recordings of
//the app come back black, and the recents card does not show the app's content
//(what it shows instead is the launcher's call — measured on the emulator it is
//the launch screen / window background, not a blank card). iOS has no such flag —
//a screenshot taken while the app is in front captures it, and nothing in the
//SDK prevents that — so the plugin does the one thing iOS allows: it presents a
//cover (a blur, or the launch screen) the moment the app resigns active, which is
//what the switcher and the OS's own overlays show. The caveat string says which
//of the two this target is, because "enabled" means different things on them
//and a consumer that promises screenshot blocking on iOS is lying to its users.
//
//## The guard
//
//The plugin's native code is in the binary only when the binary was built after
//the dependency landed; an OTA bundle can arrive on an older install. So the
//question is `hasNativePlugin("PrivacyScreen")` — the binary's own header — not
//"is this native". A binary without it reads unsupported and the caveat says why.
import { PrivacyScreen } from "@capacitor/privacy-screen"
import { hasNativePlugin } from "#adaptv/utils/native-plugins"
import { isIOS, isNativePlatform } from "#adaptv/utils/platform"

/**
 * `"available"` — this binary carries the plugin, so enabling does something.
 * `"unsupported"` — the web, the PWA, the server, or a binary built before the
 * plugin; enabling resolves `"unsupported"` and changes nothing.
 */
export type PrivacyScreenSupport = "available" | "unsupported"

/**
 * `"applied"` — the OS took the change.
 * `"unsupported"` — nothing here can take it.
 * `"failed"` — the plugin answered but reported no success, or rejected.
 */
export type PrivacyScreenOutcome = "applied" | "unsupported" | "failed"

/**
 * What the switcher shows while the app is covered. `"splash"` is the launch
 * screen, the OS's own idea of "the app, not its content": on iOS that is
 * adaptv's launch storyboard, a flat fill of the app's splash colour with no
 * image (the CLI deletes the native template's splash art, which the plugin
 * would otherwise show by name). `"obscure"` blurs the app on iOS, following the
 * colour scheme, and dims it on Android.
 */
export type PrivacyScreenCover = "splash" | "obscure"

export interface PrivacyScreenOptions {
  /** @default "splash" */
  cover?: PrivacyScreenCover
}

function nativePlugin(): boolean {
  return isNativePlatform() && hasNativePlugin("PrivacyScreen")
}

/** Whether enabling the privacy screen on this target does anything. Synchronous: it reads the binary's plugin header. */
export function getPrivacyScreenSupport(): PrivacyScreenSupport {
  return nativePlugin() ? "available" : "unsupported"
}

/**
 * One sentence on what "enabled" means here, for the settings row that offers
 * it. Distinct per OS because the guarantees are: Android blocks the capture,
 * iOS only covers the switcher.
 */
export function getPrivacyScreenCaveat(): string {
  if (!nativePlugin()) {
    return isNativePlatform()
      ? "This binary was built before the privacy screen plugin; a rebuild carries it."
      : "No browser exposes a way to keep a page out of a screenshot or a recording; this page is as capturable as any other."
  }
  return isIOS()
    ? "iOS covers the app in the switcher and under the system's own overlays, and exposes no way to block a screenshot: one taken while the app is in front captures it."
    : "Android sets FLAG_SECURE: screenshots and screen recordings of the app come back black, and the recents card does not show the app's content."
}

function darkScheme(): boolean {
  return (
    typeof matchMedia === "function" &&
    matchMedia("(prefers-color-scheme: dark)").matches
  )
}

/** The plugin's per-OS config for one cover word. */
function pluginConfig(cover: PrivacyScreenCover) {
  return cover === "obscure"
    ? {
        ios: {
          blurEffect: darkScheme()
            ? ("dark" as const)
            : ("light" as const),
        },
        android: { dimBackground: true },
      }
    : {
        ios: { blurEffect: "none" as const },
        android: { dimBackground: false },
      }
}

/** Turn the privacy screen on. Resolves the outcome; never rejects. */
export async function enablePrivacyScreen({
  cover = "splash",
}: PrivacyScreenOptions = {}): Promise<PrivacyScreenOutcome> {
  if (!nativePlugin()) return "unsupported"
  try {
    const { success } = await PrivacyScreen.enable(pluginConfig(cover))
    return success ? "applied" : "failed"
  } catch {
    return "failed"
  }
}

/** Turn the privacy screen off. Resolves the outcome; never rejects. */
export async function disablePrivacyScreen(): Promise<PrivacyScreenOutcome> {
  if (!nativePlugin()) return "unsupported"
  try {
    const { success } = await PrivacyScreen.disable()
    return success ? "applied" : "failed"
  } catch {
    return "failed"
  }
}

/**
 * Whether the privacy screen is on right now, asked of the OS. `null` where
 * there is nothing to ask, and on a plugin that rejected: a missing answer, not
 * a `false` that would read as "off".
 */
export async function readPrivacyScreen(): Promise<boolean | null> {
  if (!nativePlugin()) return null
  try {
    const { enabled } = await PrivacyScreen.isEnabled()
    return typeof enabled === "boolean" ? enabled : null
  } catch {
    return null
  }
}
