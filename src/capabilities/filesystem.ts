//Filesystem accessor — files the app owns, on every target:
//  • native   → @capacitor/filesystem, the app's own container (Data) or its
//               evictable cache (Cache), under `adaptv/<scope>/` in either
//  • web/PWA  → the origin-private file system (OPFS): `navigator.storage
//               .getDirectory()` and `FileSystemFileHandle.createWritable()`
//
//## Why OPFS and not the plugin's web implementation
//
//The plugin's own web tier is a file table in IndexedDB. It answers, but it is
//not a file system: no quota accounting of its own, a Blob where native hands
//back bytes, and the same failure shape as `storage.store` for a caller who
//only wanted a file. OPFS is a real directory the browser owns for this
//origin, with the same read/write/list/delete semantics native has, so ONE
//surface describes both — which is what a capability is for.
//
//## What was verified, and what was not (2026-09-02)
//
//  • Chromium 149: getDirectory + createWritable, a round trip reads back.
//  • Playwright's WebKit 26.5: both APIs are present, and `getDirectory()`
//    itself rejects — `UnknownError: The operation failed for an unknown
//    transient reason (e.g. out of memory)` — on a real http origin, in an
//    ephemeral context, before any file is touched. That is why the support
//    answer below is asynchronous: a presence check would say yes and every
//    call after it would fail. The real WebKit is not that: Safari's installed
//    web app on the iOS 26.1 simulator round-trips text and bytes through OPFS
//    and reads them back after a cold launch with the origin down.
//  • Native: `@capacitor/filesystem` on the iOS simulator and the Android
//    emulator — the lab page's round trip on both, recorded in the PR.
//
//## The shape
//
//Nothing here rejects. A write returns an outcome, a read returns a status
//with the value or `null`, and `getFilesystemSupport()` is the one answer to
//"can I?" — a `backend` of `null` with a caveat that says why, rather than a
//boolean a caller has to guess around. It is asynchronous because on the web
//the honest answer needs one attempt to open the root directory: the API can
//be present and refuse (see above), and a sync check cannot see that. The
//first successful open is memoised, so it costs one await per process. Paths are relative, `/`-separated,
//and create their directories on write; `.` and `..` are refused and a leading
//`/` is dropped, so every path resolves under `adaptv/<scope>/` on every tier.
import { Directory, Encoding, Filesystem } from "@capacitor/filesystem"
import { hasNativePlugin } from "#adaptv/utils/native-plugins"
import { isNativePlatform } from "#adaptv/utils/platform"

/**
 * `"data"` — on native, persists until the app is uninstalled or its data is
 * cleared. On the web it is best-effort storage: it lasts until the site's data
 * is cleared, and the browser may also evict it under storage pressure, because
 * this module never asks for `navigator.storage.persist()`.
 * `"cache"` — the OS (native) may evict it under pressure; on the web it is a
 * second directory under the same quota, kept apart so a listing of one never
 * shows the other.
 */
export type FileScope = "data" | "cache"

export type FilesystemBackend = "native" | "opfs"

export type FilesystemSupport = {
  supported: boolean
  /** Which implementation answers here, or `null` when none can. */
  backend: FilesystemBackend | null
  /**
   * What a caller should know before relying on this target, or `null`. On
   * the web it names where the files really live; when unsupported it names
   * the missing piece.
   */
  caveat: string | null
}

export type FileStatus = "ok" | "missing" | "unsupported" | "failed"
export type FileWriteOutcome =
  | "written"
  | "unsupported"
  | "quota"
  | "failed"
export type FileDeleteOutcome =
  | "deleted"
  | "missing"
  | "unsupported"
  | "failed"

export type FileEntry = {
  name: string
  kind: "file" | "directory"
  /** Bytes, or `null` for a directory and wherever the platform will not say. */
  size: number | null
  /** Epoch milliseconds of the last write, or `null` where the platform will not say. */
  modifiedAt: number | null
}

export type FileRead = {
  status: FileStatus
  /** The file's bytes, or `null` for any status other than `"ok"`. */
  bytes: Uint8Array | null
}

export type FileTextRead = {
  status: FileStatus
  /** The file decoded as UTF-8, or `null` for any status other than `"ok"`. */
  text: string | null
}

export type FileListing = {
  status: FileStatus
  /** The directory's direct children, or `null` for any status other than `"ok"`. */
  entries: FileEntry[] | null
}

