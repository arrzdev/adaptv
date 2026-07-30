//Share accessor — the OS share sheet, one call on every target:
//  • native   → @capacitor/share (UIActivityViewController / Android chooser)
//  • web/PWA  → Web Share API (navigator.share / navigator.canShare)
//
//Sharing needs no permission, so this does NOT use geolocation's four-state
//enum — it uses the boolean probe from CAPABILITY-SURFACE §3.2, and it needs
//TWO of them, because the Web Share API gates on two independent things:
//
//  • {@link isShareSupported} — is there a share sheet here at all? `false` on
//    desktop Chrome and on every Firefox; `true` on Safari, iOS/Android web,
//    and every native build.
//  • {@link canShareTarget}   — will THIS payload go through it? A browser with
//    `navigator.share` still refuses file payloads it has no handler for.
//
//A caller that only checks the first one ships a share button that throws on
//desktop Chrome; a caller that only checks the second ships one that silently
//does nothing. Both are the failure this capability exists to make visible.
import { Share } from "@capacitor/share"
import { isNativePlatform } from "#adaptv/utils/platform"

export type ShareTarget = {
  title?: string
  text?: string
  url?: string
  /**
   * Web/PWA only. `@capacitor/share` takes file **URIs** (`string[]`), not
   * `File` objects, and a `File` read out of a WebView has no on-disk URI to
   * hand the native chooser. So a payload with files is reported as
   * un-shareable on native rather than silently dropping them —
   * {@link canShareTarget} returns `false` and {@link share} returns
   * `"unsupported"`.
   */
  files?: File[]
  /** Native iOS only: the sheet's title. Ignored on Android and on web. */
  dialogTitle?: string
}

/**
 * What happened. `"unsupported"` and `"dismissed"` are both ordinary outcomes,
 * not errors — {@link share} never rejects for either.
 */
export type ShareOutcome = "shared" | "dismissed" | "unsupported"

/** Strip the native-only / web-only fields down to a Web Share payload. */
function toWebPayload(target: ShareTarget): ShareData {
  const payload: ShareData = {}
  if (target.title !== undefined) payload.title = target.title
  if (target.text !== undefined) payload.text = target.text
  if (target.url !== undefined) payload.url = target.url
  if (target.files?.length) payload.files = target.files
  return payload
}

/**
 * Whether a share sheet exists on this target at all. Synchronous on purpose:
 * this is what lets a share button be *absent* from the first render instead of
 * disappearing a frame later.
 *
 * Native answers `true` without a bridge hop. `Share.canShare()` exists, but on
 * iOS and Android it only ever reports what `isNativePlatform()` already told
 * us, and paying an async round-trip to learn nothing would force every caller
 * into a loading state for a button label.
 */
export function isShareSupported(): boolean {
  if (isNativePlatform()) return true
  if (typeof navigator === "undefined") return false
  return typeof navigator.share === "function"
}

/**
 * Whether this specific payload can be shared here. Always check this too when
 * the payload carries `files` — `navigator.canShare` is the only thing that
 * knows whether the browser has a handler for them.
 */
export function canShareTarget(target: ShareTarget): boolean {
  if (!isShareSupported()) return false
  //native: no File→URI path (see ShareTarget.files)
  if (isNativePlatform()) return !target.files?.length
  if (typeof navigator.canShare !== "function") {
    //Web Share level 1 — `share` without `canShare`. Text/URL payloads are the
    //only thing level 1 accepts, so files are the one certain "no".
    return !target.files?.length
  }
  try {
    return navigator.canShare(toWebPayload(target))
  } catch {
    //spec says "return false", but older WebKit throws TypeError on a payload
    //shape it doesn't recognise — same answer either way
    return false
  }
}

/** A user-cancelled native share, which the iOS plugin reports as a rejection. */
function isNativeDismissal(cause: unknown): boolean {
  const message = cause instanceof Error ? cause.message : String(cause)
  return /cancel/i.test(message)
}

/**
 * Open the share sheet. Resolves to what happened; never rejects for an
 * unsupported target or a user dismissal — those are the two things a caller
 * has to render UI for, so they are values, not exceptions.
 *
 * It DOES reject for a genuine caller error, and there is one that matters:
 * `navigator.share` throws `NotAllowedError` when it is not called from a real
 * user gesture (an `await` before the call is enough to lose the activation).
 * Swallowing that would turn a fixable bug into a share button that mysteriously
 * does nothing on web.
 */
export async function share(target: ShareTarget): Promise<ShareOutcome> {
  if (!isShareSupported()) return "unsupported"
  if (!canShareTarget(target)) return "unsupported"

  if (isNativePlatform()) {
    try {
      await Share.share({
        title: target.title,
        text: target.text,
        url: target.url,
        dialogTitle: target.dialogTitle,
      })
      return "shared"
    } catch (cause) {
      //iOS rejects with "Share canceled" when the sheet is dismissed; Android's
      //chooser resolves normally, so this branch is iOS-shaped
      if (isNativeDismissal(cause)) return "dismissed"
      throw cause
    }
  }

  try {
    await navigator.share(toWebPayload(target))
    return "shared"
  } catch (cause) {
    //every browser reports a dismissed sheet as AbortError
    if (cause instanceof Error && cause.name === "AbortError") {
      return "dismissed"
    }
    throw cause
  }
}
