import { SplashScreen } from "@capacitor/splash-screen"
import { afterEach, describe, expect, it, vi } from "vitest"
import { hideNativeSplash } from "#nativ/capabilities/splash"

vi.mock("@capacitor/splash-screen", () => ({
  SplashScreen: { hide: vi.fn(() => Promise.resolve()) },
}))

function forceNative(native: boolean): void {
  vi.stubGlobal(
    "Capacitor",
    native ? { isNativePlatform: () => true } : undefined,
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe("hideNativeSplash", () => {
  it("hides the native splash on a native build", () => {
    forceNative(true)
    hideNativeSplash()
    expect(SplashScreen.hide).toHaveBeenCalledOnce()
  })

  it("is a no-op on web and never throws", () => {
    forceNative(false)
    expect(() => hideNativeSplash()).not.toThrow()
    expect(SplashScreen.hide).not.toHaveBeenCalled()
  })
})