export type FileStat = {
  status: FileStatus
  entry: FileEntry | null
}

export type FileOptions = {
  /** Defaults to `"data"`. */
  scope?: FileScope
}

type OpfsFileHandle = {
  kind: "file"
  name: string
  getFile: () => Promise<File>
  createWritable: () => Promise<{
    write: (data: Uint8Array | string) => Promise<void>
    close: () => Promise<void>
  }>
}

type OpfsDirectoryHandle = {
  kind: "directory"
  name: string
  getDirectoryHandle: (
    name: string,
    options?: { create?: boolean },
  ) => Promise<OpfsDirectoryHandle>
  getFileHandle: (
    name: string,
    options?: { create?: boolean },
  ) => Promise<OpfsFileHandle>
  removeEntry: (
    name: string,
    options?: { recursive?: boolean },
  ) => Promise<void>
  entries: () => AsyncIterable<
    [string, OpfsDirectoryHandle | OpfsFileHandle]
  >
}

type OpfsStorage = { getDirectory?: () => Promise<OpfsDirectoryHandle> }

/** The OPFS entry points, or `null` when either is absent; says nothing about whether they work. */
function opfsApi(): (() => Promise<OpfsDirectoryHandle>) | null {
  if (typeof navigator === "undefined") return null
  const storage = (navigator as unknown as { storage?: OpfsStorage })
    .storage
  const getDirectory = storage?.getDirectory
  if (typeof getDirectory !== "function") return null
  const FileHandle = (
    globalThis as { FileSystemFileHandle?: { prototype: object } }
  ).FileSystemFileHandle
  //a WebKit that can hand out the directory but cannot write into it from the
  //main thread is not a file system a caller can use; say which piece is missing
  if (!FileHandle || !("createWritable" in FileHandle.prototype))
    return null
  return () => getDirectory.call(storage)
}

let opfsRootHandle: OpfsDirectoryHandle | null = null
let opfsRootOwner: OpfsStorage | null = null

/**
 * The origin's root directory, opened once per `navigator.storage`. Only a
 * success is memoised: a rejection is not, so every later call opens the root
 * again (the error WebKit gives is worded as transient). Where the browser
 * refuses every attempt, as Playwright's WebKit does, each call therefore
 * answers unsupported on its own retry — not from a remembered refusal.
 */
async function openOpfsRoot(): Promise<
  { root: OpfsDirectoryHandle } | { error: unknown }
> {
  const storage =
    (navigator as unknown as { storage?: OpfsStorage }).storage ?? null
  if (opfsRootHandle && opfsRootOwner === storage)
    return { root: opfsRootHandle }
  const api = opfsApi()
  if (!api) return { error: new Error("no origin-private file system") }
  try {
    const root = await api()
    opfsRootHandle = root
    opfsRootOwner = storage
    return { root }
  } catch (error) {
    return { error }
  }
}

const OPFS_CAVEAT =
  "Files live in the browser's origin-private file system: invisible to the user and other apps, cleared with the site's data or evicted by the browser under storage pressure, and counted against the browser's storage quota."

/**
 * The one answer to "can this target hold files?". Memoised after the first
 * yes, so a page can await it once and render the import/export controls, or
 * the reason they are absent, from then on.
 */
export async function getFilesystemSupport(): Promise<FilesystemSupport> {
  if (typeof window === "undefined") {
    return { supported: false, backend: null, caveat: null }
  }
  if (isNativePlatform()) {
    if (hasNativePlugin("Filesystem")) {
      return { supported: true, backend: "native", caveat: null }
    }
    return {
      supported: false,
      backend: null,
      caveat:
        "This installed binary predates the filesystem plugin; files are unavailable until the app is updated from the store.",
    }
  }
  if (!opfsApi()) {
    const hasDirectory =
      typeof (navigator as unknown as { storage?: OpfsStorage }).storage
        ?.getDirectory === "function"
    return {
      supported: false,
      backend: null,
      caveat: hasDirectory
        ? "This browser has an origin-private file system but no createWritable(), so nothing can be written to it from the page."
        : "This browser has no origin-private file system.",
    }
  }
  const opened = await openOpfsRoot()
  if ("error" in opened) {
    const error = opened.error as { name?: string; message?: string }
    return {
      supported: false,
      backend: null,
      caveat: `This browser has an origin-private file system but refused to open it: ${error?.name ?? "Error"}: ${error?.message ?? String(opened.error)}`,
    }
  }
  return { supported: true, backend: "opfs", caveat: OPFS_CAVEAT }
}

