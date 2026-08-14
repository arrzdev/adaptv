import { Clipboard } from "@capacitor/clipboard"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  checkClipboardReadPermission,
  isClipboardReadSupported,
  isClipboardWriteSupported,
  readClipboardText,
  writeClipboardText,
} from "#adaptv/capabilities/clipboard"

vi.mock("@capacitor/clipboard", () => ({
  Clipboard: {
    write: vi.fn(() => Promise.resolve()),
    read: vi.fn(() => Promise.resolve({ value: "native", type: "text" })),
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

/** happy-dom has no execCommand; stub it so the legacy path is testable. */
function stubExecCommand(result: boolean | Error): void {
  const prev = Object.getOwnPropertyDescriptor(document, "execCommand")
  Object.defineProperty(document, "execCommand", {
    value: () => {
      if (result instanceof Error) throw result
      return result
    },
    configurable: true,
  })
  restores.push(() => {
    if (prev) Object.defineProperty(document, "execCommand", prev)
    else
      delete (document as unknown as Record<string, unknown>).execCommand
  })
}

afterEach(() => {
  for (const r of restores.splice(0)) r()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe("clipboard — read and write are separate capabilities", () => {
  it("keeps write available on an insecure origin, where read is not", () => {
    //no navigator.clipboard at all is exactly what a plain-http LAN dev URL
    //looks like on a phone — copying still works via execCommand, pasting
    //never has. Reporting one flag for both would lie about one of them.
    forceNative(false)
    stubNavigatorProp("clipboard", undefined)
    stubExecCommand(true)
    expect(isClipboardWriteSupported()).toBe(true)
    expect(isClipboardReadSupported()).toBe(false)
  })

  it("reports 'unavailable' for read permission when there is no read API", async () => {
    forceNative(false)
    stubNavigatorProp("clipboard", undefined)
    await expect(checkClipboardReadPermission()).resolves.toBe(
      "unavailable",
    )
  })
})

describe("clipboard — the read permission", () => {
  it("normalises the Permissions API state", async () => {
    forceNative(false)
    stubNavigatorProp("clipboard", { readText: () => Promise.resolve("") })
    stubNavigatorProp("permissions", {
      query: () => Promise.resolve({ state: "denied" }),
    })
    await expect(checkClipboardReadPermission()).resolves.toBe("denied")
  })

  it("reports 'prompt' when the browser doesn't know the clipboard-read name", async () => {
    //Safari and Firefox throw TypeError for this permission name but still
    //allow a read from a user gesture — "you may ask", not "denied"
    forceNative(false)
    stubNavigatorProp("clipboard", { readText: () => Promise.resolve("") })
    stubNavigatorProp("permissions", {
      query: () => Promise.reject(new TypeError("unknown name")),
    })
    await expect(checkClipboardReadPermission()).resolves.toBe("prompt")
  })

  it("is granted on native — the pasteboard is not permission-gated there", async () => {
    forceNative(true)
    await expect(checkClipboardReadPermission()).resolves.toBe("granted")
  })
})

describe("clipboard — write", () => {
  it("falls back to execCommand when the async write is refused", async () => {
    forceNative(false)
    stubNavigatorProp("clipboard", {
      writeText: () =>
        Promise.reject(new Error("Document is not focused")),
    })
    stubExecCommand(true)
    await expect(writeClipboardText("hi")).resolves.toBe("ok")
  })

  it("reports 'denied' when both paths refuse", async () => {
    forceNative(false)
    stubNavigatorProp("clipboard", {
      writeText: () => Promise.reject(new Error("NotAllowedError")),
    })
    stubExecCommand(false)
    await expect(writeClipboardText("hi")).resolves.toBe("denied")
  })

  it("survives an execCommand that throws", async () => {
    forceNative(false)
    stubNavigatorProp("clipboard", undefined)
    stubExecCommand(new Error("blocked"))
    await expect(writeClipboardText("hi")).resolves.toBe("denied")
  })

  it("writes through the plugin on native", async () => {
    forceNative(true)
    await expect(writeClipboardText("hi")).resolves.toBe("ok")
    expect(Clipboard.write).toHaveBeenCalledWith({ string: "hi" })
  })

  it("reports 'unsupported' when the native plugin is missing", async () => {
    forceNative(true)
    vi.mocked(Clipboard.write).mockRejectedValueOnce(
      new Error("not implemented"),
    )
    await expect(writeClipboardText("hi")).resolves.toBe("unsupported")
  })
})

describe("clipboard — read", () => {
  it("returns the text on success", async () => {
    forceNative(false)
    stubNavigatorProp("clipboard", {
      readText: () => Promise.resolve("pasted"),
    })
    await expect(readClipboardText()).resolves.toEqual({
      status: "ok",
      text: "pasted",
    })
  })

  it("returns 'denied' with a null text rather than rejecting", async () => {
    forceNative(false)
    stubNavigatorProp("clipboard", {
      readText: () => Promise.reject(new Error("NotAllowedError")),
    })
    await expect(readClipboardText()).resolves.toEqual({
      status: "denied",
      text: null,
    })
  })

  it("returns 'unsupported' where there is no read API", async () => {
    forceNative(false)
    stubNavigatorProp("clipboard", undefined)
    await expect(readClipboardText()).resolves.toEqual({
      status: "unsupported",
      text: null,
    })
  })

  it("reads through the plugin on native", async () => {
    forceNative(true)
    await expect(readClipboardText()).resolves.toEqual({
      status: "ok",
      text: "native",
    })
  })
})

describe("clipboard — a binary that predates the plugin", () => {
  it("copies through the WebView instead of the absent bridge", async () => {
    //The OTA skew: this bundle was built after `@capacitor/clipboard` was added,
    //the binary under it was not. An Android WebView on a secure origin has a
    //real `navigator.clipboard`, so the copy must reach IT rather than reporting
    //"unsupported" and losing a working feature. → LIFECYCLE.md §5.6
    forceNativeBinary([])
    const writeText = vi.fn(() => Promise.resolve())
    stubNavigatorProp("clipboard", { writeText })
    await expect(writeClipboardText("hi")).resolves.toBe("ok")
    expect(Clipboard.write).not.toHaveBeenCalled()
    expect(writeText).toHaveBeenCalledWith("hi")
  })

  it("reports unsupported when the WebView has nothing either", () => {
    forceNativeBinary(["Share"])
    stubNavigatorProp("clipboard", undefined)
    expect(isClipboardReadSupported()).toBe(false)
  })
})
