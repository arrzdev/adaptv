//Clipboard accessor — copy and paste, one call on every target:
//  • native   → @capacitor/clipboard (UIPasteboard / ClipboardManager)
//  • web/PWA  → navigator.clipboard
//
//## Read and write are NOT the same capability, and flattening them is a lie
//
//Writing is ungated almost everywhere: the browser treats "the user pressed a
//button and something got copied" as harmless. **Reading is a permission** —
//the clipboard can hold a password the user copied out of a password manager.
//The two therefore get two different probes and two different shapes:
//
//  • write → a boolean probe ({@link isClipboardWriteSupported}), no permission
//  • read  → the four-state permission enum ({@link ClipboardPermission}),
//            exactly as `geolocation.ts` defines it
//
//And the read permission itself is not uniform: Chromium implements
//`navigator.permissions.query({ name: "clipboard-read" })`, while Safari and
//Firefox do not know the name at all and instead gate each read behind a user
//gesture (Safari additionally shows its own Paste button). A `query` that
//throws therefore means "you may ask", not "denied" — the same distinction
//geolocation draws for browsers without the Permissions API.
import { Clipboard } from "@capacitor/clipboard"
import { hasNativePlugin } from "#adaptv/utils/native-plugins"
import { isNativePlatform } from "#adaptv/utils/platform"

/** The four-state shape from `geolocation.ts`. Read only — writing is ungated. */
export type ClipboardPermission =
  | "granted"
  | "denied"
  | "prompt"
  | "unavailable"

/**
 * Outcome of a clipboard operation. `"denied"` means the platform refused
 * (no user gesture, unfocused document, permission withheld) — retryable from a
 * real gesture. `"unsupported"` means there is no clipboard API here at all.
 */
export type ClipboardStatus = "ok" | "denied" | "unsupported"

export type ClipboardRead = {
  status: ClipboardStatus
  /** The clipboard's text, or `null` for any status other than `"ok"`. */
  text: string | null
}

function normalize(state: string): ClipboardPermission {
  if (state === "granted") return "granted"
  if (state === "denied") return "denied"
  return "prompt"
}

/**
 * Whether the call goes through the native plugin. Every native branch below
 * asks THIS rather than `isNativePlatform()`: an OTA bundle can be running on a
 * binary that predates the plugin. Each caller then falls through to the web
 * path instead of reporting "unsupported" — an Android WebView on a secure
 * origin has a real `navigator.clipboard`. → `LIFECYCLE.md §5.6`
 */
function viaPlugin(): boolean {
  return isNativePlatform() && hasNativePlugin("Clipboard")
}

/**
 * Whether text can be copied here.
 *
 * `navigator.clipboard` is undefined on an **insecure origin** — which is not
 * an edge case in this repo: the playground is reached over a plain-http LAN
 * URL from a phone. The legacy `document.execCommand("copy")` path still works
 * there, so an insecure origin is not "unsupported", and {@link
 * writeClipboardText} falls back to it.
 */
export function isClipboardWriteSupported(): boolean {
  if (viaPlugin()) return true
  if (typeof navigator === "undefined") return false
  if (typeof navigator.clipboard?.writeText === "function") return true
  return (
    typeof document !== "undefined" &&
    typeof document.execCommand === "function"
  )
}

/**
 * Whether the clipboard can be READ here. There is no legacy fallback:
 * `execCommand("paste")` was never allowed from script in any shipping browser,
 * so a missing `navigator.clipboard.readText` is a hard no.
 */
export function isClipboardReadSupported(): boolean {
  if (viaPlugin()) return true
  if (typeof navigator === "undefined") return false
  return typeof navigator.clipboard?.readText === "function"
}

/**
 * Current read permission, without prompting. Never rejects.
 *
 * Native is `"granted"`: iOS and Android hand the pasteboard to the app's own
 * process with no permission gate. (iOS shows a *system* paste banner on first
 * read, which is OS chrome and not something the app can query.)
 */
export async function checkClipboardReadPermission(): Promise<ClipboardPermission> {
  if (viaPlugin()) return "granted"
  if (!isClipboardReadSupported()) return "unavailable"
  if (!navigator.permissions) return "prompt"
  try {
    const status = await navigator.permissions.query({
      name: "clipboard-read" as PermissionName,
    })
    return normalize(status.state)
  } catch {
    //Safari/Firefox don't know the "clipboard-read" name and throw. Reading
    //still works from a user gesture, so this is "you may ask", not "denied".
    return "prompt"
  }
}

/** The insecure-origin / pre-async-clipboard copy path. Returns whether it took. */
function writeViaExecCommand(text: string): boolean {
  if (typeof document === "undefined") return false
  try {
    const field = document.createElement("textarea")
    field.value = text
    field.setAttribute("readonly", "")
    //off-screen rather than hidden: a `display:none` field cannot be selected,
    //and iOS scrolls to a focused field that is merely transparent
    field.style.position = "fixed"
    field.style.top = "0"
    field.style.left = "-9999px"
    document.body.appendChild(field)
    field.select()
    field.setSelectionRange(0, text.length)
    const copied = document.execCommand("copy")
    field.remove()
    return copied
  } catch {
    return false
  }
}

/**
 * Copy text. Never rejects — every clipboard refusal observed across the six
 * targets (no user gesture on Safari, unfocused document on Chrome, permission
 * withheld) is the same recoverable condition and leaves the caller with the
 * same job: tell the user it didn't copy. So they are all `"denied"`.
 */
export async function writeClipboardText(
  text: string,
): Promise<ClipboardStatus> {
  if (viaPlugin()) {
    try {
      await Clipboard.write({ string: text })
      return "ok"
    } catch {
      //the plugin is compiled in and still refused — that is the OS, not a gap
      return "unsupported"
    }
  }
  if (typeof navigator?.clipboard?.writeText === "function") {
    try {
      await navigator.clipboard.writeText(text)
      return "ok"
    } catch {
      //fall through: a refused async write can still succeed via execCommand
      //while the user gesture is live
    }
  }
  if (writeViaExecCommand(text)) return "ok"
  return isClipboardWriteSupported() ? "denied" : "unsupported"
}

/**
 * Read the clipboard's text. Never rejects; see {@link writeClipboardText} for
 * why every refusal collapses to `"denied"`.
 *
 * ⚠︎ On web this must be called from a user gesture. Chromium additionally
 * requires the document to be focused, so a read triggered from devtools or a
 * background tab returns `"denied"` even with the permission granted.
 */
export async function readClipboardText(): Promise<ClipboardRead> {
  if (viaPlugin()) {
    try {
      const result = await Clipboard.read()
      return { status: "ok", text: result.value }
    } catch {
      return { status: "unsupported", text: null }
    }
  }
  if (!isClipboardReadSupported()) {
    return { status: "unsupported", text: null }
  }
  try {
    return { status: "ok", text: await navigator.clipboard.readText() }
  } catch {
    return { status: "denied", text: null }
  }
}
