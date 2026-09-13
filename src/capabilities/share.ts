//Share accessor — the OS share sheet, one call on every target:
//  • native   → @capacitor/share (UIActivityViewController / Android chooser)
//  • web/PWA  → Web Share API (navigator.share / navigator.canShare)
//
//Sharing needs no permission, so this does NOT use geolocation's four-state
//enum — it uses the boolean probe from `docs/research/capability-surface.md` §3.2, and it needs
//TWO of them, because the Web Share API gates on two independent things:
//
//  • {@link isShareSupported} — is there a share sheet here at all? `false` on
//    desktop Chrome and on every Firefox; `true` on Safari, on iOS/Android web,
//    and on a native build whose BINARY carries the plugin (see `viaPlugin`).
//  • {@link canShareTarget}   — will THIS payload go through it? A browser with
//    `navigator.share` still refuses file payloads it has no handler for.
//
//A caller that only checks the first one ships a share button that throws on
//desktop Chrome; a caller that only checks the second ships one that silently
//does nothing. Both are the failure this capability exists to make visible.
//
//Files: a `File` object only goes through on the web, because the native
//plugin wants an on-disk URI. A file the app wrote through the filesystem
//capability is the shape that works everywhere — `storedFiles` — resolved to
//a URI on native and read back into a `File` on the web.
import { Share } from "@capacitor/share"
import type { FileScope } from "#adaptv/capabilities/filesystem"
import { getFileUri, readFile } from "#adaptv/capabilities/filesystem"
import { hasNativePlugin } from "#adaptv/utils/native-plugins"
import { isNativePlatform } from "#adaptv/utils/platform"

export type StoredFile = {
  /** The path the file was written under, relative to its scope. */
  path: string
  /** Defaults to `"data"`, as the filesystem capability does. */
  scope?: FileScope
  /**
   * The MIME type the web sheet advertises. Defaults from the extension for
   * the common ones (text, json, csv, pdf, images, audio, video, zip) and
   * `application/octet-stream` otherwise; native ignores it and reads the file.
   */
  type?: string
}

export type ShareTarget = {
  title?: string
  text?: string
  url?: string
  /**
   * Web/PWA only. `@capacitor/share` takes file **URIs** (`string[]`), not
   * `File` objects, and a `File` read out of a WebView has no on-disk URI to
   * hand the native chooser. So a payload with `files` is reported as
   * un-shareable on native rather than silently dropping them —
   * {@link canShareTarget} returns `false` and {@link share} returns
   * `"unsupported"`. A file the app wrote through the filesystem capability
   * goes through {@link ShareTarget.storedFiles} instead, which works on every
   * target.
   */
  files?: File[]
  /**
   * Files the app wrote through the filesystem capability, by path. On native
   * each becomes the `file://` URI the sheet needs; on the web each is read
   * back into a `File` named after its last path segment. A path that is not
   * there is a caller error and {@link share} rejects, the way a lost user
   * gesture does.
   */
  storedFiles?: StoredFile[]
  /** Native iOS only: the sheet's title. Ignored on Android and on web. */
  dialogTitle?: string
}

/**
 * What happened. `"unsupported"` and `"dismissed"` are both ordinary outcomes,
 * not errors — {@link share} never rejects for either.
 */
export type ShareOutcome = "shared" | "dismissed" | "unsupported"

const MIME_BY_EXTENSION: Record<string, string> = {
  txt: "text/plain",
  md: "text/markdown",
  csv: "text/csv",
  html: "text/html",
  json: "application/json",
  pdf: "application/pdf",
  zip: "application/zip",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  mp4: "video/mp4",
}

function storedFileName(file: StoredFile): string {
  return (
    file.path
      .split("/")
      .filter((part) => part.length > 0)
      .at(-1) ?? ""
  )
}

function storedFileType(file: StoredFile): string {
  if (file.type) return file.type
  const extension =
    storedFileName(file).split(".").at(-1)?.toLowerCase() ?? ""
  return MIME_BY_EXTENSION[extension] ?? "application/octet-stream"
}

/**
 * Strip the native-only / web-only fields down to a Web Share payload. A
 * stored file arrives as whatever `stored` built for it: a zero-byte probe for
 * `canShare`, the real bytes for `share`.
 */
function toWebPayload(
  target: ShareTarget,
  stored: File[] = [],
): ShareData {
  const payload: ShareData = {}
  if (target.title !== undefined) payload.title = target.title
  if (target.text !== undefined) payload.text = target.text
  if (target.url !== undefined) payload.url = target.url
  const files = [...(target.files ?? []), ...stored]
  if (files.length) payload.files = files
  return payload
}

