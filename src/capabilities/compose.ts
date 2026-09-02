//Compose accessor — hand a mail or SMS draft to the OS composer. ONE mechanism
//for all six targets: the `mailto:` and `sms:` URL schemes, which every OS
//routes to its own composer with no permission and no plugin of their own.
//What differs is how the URL is built, how it is opened, and whether anything
//is there to open it.
//
//## Why this is not `openExternal`
//
//`openExternal` hands a URL to the in-app browser on native, and
//SFSafariViewController refuses every scheme but http and https, so a `mailto:`
//fell through to `window.open` inside the WebView and did whatever the WebView
//felt like. The composer path is `UIApplication.open` / `Intent.ACTION_VIEW`,
//which is what `@capacitor/app-launcher` wraps, and it can also ask first:
//`canOpenUrl` is the OS saying whether a handler is registered. The iOS
//simulator has no Mail app, and a device can have none either; the app
//renders that gap instead of a button that does nothing.
//
//## The separator trap
//
//The SMS body goes after `&` on iOS and after `?` everywhere else. iOS Safari
//and the iOS WebView both want `sms:+1555&body=…`; Android and desktop
//browsers want `sms:+1555?body=…`. One shape, keyed on the platform.
import { AppLauncher } from "@capacitor/app-launcher"
import { hasNativePlugin } from "#adaptv/utils/native-plugins"
import { isIOS, isNativePlatform } from "#adaptv/utils/platform"

export type ComposeKind = "mail" | "sms"

/**
 * `"available"` — the OS reports a handler for the scheme.
 * `"no-handler"` — the OS reports none; the button should say so.
 * `"unknown"` — nothing can be asked: the web, or a binary without the plugin.
 */
export type ComposeSupport = "available" | "no-handler" | "unknown"

/**
 * `"opened"` — the composer was handed the draft.
 * `"no-handler"` — the OS reported that nothing took the draft.
 * `"failed"` — the open itself rejected.
 */
export type ComposeOutcome = "opened" | "no-handler" | "failed"

export interface MailDraft {
  to?: readonly string[]
  cc?: readonly string[]
  bcc?: readonly string[]
  subject?: string
  body?: string
}

export interface SmsDraft {
  to?: readonly string[]
  body?: string
}

function query(
  pairs: ReadonlyArray<readonly [string, string | undefined]>,
) {
  const parts: string[] = []
  for (const [key, value] of pairs) {
    if (value === undefined || value === "") continue
    parts.push(`${key}=${encodeURIComponent(value)}`)
  }
  return parts.join("&")
}

/** The `mailto:` URL for a draft, recipients comma-joined, values encoded. */
export function mailUrl(draft: MailDraft): string {
  const q = query([
    ["cc", draft.cc?.join(",")],
    ["bcc", draft.bcc?.join(",")],
    ["subject", draft.subject],
    ["body", draft.body],
  ])
  return `mailto:${draft.to?.join(",") ?? ""}${q ? `?${q}` : ""}`
}

/** The `sms:` URL for a draft; the body separator is `&` on iOS, `?` elsewhere. */
export function smsUrl(draft: SmsDraft): string {
  const body = draft.body ? `body=${encodeURIComponent(draft.body)}` : ""
  const sep = isIOS() ? "&" : "?"
  return `sms:${draft.to?.join(",") ?? ""}${body ? `${sep}${body}` : ""}`
}

//A representative URL per kind: the OS answers `canOpenURL` for a full URL,
//and an empty `mailto:` is not one every version treats the same way.
const PROBE_URL: Record<ComposeKind, string> = {
  mail: "mailto:probe@example.com",
  sms: "sms:0",
}

function nativeLauncher(): boolean {
  return isNativePlatform() && hasNativePlugin("AppLauncher")
}

/**
 * Whether the OS has a handler for the kind. `unknown` on the web and on a
 * binary that predates the plugin; never rejects. Truthful only where the
 * OS lets the app see the handler: Android 11+ hides one unless the manifest
 * declares the scheme, which adaptv's native shell does for `mailto` and
 * `sms` (measured on the Pixel 10 emulator: false for both before the
 * `<queries>` block, true after, while `openUrl` opened the composer either
 * way); iOS answers for these system schemes without a declaration (measured
 * on the iOS 26 simulator: `sms` available, `mailto` no-handler because the
 * simulator ships no Mail). A label for the button, never a gate on the open.
 */
export async function getComposeSupport(
  kind: ComposeKind,
): Promise<ComposeSupport> {
  if (!nativeLauncher()) return "unknown"
  try {
    const { value } = await AppLauncher.canOpenUrl({
      url: PROBE_URL[kind],
    })
    return value ? "available" : "no-handler"
  } catch {
    return "unknown"
  }
}

async function open(url: string): Promise<ComposeOutcome> {
  if (nativeLauncher()) {
    //Open without asking: `canOpenUrl` is filtered by package visibility on
    //Android 11+, and a binary whose manifest does not declare the scheme
    //answers false for a composer that opens fine. The OS reports an open
    //that found nothing as not completed.
    try {
      const { completed } = await AppLauncher.openUrl({ url })
      return completed ? "opened" : "no-handler"
    } catch {
      return "failed"
    }
  }
  if (typeof window === "undefined") return "failed"
  //`_self`: the browser hands the scheme to the OS without leaving the page,
  //where `_blank` leaves a blank tab behind on desktop engines.
  window.open(url, "_self")
  return "opened"
}

/** Open the mail composer with the draft. Resolves the outcome; never rejects. */
export function composeMail(draft: MailDraft): Promise<ComposeOutcome> {
  return open(mailUrl(draft))
}

/** Open the SMS composer with the draft. Resolves the outcome; never rejects. */
export function composeSms(draft: SmsDraft): Promise<ComposeOutcome> {
  return open(smsUrl(draft))
}
