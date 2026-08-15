import { afterEach, describe, expect, it, vi } from "vitest"
import { hasNativePlugin } from "#adaptv/utils/native-plugins"

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("hasNativePlugin", () => {
  it("answers from the list the native layer injected", () => {
    vi.stubGlobal("Capacitor", {
      isNativePlatform: () => true,
      PluginHeaders: [{ name: "Share" }, { name: "Haptics" }],
    })
    expect(hasNativePlugin("Share")).toBe(true)
    expect(hasNativePlugin("Clipboard")).toBe(false)
  })

  it("says no to a plugin this binary predates — the whole point", () => {
    //The skew this exists for: a bundle built after `@capacitor/share` was added
    //lands on a binary built before it. The header list is the binary's, and it
    //is the only thing on the device the new bundle cannot talk itself out of.
    vi.stubGlobal("Capacitor", {
      isNativePlatform: () => true,
      PluginHeaders: [{ name: "Haptics" }],
    })
    expect(hasNativePlugin("Share")).toBe(false)
  })

  it("assumes present when the runtime injected no list at all", () => {
    //Absent headers are no evidence. Answering `false` would hide a working
    //feature for good, so this holds the behaviour every non-OTA app has always
    //had — attempt the call, let it fail if the plugin really is missing.
    vi.stubGlobal("Capacitor", { isNativePlatform: () => true })
    expect(hasNativePlugin("Share")).toBe(true)
  })

  it("is not fooled by an empty list, which IS evidence", () => {
    //An empty array is the bridge saying "nothing is compiled in", which is a
    //different statement from saying nothing. The `!headers` fallback must not
    //swallow it.
    vi.stubGlobal("Capacitor", {
      isNativePlatform: () => true,
      PluginHeaders: [],
    })
    expect(hasNativePlugin("Share")).toBe(false)
  })
})
