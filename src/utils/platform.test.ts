import { afterEach, describe, expect, it, vi } from "vitest"
import type { AdaptvUiConfig } from "#adaptv/config/app-config"
import {
  applyPlatformStamp,
  getOS,
  getPlatformInitScript,
  isInstalledApp,
  isIOS,
  isNativePlatform,
  isStandaloneDisplay,
  normalizeUiScope,
  resolvePlatformTag,
  resolveUiStamp,
  UI_STAMPS,
} from "#adaptv/utils/platform"

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
  delete document.documentElement.dataset.adaptvPlatform
  delete document.documentElement.dataset.adaptvOs
  //drive the cleanup off the table itself — a new stamp must not be able to leak
  //into the next test just because someone forgot to add a line here
  for (const [, attr] of UI_STAMPS) {
    document.documentElement.removeAttribute(attr)
  }
})

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

// The script is a string (it runs pre-hydration and can't import this module), so
// we assert the CONTRACT: eval'ing it stamps <html data-adaptv-platform/-os> to the
// same values resolvePlatformTag/getOS would produce.
describe("getPlatformInitScript", () => {
  function run(ui?: AdaptvUiConfig): void {
    new Function(getPlatformInitScript(ui))()
  }

  it("is a self-invoking guarded script", () => {
    const src = getPlatformInitScript()
    expect(src.startsWith("(function")).toBe(true)
    expect(src).toContain("adaptvPlatform")
    expect(src).toContain("adaptvOs")
  })

  it("stamps 'web' in a plain browser tab", () => {
    stubStandaloneMedia(false)
    stubNavigator({
      userAgent: UA_DESKTOP,
      platform: "MacIntel",
      maxTouchPoints: 0,
    })
    run()
    expect(document.documentElement.dataset.adaptvPlatform).toBe("web")
    expect(document.documentElement.dataset.adaptvOs).toBe("web")
  })

  it("stamps 'native' + the Capacitor OS on a native build", () => {
    stubCapacitor({
      isNativePlatform: () => true,
      getPlatform: () => "ios",
    })
    run()
    expect(document.documentElement.dataset.adaptvPlatform).toBe("native")
    expect(document.documentElement.dataset.adaptvOs).toBe("ios")
  })

  it("never throws even if globals are missing (guarded)", () => {
    expect(() => run()).not.toThrow()
  })
})

// `config × platform` is resolved ONCE, here, and expressed as a boolean-presence
// attribute — that is what keeps styles.css a single static artifact instead of a
// per-config build matrix. So the resolution table is the contract worth pinning.

describe("normalizeUiScope", () => {
  it("passes the three literals through", () => {
    expect(normalizeUiScope("app")).toBe("app")
    expect(normalizeUiScope("all")).toBe("all")
    expect(normalizeUiScope("off")).toBe("off")
  })

  it("falls back to the documented default for anything else", () => {
    //this is the defensive half: the value reaches a pre-paint script, and a typo
    //in adaptv.config.ts must not be able to leave the page unstamped
    for (const bad of [undefined, null, "", "APP", 1, {}, []]) {
      expect(normalizeUiScope(bad)).toBe("app")
    }
  })
})

describe("resolveUiStamp", () => {
  it("is the config × platform table", () => {
    const table: Array<[Parameters<typeof resolveUiStamp>[0], boolean[]]> =
      [
        //                      web    standalone  native
        ["app", [false, true, true]],
        ["all", [true, true, true]],
        ["off", [false, false, false]],
      ]
    for (const [scope, expected] of table) {
      expect([
        resolveUiStamp(scope, "web"),
        resolveUiStamp(scope, "standalone"),
        resolveUiStamp(scope, "native"),
      ]).toEqual(expected)
    }
  })
})

