import { Share } from "@capacitor/share"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { readFile } from "#adaptv/capabilities/filesystem"
import {
  canShareTarget,
  isShareSupported,
  share,
} from "#adaptv/capabilities/share"

const storedFiles = new Map<string, Uint8Array>()

vi.mock("#adaptv/capabilities/filesystem", () => ({
  getFileUri: vi.fn(async (path: string, o?: { scope?: string }) => {
    const hit = storedFiles.get(`${o?.scope ?? "data"}/${path}`)
    return hit
      ? {
          status: "ok",
          uri: `file:///container/${o?.scope ?? "data"}/${path}`,
        }
      : { status: "missing", uri: null }
  }),
  readFile: vi.fn(async (path: string, o?: { scope?: string }) => {
    const hit = storedFiles.get(`${o?.scope ?? "data"}/${path}`)
    return hit
      ? { status: "ok", bytes: hit }
      : { status: "missing", bytes: null }
  }),
}))

vi.mock("@capacitor/share", () => ({
  Share: {
    share: vi.fn(() => Promise.resolve({ activityType: "copy" })),
    canShare: vi.fn(() => Promise.resolve({ value: true })),
  },
}))

const restores: Array<() => void> = []

function forceNative(native: boolean): void {
  vi.stubGlobal(
    "Capacitor",
    native ? { isNativePlatform: () => true } : undefined,
  )
}

/** A native shell whose binary carries exactly `plugins` and nothing else. */
function forceNativeBinary(plugins: string[]): void {
  vi.stubGlobal("Capacitor", {
    isNativePlatform: () => true,
    PluginHeaders: plugins.map((name) => ({ name })),
  })
}

function stubNavigatorProp(key: string, value: unknown): void {
  const prev = Object.getOwnPropertyDescriptor(navigator, key)
  Object.defineProperty(navigator, key, { value, configurable: true })
  restores.push(() => {
    if (prev) Object.defineProperty(navigator, key, prev)
    else delete (navigator as unknown as Record<string, unknown>)[key]
  })
}

/** happy-dom has no File; the payload is only ever inspected for length. */
function fakeFiles(): File[] {
  return [{} as File]
}

