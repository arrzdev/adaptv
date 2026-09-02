import { PrivacyScreen } from "@capacitor/privacy-screen"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  disablePrivacyScreen,
  enablePrivacyScreen,
  getPrivacyScreenCaveat,
  getPrivacyScreenSupport,
  readPrivacyScreen,
} from "#adaptv/capabilities/privacy-screen"
import { hasNativePlugin } from "#adaptv/utils/native-plugins"
import { isIOS, isNativePlatform } from "#adaptv/utils/platform"

vi.mock("@capacitor/privacy-screen", () => ({
  PrivacyScreen: {
    enable: vi.fn(async () => ({ success: true })),
    disable: vi.fn(async () => ({ success: true })),
    isEnabled: vi.fn(async () => ({ enabled: true })),
  },
}))

vi.mock("#adaptv/utils/platform", () => ({
  isIOS: vi.fn(() => false),
  isNativePlatform: vi.fn(() => false),
}))

vi.mock("#adaptv/utils/native-plugins", () => ({
  hasNativePlugin: vi.fn(() => true),
}))

function native(ios: boolean, plugin = true) {
  vi.mocked(isNativePlatform).mockReturnValue(true)
  vi.mocked(isIOS).mockReturnValue(ios)
  vi.mocked(hasNativePlugin).mockReturnValue(plugin)
}

beforeEach(() => {
  vi.mocked(isIOS).mockReturnValue(false)
  vi.mocked(isNativePlatform).mockReturnValue(false)
  vi.mocked(hasNativePlugin).mockReturnValue(true)
  vi.mocked(PrivacyScreen.enable).mockResolvedValue({ success: true })
  vi.mocked(PrivacyScreen.disable).mockResolvedValue({ success: true })
  vi.mocked(PrivacyScreen.isEnabled).mockResolvedValue({ enabled: true })
  vi.stubGlobal("matchMedia", () => ({ matches: false }))
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe("privacy screen — where nothing can take it", () => {
  it("the web reads unsupported, every call resolves unsupported, and the plugin is never touched", async () => {
    expect(getPrivacyScreenSupport()).toBe("unsupported")
    expect(await enablePrivacyScreen()).toBe("unsupported")
    expect(await disablePrivacyScreen()).toBe("unsupported")
    expect(await readPrivacyScreen()).toBeNull()
    expect(PrivacyScreen.enable).not.toHaveBeenCalled()
    expect(PrivacyScreen.isEnabled).not.toHaveBeenCalled()
    expect(getPrivacyScreenCaveat()).toMatch(/no browser/i)
  })

  it("a binary built before the plugin reads unsupported, and the caveat says a rebuild carries it", async () => {
    native(true, false)
    expect(getPrivacyScreenSupport()).toBe("unsupported")
    expect(await enablePrivacyScreen()).toBe("unsupported")
    expect(PrivacyScreen.enable).not.toHaveBeenCalled()
    expect(getPrivacyScreenCaveat()).toMatch(/rebuild/i)
  })
})

describe("privacy screen — on a binary that carries it", () => {
  it("enables with the splash cover by default and reports applied", async () => {
    native(false)
    expect(getPrivacyScreenSupport()).toBe("available")
    expect(await enablePrivacyScreen()).toBe("applied")
    expect(PrivacyScreen.enable).toHaveBeenCalledWith({
      ios: { blurEffect: "none" },
      android: { dimBackground: false },
    })
  })

  it("the obscure cover blurs iOS by the colour scheme and dims Android", async () => {
    native(true)
    await enablePrivacyScreen({ cover: "obscure" })
    expect(PrivacyScreen.enable).toHaveBeenLastCalledWith({
      ios: { blurEffect: "light" },
      android: { dimBackground: true },
    })
    vi.stubGlobal("matchMedia", () => ({ matches: true }))
    await enablePrivacyScreen({ cover: "obscure" })
    expect(PrivacyScreen.enable).toHaveBeenLastCalledWith({
      ios: { blurEffect: "dark" },
      android: { dimBackground: true },
    })
  })

  it("disables and reads the OS's answer back", async () => {
    native(false)
    expect(await disablePrivacyScreen()).toBe("applied")
    expect(PrivacyScreen.disable).toHaveBeenCalledTimes(1)
    vi.mocked(PrivacyScreen.isEnabled).mockResolvedValue({
      enabled: false,
    })
    expect(await readPrivacyScreen()).toBe(false)
    vi.mocked(PrivacyScreen.isEnabled).mockResolvedValue({ enabled: true })
    expect(await readPrivacyScreen()).toBe(true)
  })

  it("a plugin that answers no success, or rejects, is failed — never a throw", async () => {
    native(false)
    vi.mocked(PrivacyScreen.enable).mockResolvedValue({ success: false })
    expect(await enablePrivacyScreen()).toBe("failed")
    vi.mocked(PrivacyScreen.enable).mockRejectedValue(new Error("bridge"))
    expect(await enablePrivacyScreen()).toBe("failed")
    vi.mocked(PrivacyScreen.disable).mockRejectedValue(new Error("bridge"))
    expect(await disablePrivacyScreen()).toBe("failed")
    vi.mocked(PrivacyScreen.isEnabled).mockRejectedValue(
      new Error("bridge"),
    )
    expect(await readPrivacyScreen()).toBeNull()
  })

  it("the caveat names what each OS can do: iOS covers the switcher only, Android blocks the capture", () => {
    native(true)
    expect(getPrivacyScreenCaveat()).toMatch(/switcher/)
    expect(getPrivacyScreenCaveat()).toMatch(
      /no way to block a screenshot/,
    )
    native(false)
    expect(getPrivacyScreenCaveat()).toMatch(/FLAG_SECURE/)
    expect(getPrivacyScreenCaveat()).toMatch(/black/)
  })
})