/** Zero-byte stand-ins with the real names and types, for the synchronous `canShare`. */
function probeFiles(target: ShareTarget): File[] | null {
  const stored = target.storedFiles ?? []
  if (!stored.length) return []
  if (typeof File === "undefined") return null
  return stored.map(
    (file) =>
      new File([], storedFileName(file), { type: storedFileType(file) }),
  )
}

/**
 * The stored files read back as `File`s, or `null` when this target has no file
 * store to read them from. Rejects on a path that is not there: a caller error.
 *
 * `canShareTarget` is synchronous and cannot open the store, so a browser with
 * `canShare` and no usable origin-private file system (no `createWritable()`, or
 * a root the engine refuses to open) passes the probe; that is a target that
 * cannot share this payload, which `share` reports as `"unsupported"`.
 */
async function readStoredFiles(
  target: ShareTarget,
): Promise<File[] | null> {
  const out: File[] = []
  for (const file of target.storedFiles ?? []) {
    const read = await readFile(file.path, { scope: file.scope })
    if (read.status === "unsupported") return null
    if (read.status !== "ok" || !read.bytes) {
      throw new Error(`stored file is ${read.status}: ${file.path}`)
    }
    out.push(
      new File([read.bytes as BlobPart], storedFileName(file), {
        type: storedFileType(file),
      }),
    )
  }
  return out
}

/** The stored files as native URIs. Rejects on a path that is not there: a caller error. */
async function storedFileUris(target: ShareTarget): Promise<string[]> {
  const out: string[] = []
  for (const file of target.storedFiles ?? []) {
    const found = await getFileUri(file.path, { scope: file.scope })
    if (found.status !== "ok" || !found.uri) {
      throw new Error(`stored file is ${found.status}: ${file.path}`)
    }
    out.push(found.uri)
  }
  return out
}

/**
 * Whether the call goes through the native plugin. Every native branch below
 * asks THIS rather than `isNativePlatform()`: an OTA bundle can be running on a
 * binary that predates the plugin, and there the native branch is a rejected
 * bridge call, not a share sheet. → `docs/design/ota.md §5.6`
 */
function viaPlugin(): boolean {
  return isNativePlatform() && hasNativePlugin("Share")
}

/**
 * Whether a share sheet exists on this target at all. Synchronous on purpose:
 * this is what lets a share button be *absent* from the first render instead of
 * disappearing a frame later.
 *
 * Native answers without a bridge hop. `Share.canShare()` exists, but it is
 * async, and paying a round-trip for a button label would force every caller
 * into a loading state.
 *
 * The native branch asks whether the **binary** carries the plugin, not just
 * whether we are native, because OTA can put a bundle that shares on a binary
 * built before sharing existed. It falls through rather than returning `false`,
 * so a WebView that does have `navigator.share` still gets it.
 */
export function isShareSupported(): boolean {
  if (viaPlugin()) return true
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
  if (viaPlugin()) {
    //via the plugin: no File→URI path (see ShareTarget.files); a stored file
    //has one, through the filesystem plugin, when the binary carries it too
    if (target.files?.length) return false
    if (target.storedFiles?.length) return hasNativePlugin("Filesystem")
    return true
  }
  const hasFiles = Boolean(
    target.files?.length || target.storedFiles?.length,
  )
  if (typeof navigator.canShare !== "function") {
    //Web Share level 1 — `share` without `canShare`. Text/URL payloads are the
    //only thing level 1 accepts, so files are the one certain "no".
    return !hasFiles
  }
  const stored = probeFiles(target)
  if (!stored) return false
  try {
    return navigator.canShare(toWebPayload(target, stored))
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

  if (viaPlugin()) {
    const files = target.storedFiles?.length
      ? await storedFileUris(target)
      : undefined
    try {
      await Share.share({
        title: target.title,
        text: target.text,
        url: target.url,
        files,
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

  //reading the stored bytes is an await before `navigator.share`; every engine
  //here keeps the activation for a few seconds (transient activation), and the
  //PWA row of the PR that added this measured it on WebKit
  const stored = target.storedFiles?.length
    ? await readStoredFiles(target)
    : []
  if (!stored) return "unsupported"
  try {
    await navigator.share(toWebPayload(target, stored))
    return "shared"
  } catch (cause) {
    //every browser reports a dismissed sheet as AbortError
    if (cause instanceof Error && cause.name === "AbortError") {
      return "dismissed"
    }
    throw cause
  }
}