/** `["notes", "today.txt"]` for `"notes/today.txt"`; `null` for a path that escapes. */
function segments(path: string): string[] | null {
  const parts = path.split("/").filter((part) => part.length > 0)
  for (const part of parts) {
    if (part === "." || part === "..") return null
  }
  return parts
}

const NATIVE_DIRECTORY: Record<FileScope, Directory> = {
  data: Directory.Data,
  cache: Directory.Cache,
}

function nativeDirectory(options: FileOptions | undefined): Directory {
  return NATIVE_DIRECTORY[options?.scope ?? "data"]
}

function scopeDirectoryName(options: FileOptions | undefined): string {
  return options?.scope ?? "data"
}

/**
 * The one directory every file lives under, on every tier: `adaptv/<scope>/`.
 * On the web it keeps a consumer's own OPFS entries apart from the scopes, the
 * same isolation `storage.kv` gets from its key prefix. On native it matters
 * more: Android's `Directory.Data` is the app's `filesDir`, which also holds
 * the live-update plugin's `_capacitor_live_update_bundles`, so a path written
 * straight into it could list, overwrite or delete an over-the-air bundle.
 */
const NAMESPACE = "adaptv"

/** `adaptv/data/notes/today.txt` for `["notes", "today.txt"]`. */
function nativePath(
  parts: string[],
  options: FileOptions | undefined,
): string {
  return [NAMESPACE, scopeDirectoryName(options), ...parts].join("/")
}

const encoder = new TextEncoder()
const decoder = new TextDecoder()

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ""
  //8 KiB slices keep the argument list under every engine's spread limit
  for (let i = 0; i < bytes.length; i += 8192) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192))
  }
  return btoa(binary)
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

function isQuotaError(error: unknown): boolean {
  const name = (error as { name?: string })?.name
  if (name === "QuotaExceededError") return true
  const message = String((error as { message?: string })?.message ?? error)
  return /quota|no space|enospc|disk full/i.test(message)
}

function isMissingError(error: unknown): boolean {
  const name = (error as { name?: string })?.name
  if (name === "NotFoundError") return true
  const message = String((error as { message?: string })?.message ?? error)
  return /does not exist|not found|no such file|ENOENT/i.test(message)
}

//── native ──────────────────────────────────────────────────────────────────

async function nativeWrite(
  path: string,
  data: string | Uint8Array,
  options: FileOptions | undefined,
): Promise<FileWriteOutcome> {
  try {
    if (typeof data === "string") {
      await Filesystem.writeFile({
        path,
        data,
        directory: nativeDirectory(options),
        encoding: Encoding.UTF8,
        recursive: true,
      })
    } else {
      await Filesystem.writeFile({
        path,
        data: bytesToBase64(data),
        directory: nativeDirectory(options),
        recursive: true,
      })
    }
    return "written"
  } catch (error) {
    return isQuotaError(error) ? "quota" : "failed"
  }
}

async function nativeRead(
  path: string,
  options: FileOptions | undefined,
): Promise<FileRead> {
  try {
    const { data } = await Filesystem.readFile({
      path,
      directory: nativeDirectory(options),
    })
    //base64 on every native platform; a Blob only ever comes from the plugin's
    //web tier, which this module never selects
    if (typeof data !== "string") return { status: "failed", bytes: null }
    return { status: "ok", bytes: base64ToBytes(data) }
  } catch (error) {
    return {
      status: isMissingError(error) ? "missing" : "failed",
      bytes: null,
    }
  }
}

function nativeEntry(info: {
  name: string
  type: "directory" | "file"
  size: number
  mtime: number
}): FileEntry {
  return {
    name: info.name,
    kind: info.type,
    size: info.type === "file" ? info.size : null,
    modifiedAt: info.mtime > 0 ? info.mtime : null,
  }
}

async function nativeList(
  path: string,
  options: FileOptions | undefined,
  isScopeRoot: boolean,
): Promise<FileListing> {
  try {
    const { files } = await Filesystem.readdir({
      path,
      directory: nativeDirectory(options),
    })
    return { status: "ok", entries: files.map(nativeEntry) }
  } catch (error) {
    if (!isMissingError(error)) return { status: "failed", entries: null }
    //the scope's directory exists only once something was written into it; the
    //web creates it on open, so an untouched root is empty on both tiers
    if (isScopeRoot) return { status: "ok", entries: [] }
    return { status: "missing", entries: null }
  }
}

