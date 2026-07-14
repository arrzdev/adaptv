import { afterEach, describe, expect, it, vi } from "vitest"
import {
  getOS,
  getPlatformInitScript,
  isInstalledApp,
  isIOS,
  isNativePlatform,
  isStandaloneDisplay,
  resolvePlatformTag,
} from "#nativ/utils/platform"

// ---- global stubs ----------------------------------------------------------
// platform.ts reads three ambient signals: the Capacitor global, navigator
// (UA/platform/maxTouchPoints/standalone), and matchMedia(display-mode). We stub
// each and restore after every test so cases don't leak.

const restores: Array<() => void> = []

function stubNavigator(props: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(props)) {
    const prev = Object.getOwnPropertyDescriptor(navigator, key)
    Object.defineProperty(navigator, key, { value, configurable: true })
    restores.push(() => {
      if (prev) Object.defineProperty(navigator, key, prev)
      else delete (navigator as unknown as Record<string, unknown>)[key]
    })
  }
}

function stubStandaloneMedia(matches: boolean): void {
  vi.spyOn(window, "matchMedia").mockImplementation(
    (query: string) =>
      ({
        matches: /display-mode:\s*standalone/.test(query)
          ? matches
          : false,
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      }) as unknown as MediaQueryList,
  )
}

function stubCapacitor(value: unknown): void {
  vi.stubGlobal("Capacitor", value)
}

const UA_IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15"
const UA_ANDROID =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36"
const UA_DESKTOP =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"

afterEach(() => {
  for (const restore of restores.splice(0)) restore()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  delete document.documentElement.dataset.nativPlatform
  delete document.documentElement.dataset.nativOs
})

// ---- isNativePlatform ------------------------------------------------------
describe("isNativePlatform", () => {
  it("is false with no Capacitor global (plain web)", () => {
    expect(isNativePlatform()).toBe(false)
  })

  it("is true when Capacitor reports native", () => {
    stubCapacitor({ isNativePlatform: () => true })
    expect(isNativePlatform()).toBe(true)
  })

  it("is false when Capacitor reports non-native (web impl loaded)", () => {
    stubCapacitor({ isNativePlatform: () => false })
    expect(isNativePlatform()).toBe(false)
  })

  it("is false when Capacitor exists but lacks the method", () => {
    stubCapacitor({})
    expect(isNativePlatform()).toBe(false)
  })
})

// ---- getOS -----------------------------------------------------------------
describe("getOS", () => {
  it("trusts Capacitor.getPlatform when native", () => {
    stubCapacitor({
      isNativePlatform: () => true,
      getPlatform: () => "ios",
    })
    expect(getOS()).toBe("ios")
    stubCapacitor({
      isNativePlatform: () => true,
      getPlatform: () => "android",
    })
    expect(getOS()).toBe("android")
  })

  it("sniffs iOS from the UA in a web browser", () => {
    stubNavigator({
      userAgent: UA_IPHONE,
      platform: "iPhone",
      maxTouchPoints: 5,
    })
    expect(getOS()).toBe("ios")
  })

  it("detects iPadOS reporting as MacIntel", () => {
    stubNavigator({
      userAgent: UA_DESKTOP,
      platform: "MacIntel",
      maxTouchPoints: 5,
    })
    expect(getOS()).toBe("ios")
  })

  it("sniffs Android from the UA", () => {
    stubNavigator({
      userAgent: UA_ANDROID,
      platform: "Linux",
      maxTouchPoints: 5,
    })
    expect(getOS()).toBe("android")
  })

  it("is 'web' on desktop", () => {
    stubNavigator({
      userAgent: UA_DESKTOP,
      platform: "MacIntel",
      maxTouchPoints: 0,
    })
    expect(getOS()).toBe("web")
  })
})

// ---- isIOS -----------------------------------------------------------------
describe("isIOS", () => {
  it("matches iPhone UA and iPadOS-as-Mac, not desktop", () => {
    stubNavigator({
      userAgent: UA_IPHONE,
      platform: "iPhone",
      maxTouchPoints: 5,
    })
    expect(isIOS()).toBe(true)
    for (const restore of restores.splice(0)) restore()
    stubNavigator({
      userAgent: UA_DESKTOP,
      platform: "MacIntel",
      maxTouchPoints: 0,
    })
    expect(isIOS()).toBe(false)
  })
})

// ---- isStandaloneDisplay ---------------------------------------------------
describe("isStandaloneDisplay", () => {
  it("is true when display-mode:standalone matches", () => {
    stubStandaloneMedia(true)
    expect(isStandaloneDisplay()).toBe(true)
  })

  it("is true via legacy navigator.standalone (iOS Safari)", () => {
    stubStandaloneMedia(false)
    stubNavigator({ standalone: true })
    expect(isStandaloneDisplay()).toBe(true)
  })

  it("is false in a plain browser tab", () => {
    stubStandaloneMedia(false)
    expect(isStandaloneDisplay()).toBe(false)
  })
})

// ---- isInstalledApp --------------------------------------------------------
describe("isInstalledApp", () => {
  it("is true when native, even without standalone display", () => {
    stubCapacitor({ isNativePlatform: () => true })
    stubStandaloneMedia(false)
    expect(isInstalledApp()).toBe(true)
  })

  it("is true for a standalone PWA (not native)", () => {
    stubStandaloneMedia(true)
    expect(isInstalledApp()).toBe(true)
  })

  it("is false in a browser tab", () => {
    stubStandaloneMedia(false)
    expect(isInstalledApp()).toBe(false)
  })
})

// ---- resolvePlatformTag ----------------------------------------------------
describe("resolvePlatformTag", () => {
  it("prefers native over standalone over web", () => {
    stubCapacitor({ isNativePlatform: () => true })
    stubStandaloneMedia(true)
    expect(resolvePlatformTag()).toBe("native")
  })

  it("is 'standalone' for an installed PWA", () => {
    stubStandaloneMedia(true)
    expect(resolvePlatformTag()).toBe("standalone")
  })

  it("is 'web' in a browser tab", () => {
    stubStandaloneMedia(false)
    expect(resolvePlatformTag()).toBe("web")
  })
})

// ---- getPlatformInitScript -------------------------------------------------
// The script is a string (it runs pre-hydration and can't import this module), so
// we assert the CONTRACT: eval'ing it stamps <html data-nativ-platform/-os> to the
// same values resolvePlatformTag/getOS would produce.
describe("getPlatformInitScript", () => {
  function run(): void {
    new Function(getPlatformInitScript())()
  }

  it("is a self-invoking guarded script", () => {
    const src = getPlatformInitScript()
    expect(src.startsWith("(function")).toBe(true)
    expect(src).toContain("nativPlatform")
    expect(src).toContain("nativOs")
  })

  it("stamps 'web' in a plain browser tab", () => {
    stubStandaloneMedia(false)
    stubNavigator({
      userAgent: UA_DESKTOP,
      platform: "MacIntel",
      maxTouchPoints: 0,
    })
    run()
    expect(document.documentElement.dataset.nativPlatform).toBe("web")
    expect(document.documentElement.dataset.nativOs).toBe("web")
  })

  it("stamps 'native' + the Capacitor OS on a native build", () => {
    stubCapacitor({
      isNativePlatform: () => true,
      getPlatform: () => "ios",
    })
    run()
    expect(document.documentElement.dataset.nativPlatform).toBe("native")
    expect(document.documentElement.dataset.nativOs).toBe("ios")
  })

  it("never throws even if globals are missing (guarded)", () => {
    expect(() => run()).not.toThrow()
  })
})