describe("getPlatformInitScript — ui stamps", () => {
  function run(ui?: AdaptvUiConfig): void {
    new Function(getPlatformInitScript(ui))()
  }

  function stamped(attr: string): boolean {
    return document.documentElement.hasAttribute(attr)
  }

  /*
   * The defaults are NOT uniform, and the split is the design. An option whose
   * reset a component can escape from can afford to be strict; one with no escape
   * cannot. `hideScrollbars` has an escape (`ScrollView showsVerticalScrollIndicator`
   * emits `scrollbar-visible`, which outranks the reset from a later cascade layer),
   * so it defaults to `"all"` and the same code looks the same on every target.
   * `noSelect` and `touchCallout` have none — a `user-select: none` in a real tab
   * means the user cannot select an error message or Ctrl+A the page, and a
   * suppressed callout means they cannot long-press a link to copy it — so those
   * stay `"app"`.
   */
  it("leaves the escapable-free resets alone in a browser tab by default", () => {
    stubStandaloneMedia(false)
    run()
    expect(stamped("data-adaptv-no-select")).toBe(false)
    expect(stamped("data-adaptv-no-touch-callout")).toBe(false)
    expect(
      stamped("data-adaptv-hide-scrollbars"),
      "scrollbars are hidden everywhere — the per-scroller prop is the way back",
    ).toBe(true)
  })

  it("stamps all of them by default in an installed app", () => {
    stubStandaloneMedia(true)
    run()
    for (const [, attr] of UI_STAMPS) expect(stamped(attr)).toBe(true)
  })

  it("honours 'all' in a browser tab and 'off' in an installed app", () => {
    stubStandaloneMedia(false)
    run({ noSelect: "all", hideScrollbars: "off", touchCallout: "all" })
    expect(stamped("data-adaptv-no-select")).toBe(true)
    expect(stamped("data-adaptv-hide-scrollbars")).toBe(false)
    expect(stamped("data-adaptv-no-touch-callout")).toBe(true)

    stubCapacitor({ isNativePlatform: () => true })
    run({ noSelect: "off", hideScrollbars: "all", touchCallout: "off" })
    expect(stamped("data-adaptv-no-select")).toBe(false)
    expect(stamped("data-adaptv-hide-scrollbars")).toBe(true)
    expect(stamped("data-adaptv-no-touch-callout")).toBe(false)
  })

  it("survives a malformed config without losing the platform stamp", () => {
    //the script runs pre-paint on every boot on every target. a bad `ui` value must
    //degrade to the default, never throw — a throw would skip the platform stamp
    //too, which silently disables every `app:` variant and safe-area padding.
    stubStandaloneMedia(true)
    const malformed = {
      noSelect: 42,
      hideScrollbars: null,
      touchCallout: { scope: "app" },
    } as unknown as AdaptvUiConfig
    expect(() => run(malformed)).not.toThrow()
    expect(document.documentElement.dataset.adaptvPlatform).toBe(
      "standalone",
    )
    for (const [, attr] of UI_STAMPS) expect(stamped(attr)).toBe(true)
  })
})

describe("applyPlatformStamp — ui stamps", () => {
  it("re-applies the stamps React drops when it reconciles <html>", () => {
    stubStandaloneMedia(true)
    applyPlatformStamp()
    expect(document.documentElement.dataset.adaptvPlatform).toBe(
      "standalone",
    )
    expect(
      document.documentElement.hasAttribute("data-adaptv-no-select"),
    ).toBe(true)
  })

  it("REMOVES a stamp the config turned off, rather than leaving it stale", () => {
    stubStandaloneMedia(true)
    document.documentElement.setAttribute("data-adaptv-no-select", "")
    applyPlatformStamp({ noSelect: "off" })
    expect(
      document.documentElement.hasAttribute("data-adaptv-no-select"),
    ).toBe(false)
  })

  it("agrees with the init script it re-runs", () => {
    //two implementations of one table (a string for pre-paint, TS for the effect)
    //is exactly the pair that drifts, so pin them to each other
    stubStandaloneMedia(false)
    const ui: AdaptvUiConfig = {
      noSelect: "all",
      hideScrollbars: "app",
      touchCallout: "all",
    }
    const readAll = () =>
      UI_STAMPS.map(([, attr]) =>
        document.documentElement.hasAttribute(attr),
      )
    new Function(getPlatformInitScript(ui))()
    const fromScript = readAll()
    applyPlatformStamp(ui)
    expect(readAll()).toEqual(fromScript)
    //and it actually decided something, rather than agreeing on all-false
    expect(fromScript).toEqual([true, false, true])
  })
})