async function nativeStat(
  path: string,
  options: FileOptions | undefined,
): Promise<FileStat> {
  try {
    const info = await Filesystem.stat({
      path,
      directory: nativeDirectory(options),
    })
    const name = segments(path)?.at(-1) ?? ""
    return { status: "ok", entry: nativeEntry({ ...info, name }) }
  } catch (error) {
    return {
      status: isMissingError(error) ? "missing" : "failed",
      entry: null,
    }
  }
}

async function nativeDelete(
  path: string,
  options: FileOptions | undefined,
): Promise<FileDeleteOutcome> {
  try {
    await Filesystem.deleteFile({
      path,
      directory: nativeDirectory(options),
    })
    return "deleted"
  } catch (error) {
    return isMissingError(error) ? "missing" : "failed"
  }
}

//── opfs ────────────────────────────────────────────────────────────────────

/** The scope's directory, then each segment of `parts`; `null` when one is absent and `create` is off. */
async function opfsDirectory(
  parts: string[],
  options: FileOptions | undefined,
  create: boolean,
): Promise<OpfsDirectoryHandle | null> {
  const opened = await openOpfsRoot()
  if ("error" in opened) throw opened.error
  let dir = await opened.root.getDirectoryHandle(NAMESPACE, {
    create: true,
  })
  dir = await dir.getDirectoryHandle(scopeDirectoryName(options), {
    create: true,
  })
  for (const part of parts) {
    try {
      dir = await dir.getDirectoryHandle(part, { create })
    } catch (error) {
      if (isMissingError(error)) return null
      throw error
    }
  }
  return dir
}

async function opfsWrite(
  parts: string[],
  data: string | Uint8Array,
  options: FileOptions | undefined,
): Promise<FileWriteOutcome> {
  const name = parts.at(-1)
  if (!name) return "failed"
  try {
    const dir = await opfsDirectory(parts.slice(0, -1), options, true)
    if (!dir) return "failed"
    const handle = await dir.getFileHandle(name, { create: true })
    const writable = await handle.createWritable()
    await writable.write(
      typeof data === "string" ? encoder.encode(data) : data,
    )
    await writable.close()
    return "written"
  } catch (error) {
    return isQuotaError(error) ? "quota" : "failed"
  }
}

async function opfsFile(
  parts: string[],
  options: FileOptions | undefined,
): Promise<File | null> {
  const name = parts.at(-1)
  if (!name) return null
  const dir = await opfsDirectory(parts.slice(0, -1), options, false)
  if (!dir) return null
  try {
    const handle = await dir.getFileHandle(name)
    return await handle.getFile()
  } catch (error) {
    if (isMissingError(error)) return null
    throw error
  }
}

async function opfsRead(
  parts: string[],
  options: FileOptions | undefined,
): Promise<FileRead> {
  try {
    const file = await opfsFile(parts, options)
    if (!file) return { status: "missing", bytes: null }
    return {
      status: "ok",
      bytes: new Uint8Array(await file.arrayBuffer()),
    }
  } catch {
    return { status: "failed", bytes: null }
  }
}

async function opfsList(
  parts: string[],
  options: FileOptions | undefined,
): Promise<FileListing> {
  try {
    const dir = await opfsDirectory(parts, options, false)
    if (!dir) return { status: "missing", entries: null }
    const entries: FileEntry[] = []
    for await (const [name, handle] of dir.entries()) {
      if (handle.kind === "file") {
        const file = await handle.getFile()
        entries.push({
          name,
          kind: "file",
          size: file.size,
          modifiedAt: file.lastModified > 0 ? file.lastModified : null,
        })
      } else {
        entries.push({
          name,
          kind: "directory",
          size: null,
          modifiedAt: null,
        })
      }
    }
    entries.sort((a, b) => a.name.localeCompare(b.name))
    return { status: "ok", entries }
  } catch {
    return { status: "failed", entries: null }
  }
}

