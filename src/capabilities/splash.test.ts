import { SplashScreen } from "@capacitor/splash-screen"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  hideNativeSplash,
  NATIVE_SPLASH_FADE_MS,
} from "#adaptv/capabilities/splash"

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

  it("is a no-op on web and never throws", async () => {
    forceNative(false)
    expect(() => hideNativeSplash()).not.toThrow()
    await expect(hideNativeSplash()).resolves.toBeUndefined()
    expect(SplashScreen.hide).not.toHaveBeenCalled()
  })

  //`revealedAt` is timed off this promise, so it has to mean "the splash is off the
  //screen" — not "the bridge took the call". iOS resolves `hide()` the instant it
  //dispatches the fade, which is ~200ms before anything is visible underneath.
  it("resolves on the fade, not on the bridge acknowledgement", async () => {
    vi.useFakeTimers()
    try {
      forceNative(true)
      const settled = vi.fn()
      void hideNativeSplash().then(settled)

      await vi.advanceTimersByTimeAsync(NATIVE_SPLASH_FADE_MS - 1)
      expect(settled).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(1)
      expect(settled).toHaveBeenCalledOnce()
    } finally {
      vi.useRealTimers()
    }
  })

  //and it must never be hostage to that acknowledgement either: a bridge that
  //hangs would otherwise strand the app behind its own splash for good
  it("resolves even when the plugin call never settles", async () => {
    vi.useFakeTimers()
    try {
      forceNative(true)
      vi.mocked(SplashScreen.hide).mockReturnValueOnce(
        new Promise(() => {}),
      )
      const settled = vi.fn()
      void hideNativeSplash().then(settled)

      await vi.advanceTimersByTimeAsync(NATIVE_SPLASH_FADE_MS)
      expect(settled).toHaveBeenCalledOnce()
    } finally {
      vi.useRealTimers()
    }
  })

  //the call is never awaited, so a rejection (a binary without the plugin, an OS
  //error) has no handler but the window's `unhandledrejection` event.
  //A plain function, not a `vi.fn`: a spy handles every promise it returns.
  it("lets no rejected hide() escape, and still resolves on the fade", async () => {
    forceNative(true)
    const original = SplashScreen.hide
    Object.assign(SplashScreen, {
      hide: () =>
        Promise.reject(new Error("SplashScreen is not implemented")),
    })
    const seen: unknown[] = []
    const listener = (reason: unknown) => seen.push(reason)
    process.on("unhandledRejection", listener)
    try {
      await expect(hideNativeSplash()).resolves.toBeUndefined()
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(seen).toEqual([])
    } finally {
      process.off("unhandledRejection", listener)
      Object.assign(SplashScreen, { hide: original })
    }
  })
})
