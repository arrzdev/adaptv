import { Device } from "@capacitor/device"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  getDeviceId,
  getDeviceInfo,
  getLanguageTag,
  resetDeviceInfo,
} from "#adaptv/capabilities/device"

vi.mock("@capacitor/device", () => ({
  Device: {
    getInfo: vi.fn(() =>
      Promise.resolve({
        model: "iPhone15,2",
        platform: "ios",
        operatingSystem: "ios",
        osVersion: "18.4",
        manufacturer: "Apple",
        isVirtual: false,
        webViewVersion: "618.1",
      }),
    ),
    getId: vi.fn(() => Promise.resolve({ identifier: "abc-123" })),
  },
}))

const restores: Array<() => void> = []

function forceNative(native: boolean): void {
  vi.stubGlobal(
    "Capacitor",
    native
      ? { isNativePlatform: () => true, getPlatform: () => "ios" }
      : undefined,
  )
}

function stubNavigatorProp(key: string, value: unknown): void {
  const prev = Object.getOwnPropertyDescriptor(navigator, key)
  Object.defineProperty(navigator, key, { value, configurable: true })
  restores.push(() => {
    if (prev) Object.defineProperty(navigator, key, prev)
    else delete (navigator as unknown as Record<string, unknown>)[key]
  })
}

afterEach(() => {
  for (const r of restores.splice(0)) r()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
  resetDeviceInfo()
})

describe("device — native", () => {
  it("normalises the plugin record", async () => {
    forceNative(true)
    await expect(getDeviceInfo()).resolves.toEqual({
      platform: "native",
      os: "ios",
      osVersion: "18.4",
      model: "iPhone15,2",
      manufacturer: "Apple",
      isVirtual: false,
      webViewVersion: "618.1",
    })
  })

  it("memoises — the record cannot change during the process lifetime", async () => {
    forceNative(true)
    await getDeviceInfo()
    await getDeviceInfo()
    expect(Device.getInfo).toHaveBeenCalledTimes(1)
  })

  it("degrades to the web record instead of rejecting when the plugin throws", async () => {
    forceNative(true)
    vi.mocked(Device.getInfo).mockRejectedValueOnce(
      new Error("not implemented"),
    )
    const info = await getDeviceInfo()
    //platform/os come from utils/platform and are always knowable; the rest is
    //honestly null rather than a fabricated value
    expect(info.platform).toBe("native")
    expect(info.model).toBeNull()
  })

  it("returns the per-install identifier", async () => {
    forceNative(true)
    await expect(getDeviceId()).resolves.toBe("abc-123")
  })
})

describe("device — web", () => {
  it("reports null for everything a browser will not say", async () => {
    forceNative(false)
    stubNavigatorProp("userAgentData", undefined)
    stubNavigatorProp(
      "userAgent",
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Version/17.0 Safari/605.1.15",
    )
    const info = await getDeviceInfo()
    expect(info.model).toBeNull()
    expect(info.manufacturer).toBeNull()
    //a browser cannot tell you it is running in a simulator — `null` says
    //"unknowable here", which is not the same claim as `false`
    expect(info.isVirtual).toBeNull()
    expect(info.webViewVersion).toBe("17.0")
  })

  it("reads the model from Chromium's high-entropy client hints", async () => {
    forceNative(false)
    stubNavigatorProp("userAgent", "Mozilla/5.0 (Linux; Android 14)")
    stubNavigatorProp("userAgentData", {
      getHighEntropyValues: () =>
        Promise.resolve({ platformVersion: "14", model: "Pixel 8" }),
    })
    const info = await getDeviceInfo()
    expect(info.model).toBe("Pixel 8")
    expect(info.osVersion).toBe("14")
  })

  it("still reports the UA os version when the hints are refused", async () => {
    forceNative(false)
    stubNavigatorProp(
      "userAgent",
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_4 like Mac OS X)",
    )
    stubNavigatorProp("userAgentData", {
      getHighEntropyValues: () => Promise.reject(new Error("blocked")),
    })
    const info = await getDeviceInfo()
    expect(info.osVersion).toBe("18.4")
    expect(info.model).toBeNull()
  })

  it("has no device id — and does not fingerprint one", async () => {
    forceNative(false)
    await expect(getDeviceId()).resolves.toBeNull()
    expect(Device.getId).not.toHaveBeenCalled()
  })
})

describe("device — the mutable half", () => {
  it("re-reads the language tag on every call", () => {
    stubNavigatorProp("language", "pt-PT")
    expect(getLanguageTag()).toBe("pt-PT")
    stubNavigatorProp("language", "en-GB")
    expect(getLanguageTag()).toBe("en-GB")
  })
})