async function opfsStat(
  parts: string[],
  options: FileOptions | undefined,
): Promise<FileStat> {
  try {
    const name = parts.at(-1)
    if (!name) return { status: "failed", entry: null }
    const dir = await opfsDirectory(parts.slice(0, -1), options, false)
    if (!dir) return { status: "missing", entry: null }
    try {
      const file = await (await dir.getFileHandle(name)).getFile()
      return {
        status: "ok",
        entry: {
          name,
          kind: "file",
          size: file.size,
          modifiedAt: file.lastModified > 0 ? file.lastModified : null,
        },
      }
    } catch (error) {
      if (!isMissingError(error) && !isTypeMismatch(error)) throw error
    }
    try {
      await dir.getDirectoryHandle(name)
      return {
        status: "ok",
        entry: { name, kind: "directory", size: null, modifiedAt: null },
      }
    } catch (error) {
      if (isMissingError(error)) return { status: "missing", entry: null }
      throw error
    }
  } catch {
    return { status: "failed", entry: null }
  }
}

function isTypeMismatch(error: unknown): boolean {
  return (error as { name?: string })?.name === "TypeMismatchError"
}

async function opfsDelete(
  parts: string[],
  options: FileOptions | undefined,
): Promise<FileDeleteOutcome> {
  const name = parts.at(-1)
  if (!name) return "failed"
  try {
    const dir = await opfsDirectory(parts.slice(0, -1), options, false)
    if (!dir) return "missing"
    await dir.removeEntry(name)
    return "deleted"
  } catch (error) {
    return isMissingError(error) ? "missing" : "failed"
  }
}

//── surface ─────────────────────────────────────────────────────────────────

/**
 * Write a whole file, creating its directories. A string is stored as UTF-8;
 * bytes are stored as given. Never rejects: `"quota"` is the storage limit,
 * `"failed"` is everything else (a bad path included).
 */
export async function writeFile(
  path: string,
  data: string | Uint8Array,
  options?: FileOptions,
): Promise<FileWriteOutcome> {
  const support = await getFilesystemSupport()
  if (!support.supported) return "unsupported"
  const parts = segments(path)
  if (!parts || parts.length === 0) return "failed"
  if (support.backend === "native")
    return nativeWrite(nativePath(parts, options), data, options)
  return opfsWrite(parts, data, options)
}

/** Read a whole file as bytes. `"missing"` is a status, not an error. */
export async function readFile(
  path: string,
  options?: FileOptions,
): Promise<FileRead> {
  const support = await getFilesystemSupport()
  if (!support.supported) return { status: "unsupported", bytes: null }
  const parts = segments(path)
  if (!parts || parts.length === 0)
    return { status: "failed", bytes: null }
  if (support.backend === "native")
    return nativeRead(nativePath(parts, options), options)
  return opfsRead(parts, options)
}

/** Read a whole file as UTF-8 text. */
export async function readTextFile(
  path: string,
  options?: FileOptions,
): Promise<FileTextRead> {
  const read = await readFile(path, options)
  return {
    status: read.status,
    text: read.bytes ? decoder.decode(read.bytes) : null,
  }
}

/**
 * The direct children of a directory, `""` for the scope's root, sorted by
 * name. A directory that was never written is `"missing"`, not empty.
 */
export async function listFiles(
  path = "",
  options?: FileOptions,
): Promise<FileListing> {
  const support = await getFilesystemSupport()
  if (!support.supported) return { status: "unsupported", entries: null }
  const parts = segments(path)
  if (!parts) return { status: "failed", entries: null }
  if (support.backend === "native")
    return nativeList(
      nativePath(parts, options),
      options,
      parts.length === 0,
    )
  return opfsList(parts, options)
}

/** One entry's kind, size and last write, without reading it. */
export async function statFile(
  path: string,
  options?: FileOptions,
): Promise<FileStat> {
  const support = await getFilesystemSupport()
  if (!support.supported) return { status: "unsupported", entry: null }
  const parts = segments(path)
  if (!parts || parts.length === 0)
    return { status: "failed", entry: null }
  if (support.backend === "native")
    return nativeStat(nativePath(parts, options), options)
  return opfsStat(parts, options)
}

/** Remove one file. Deleting what is not there is `"missing"`, not a failure. */
export async function deleteFile(
  path: string,
  options?: FileOptions,
): Promise<FileDeleteOutcome> {
  const support = await getFilesystemSupport()
  if (!support.supported) return "unsupported"
  const parts = segments(path)
  if (!parts || parts.length === 0) return "failed"
  if (support.backend === "native")
    return nativeDelete(nativePath(parts, options), options)
  return opfsDelete(parts, options)
}