afterEach(() => {
  for (const r of restores.splice(0)) r()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe("share — the support probe", () => {
  it("reports unsupported when the browser has no share sheet", () => {
    //desktop Chrome and every Firefox: this is the branch an app must render
    //an alternative for, and the reason the hook exposes `supported` at all
    forceNative(false)
    stubNavigatorProp("share", undefined)
    expect(isShareSupported()).toBe(false)
    expect(canShareTarget({ text: "hi" })).toBe(false)
  })

  it("is supported on native without a bridge round-trip", () => {
    forceNative(true)
    expect(isShareSupported()).toBe(true)
    expect(Share.canShare).not.toHaveBeenCalled()
  })

  it("reports unsupported on a binary that predates the plugin", () => {
    //The OTA skew, on a device: this bundle was built after `@capacitor/share`
    //was added; the binary under it was not. Under the `install` default the
    //bundle runs anyway, so the share button has to be ABSENT rather than
    //throwing — which is exactly what the app already reads as
    //`useShare().supported`. → docs/design/ota.md §5.6
    forceNativeBinary(["Haptics"])
    stubNavigatorProp("share", undefined)
    expect(isShareSupported()).toBe(false)
  })

  it("falls through to the Web Share API rather than to nothing", () => {
    //A missing plugin is not the same statement as "no share sheet here". If the
    //WebView happens to expose `navigator.share`, that is a real share sheet and
    //the user gets it.
    forceNativeBinary([])
    stubNavigatorProp("share", () => Promise.resolve())
    expect(isShareSupported()).toBe(true)
  })

  it("shares through the WebView, not the absent bridge", async () => {
    forceNativeBinary([])
    const webShare = vi.fn(() => Promise.resolve())
    stubNavigatorProp("share", webShare)
    stubNavigatorProp("canShare", undefined)
    await expect(share({ text: "hi" })).resolves.toBe("shared")
    expect(Share.share).not.toHaveBeenCalled()
    expect(webShare).toHaveBeenCalledOnce()
  })
})

describe("share — payload gating", () => {
  it("defers to navigator.canShare for the payload", () => {
    forceNative(false)
    stubNavigatorProp("share", () => Promise.resolve())
    //a browser with a share sheet can still refuse THIS payload — the second
    //probe is what stops a file share from silently doing nothing
    stubNavigatorProp("canShare", () => false)
    expect(isShareSupported()).toBe(true)
    expect(canShareTarget({ files: fakeFiles() })).toBe(false)
  })

  it("treats a throwing canShare as a refusal", () => {
    forceNative(false)
    stubNavigatorProp("share", () => Promise.resolve())
    stubNavigatorProp("canShare", () => {
      throw new TypeError("bad payload")
    })
    expect(canShareTarget({ files: fakeFiles() })).toBe(false)
  })

  it("allows text/url on a Web Share level 1 browser", () => {
    forceNative(false)
    stubNavigatorProp("share", () => Promise.resolve())
    stubNavigatorProp("canShare", undefined)
    expect(canShareTarget({ text: "hi" })).toBe(true)
    expect(canShareTarget({ files: fakeFiles() })).toBe(false)
  })

  it("refuses file payloads on native (no File → URI path)", async () => {
    forceNative(true)
    expect(canShareTarget({ files: fakeFiles() })).toBe(false)
    await expect(share({ files: fakeFiles() })).resolves.toBe(
      "unsupported",
    )
    expect(Share.share).not.toHaveBeenCalled()
  })
})

describe("share — outcomes", () => {
  it("returns 'unsupported' instead of throwing where there is no sheet", async () => {
    forceNative(false)
    stubNavigatorProp("share", undefined)
    await expect(share({ text: "hi" })).resolves.toBe("unsupported")
  })

  it("reports a web dismissal as 'dismissed', not an error", async () => {
    forceNative(false)
    const abort = new Error("cancelled")
    abort.name = "AbortError"
    stubNavigatorProp("share", () => Promise.reject(abort))
    stubNavigatorProp("canShare", () => true)
    await expect(share({ text: "hi" })).resolves.toBe("dismissed")
  })

  it("rethrows a missing user gesture — that is a caller bug, not a state", async () => {
    forceNative(false)
    const notAllowed = new Error("must be handling a user gesture")
    notAllowed.name = "NotAllowedError"
    stubNavigatorProp("share", () => Promise.reject(notAllowed))
    stubNavigatorProp("canShare", () => true)
    await expect(share({ text: "hi" })).rejects.toThrow(notAllowed)
  })

  it("reports the iOS 'Share canceled' rejection as a dismissal", async () => {
    forceNative(true)
    vi.mocked(Share.share).mockRejectedValueOnce(
      new Error("Share canceled"),
    )
    await expect(share({ text: "hi" })).resolves.toBe("dismissed")
  })

  it("passes dialogTitle through to the native sheet", async () => {
    forceNative(true)
    await expect(
      share({ text: "hi", dialogTitle: "Send to" }),
    ).resolves.toBe("shared")
    expect(Share.share).toHaveBeenCalledWith(
      expect.objectContaining({ dialogTitle: "Send to" }),
    )
  })
})

describe("share — a stored file", () => {
  const stored = {
    ...{ title: "backup" },
    storedFiles: [{ path: "export/backup.json", scope: "cache" as const }],
  }

  beforeEach(() => {
    storedFiles.clear()
    storedFiles.set(
      "cache/export/backup.json",
      new TextEncoder().encode("{}"),
    )
  })

  it("goes through the native sheet as a file URI when the binary carries both plugins", async () => {
    forceNativeBinary(["Share", "Filesystem"])
    expect(canShareTarget(stored)).toBe(true)
    expect(await share(stored)).toBe("shared")
    expect(Share.share).toHaveBeenLastCalledWith(
      expect.objectContaining({
        title: "backup",
        files: ["file:///container/cache/export/backup.json"],
      }),
    )
  })

  it("is refused on a binary that carries the share plugin but not the filesystem one", () => {
    forceNativeBinary(["Share"])
    expect(canShareTarget(stored)).toBe(false)
  })

  it("rejects, as a caller error, when the stored path is not there", async () => {
    forceNativeBinary(["Share", "Filesystem"])
    await expect(
      share({
        storedFiles: [{ path: "export/nope.json", scope: "cache" }],
      }),
    ).rejects.toThrow(/stored file is missing: export\/nope.json/)
    expect(Share.share).not.toHaveBeenCalled()
  })

  it("on the web, probes canShare with a zero-byte File of the same name and type, then shares the real bytes", async () => {
    forceNative(false)
    const { File: NodeFile } = await import("node:buffer")
    vi.stubGlobal("File", NodeFile)
    const canShareSpy = vi.fn(() => true)
    const shareSpy = vi.fn(() => Promise.resolve())
    stubNavigatorProp("canShare", canShareSpy)
    stubNavigatorProp("share", shareSpy)

    expect(canShareTarget(stored)).toBe(true)
    const probe = (canShareSpy.mock.calls[0] as unknown as [ShareData])[0]
    expect(probe.files?.map((f) => [f.name, f.type, f.size])).toEqual([
      ["backup.json", "application/json", 0],
    ])

    expect(await share(stored)).toBe("shared")
    const sent = (shareSpy.mock.calls.at(-1) as unknown as [ShareData])[0]
    expect(sent.files?.map((f) => [f.name, f.type, f.size])).toEqual([
      ["backup.json", "application/json", 2],
    ])
    expect(sent.title).toBe("backup")
  })

  it("on the web, resolves unsupported rather than rejecting when the browser has no file store to read from", async () => {
    forceNative(false)
    const { File: NodeFile } = await import("node:buffer")
    vi.stubGlobal("File", NodeFile)
    const shareSpy = vi.fn(() => Promise.resolve())
    stubNavigatorProp("canShare", () => true)
    stubNavigatorProp("share", shareSpy)
    //the synchronous probe cannot open the store, so it passes; the read is
    //where a browser without a usable origin-private file system shows itself
    vi.mocked(readFile).mockResolvedValueOnce({
      status: "unsupported",
      bytes: null,
    })

    expect(canShareTarget(stored)).toBe(true)
    expect(await share(stored)).toBe("unsupported")
    expect(shareSpy).not.toHaveBeenCalled()
  })

  it("types a stored file from its extension, or from the type given, or as octet-stream", () => {
    forceNative(false)
    vi.stubGlobal(
      "File",
      class {
        name: string
        type: string
        constructor(_: unknown[], name: string, o?: { type?: string }) {
          this.name = name
          this.type = o?.type ?? ""
        }
      },
    )
    const seen: string[] = []
    stubNavigatorProp("canShare", (d: ShareData) => {
      seen.push(d.files?.[0]?.type ?? "")
      return true
    })
    stubNavigatorProp("share", () => Promise.resolve())
    canShareTarget({ storedFiles: [{ path: "a/b.PNG" }] })
    canShareTarget({
      storedFiles: [{ path: "a/b.bin", type: "application/x-adaptv" }],
    })
    canShareTarget({ storedFiles: [{ path: "a/b.unknown" }] })
    expect(seen).toEqual([
      "image/png",
      "application/x-adaptv",
      "application/octet-stream",
    ])
  })

  it("is refused on a web share level 1 browser, which has no file support at all", () => {
    forceNative(false)
    stubNavigatorProp("share", () => Promise.resolve())
    stubNavigatorProp("canShare", undefined)
    expect(canShareTarget(stored)).toBe(false)
    expect(canShareTarget({ text: "hi" })).toBe(true)
  })
})
