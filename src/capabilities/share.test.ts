import { Share } from "@capacitor/share"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  canShareTarget,
  isShareSupported,
  share,
} from "#adaptv/capabilities/share"

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
