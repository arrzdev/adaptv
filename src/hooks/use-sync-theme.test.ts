import { createBrowserHistory } from "@tanstack/react-router"
import { renderHook } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  STATUS_BAR_RESAMPLE_HASH,
  useSyncTheme,
} from "#adaptv/hooks/use-sync-theme"
import {
  PREPAINT_TINT_ATTR,
  PREPAINT_TINT_VAR,
} from "#adaptv/shell/theme-init-script"

const LIGHT = "#eeeeec"
const DARK = "#0a0a0c"

afterEach(() => {
  document.documentElement.className = ""
  document.documentElement.removeAttribute("style")
  document.body.removeAttribute("style")
  document.getElementById("theme-color-class-override")?.remove()
})

function mount(enabled = true, chromeTint: string | null = null) {
  return renderHook(
    (props: { chromeTint: string | null }) =>
      useSyncTheme({
        themeColorLight: LIGHT,
        themeColorDark: DARK,
        chromeTint: props.chromeTint,
        enabled,
      }),
    { initialProps: { chromeTint } },
  )
}

function themeColorMeta(): HTMLMetaElement | null {
  return document.getElementById(
    "theme-color-class-override",
  ) as HTMLMetaElement | null
}

describe("useSyncTheme — the html/body paint is the load-bearing mechanism", () => {
  //B17: `<meta name="theme-color">` went INERT on iOS 26.0–26.5 — caniuse marks it
  //"supported, but does not actually use the color anywhere", and a WebKit engineer
  //confirmed Safari now derives the top-bar tint from the rendered html/body
  //background near the viewport edge instead.
  //@see https://bugs.webkit.org/show_bug.cgi?id=301756
  //
  //So on iOS 26+ the background paint below is not merely anti-flash — it IS the
  //status-bar tint. These tests exist because the paint looks redundant next to the
  //meta tag and is exactly the kind of thing a later cleanup deletes.
  it("paints html AND body regardless of theme-color support", () => {
    document.documentElement.classList.add("dark")
    mount()
    expect(document.documentElement.style.backgroundColor).toBeTruthy()
    expect(document.body.style.backgroundColor).toBeTruthy()
  })

  it("paints with !important so a stylesheet cannot win the top-edge tint", () => {
    document.documentElement.classList.add("light")
    mount()
    expect(
      document.documentElement.style.getPropertyPriority(
        "background-color",
      ),
    ).toBe("important")
    expect(
      document.body.style.getPropertyPriority("background-color"),
    ).toBe("important")
  })

  it("tracks the resolved theme on both surfaces, not just the meta", async () => {
    document.documentElement.classList.add("light")
    mount()
    const lightPaint = document.documentElement.style.backgroundColor
    expect(themeColorMeta()?.content).toBe(LIGHT)

    document.documentElement.classList.remove("light")
    document.documentElement.classList.add("dark")
    //the hook re-syncs off a MutationObserver on <html class>, and observer
    //callbacks are delivered on a microtask — not synchronously with the mutation
    await Promise.resolve()

    expect(document.documentElement.style.backgroundColor).not.toBe(
      lightPaint,
    )
    expect(themeColorMeta()?.content).toBe(DARK)
  })

  it("clears both the meta and the paint when disabled — no orphan tint", () => {
    document.documentElement.classList.add("dark")
    const { unmount } = mount()
    expect(themeColorMeta()).not.toBeNull()

    unmount()
    expect(themeColorMeta()).toBeNull()
    expect(document.documentElement.style.backgroundColor).toBe("")
    expect(document.body.style.backgroundColor).toBe("")
  })

  it("emits no theme-color and no paint when no theme class is resolved", () => {
    //neither `light` nor `dark` on <html> ⇒ nothing to sync; must not guess
    mount()
    expect(themeColorMeta()).toBeNull()
    expect(document.documentElement.style.backgroundColor).toBe("")
  })
})

describe("useSyncTheme — a route's own chromeTint", () => {
  const ROUTE = "#0b6e4f"

  it("outranks the theme on BOTH outputs", () => {
    //not one of them: the meta tag is the Android/Chrome and iOS <= 18 path, the
    //html/body paint is the iOS 26+ one. A route tint that moved only the tag
    //would do nothing at all on a current iPhone.
    document.documentElement.classList.add("dark")
    mount(true, ROUTE)
    expect(themeColorMeta()?.content).toBe(ROUTE)
    expect(document.documentElement.style.backgroundColor).toBe(ROUTE)
    expect(document.body.style.backgroundColor).toBe(ROUTE)
  })

  it("does NOT move when the theme flips — one colour, both themes", () => {
    document.documentElement.classList.add("light")
    mount(true, ROUTE)
    document.documentElement.classList.remove("light")
    document.documentElement.classList.add("dark")
    expect(themeColorMeta()?.content).toBe(ROUTE)
  })

  it("hands the chrome back to the THEME when the route stops declaring one", () => {
    //leaving a tinted route falls back to the app's global colours, never to
    //whatever the layout above it wanted
    document.documentElement.classList.add("dark")
    const view = mount(true, ROUTE)
    view.rerender({ chromeTint: null })
    expect(themeColorMeta()?.content).toBe(DARK)
    expect(document.documentElement.style.backgroundColor).toBe(DARK)
  })
})

describe("useSyncTheme — the pre-paint tint is handed over, not kept", () => {
  //The head script stamps a tinted route's colour on <html> for the critical CSS to
  //paint the body with, because the body does not exist when it runs.
  //Once this hook owns the paint that rule has nothing left to do, and anything it
  //still did would be wrong: it holds the COLD-LAUNCH route's colour, so after an
  //in-app navigation, or with the hook disabled, it would pin a tint nobody declares.
  const PREPAINT_ROUTE = "#0b6e4f"

  function prepaintStamp(color: string) {
    document.documentElement.setAttribute(PREPAINT_TINT_ATTR, "")
    document.documentElement.style.setProperty(PREPAINT_TINT_VAR, color)
  }

  function stamped() {
    return (
      document.documentElement.hasAttribute(PREPAINT_TINT_ATTR) ||
      document.documentElement.style.getPropertyValue(
        PREPAINT_TINT_VAR,
      ) !== ""
    )
  }

  it("removes the stamp once it has painted html and body itself", () => {
    document.documentElement.classList.add("light")
    prepaintStamp(PREPAINT_ROUTE)
    mount(true, PREPAINT_ROUTE)
    expect(stamped()).toBe(false)
    expect(document.body.style.backgroundColor).toBe(PREPAINT_ROUTE)
  })

  it("removes it when disabled too, so no tint outlives the hook", () => {
    document.documentElement.classList.add("light")
    prepaintStamp(PREPAINT_ROUTE)
    mount(false)
    expect(stamped()).toBe(false)
  })
})

/**
 * The OS appearance change in an installed web app, and the URL nudge that makes iOS
 * 26 re-derive the status-bar strip (the WebKit bug is described on
 * `resampleStatusBarFill` in the hook).
 */
describe("useSyncTheme — an installed iOS app's status bar after an OS appearance switch", () => {
  const PAGE = "https://app.test/tasks?filter=open"
  const IPHONE =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 26_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.1 Mobile/15E148 Safari/604.1"
  const ANDROID =
    "Mozilla/5.0 (Linux; Android 16; Pixel 10) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0 Mobile Safari/537.36"

  type Shell = "web" | "standalone" | "native"

  /**
   * Put the test in a shell on an OS, through the same signals `utils/platform.ts`
   * reads (`navigator.standalone`, `window.Capacitor`, the user agent), and hand back
   * a `prefers-color-scheme` query whose `change` the test fires.
   */
  function on(shell: Shell, ua: string) {
    ;(
      window as unknown as { happyDOM: { setURL: (url: string) => void } }
    ).happyDOM.setURL(PAGE)
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue(ua)
    Object.defineProperty(navigator, "standalone", {
      value: shell === "standalone",
      configurable: true,
    })
    if (shell === "native") {
      ;(globalThis as { Capacitor?: object }).Capacitor = {
        isNativePlatform: () => true,
        getPlatform: () => (ua === ANDROID ? "android" : "ios"),
      }
    }
    const scheme = Object.assign(new EventTarget(), {
      matches: false,
      media: "(prefers-color-scheme: dark)",
    })
    vi.spyOn(window, "matchMedia").mockImplementation(
      (query) =>
        (query === scheme.media
          ? scheme
          : { matches: false, media: query }) as unknown as MediaQueryList,
    )
    return {
      switchTo(dark: boolean) {
        scheme.matches = dark
        scheme.dispatchEvent(new Event("change"))
      },
    }
  }

  afterEach(() => {
    vi.restoreAllMocks()
    Reflect.deleteProperty(navigator, "standalone")
    Reflect.deleteProperty(globalThis, "Capacitor")
    document.head.querySelector("base")?.remove()
    //TanStack's destroy() puts the originals back as OWN properties on the
    //instance; left there, they would change what the next test exercises
    Reflect.deleteProperty(window.history, "replaceState")
    Reflect.deleteProperty(window.history, "pushState")
  })

  it("moves the URL away and back through History.prototype, keeping state", () => {
    const os = on("standalone", IPHONE)
    const state = { __TSR_key: "k1", __TSR_index: 3 }
    History.prototype.replaceState.call(window.history, state, "", PAGE)
    const native = vi.spyOn(History.prototype, "replaceState")
    mount()

    os.switchTo(true)

    expect(native).toHaveBeenCalledTimes(2)
    expect(native.mock.calls[0]?.[2]).toBe(
      `${PAGE}${STATUS_BAR_RESAMPLE_HASH}`,
    )
    expect(native.mock.calls[1]?.[2]).toBe(PAGE)
    expect(window.location.href).toBe(PAGE)
    expect(window.history.state).toEqual(state)
  })

  it("is invisible to TanStack's browser history, which wraps the instance method", () => {
    //the real wrapper, not a stand-in: an upgrade that changes how the router
    //hears about replaceState must turn this red, not leave a stub green
    const os = on("standalone", IPHONE)
    const router = createBrowserHistory()
    try {
      const before = {
        href: router.location.href,
        key: window.history.state?.__TSR_key,
      }
      const heard = vi.fn()
      const unsubscribe = router.subscribe(heard)
      mount()

      os.switchTo(true)

      expect(window.history.replaceState).not.toBe(
        History.prototype.replaceState,
      )
      expect(heard).not.toHaveBeenCalled()
      expect(router.location.href).toBe(before.href)
      expect(window.history.state?.__TSR_key).toBe(before.key)
      unsubscribe()
    } finally {
      router.destroy()
    }
  })

  it("builds both URLs from the page's href, so a <base> cannot move the path", () => {
    const os = on("standalone", IPHONE)
    const base = document.createElement("base")
    base.href = "https://app.test/elsewhere/"
    document.head.append(base)
    const native = vi.spyOn(History.prototype, "replaceState")
    mount()

    os.switchTo(true)

    expect(native.mock.calls[0]?.[2]).toBe(
      `${PAGE}${STATUS_BAR_RESAMPLE_HASH}`,
    )
    expect(window.location.href).toBe(PAGE)
  })

  it("still moves the URL when it already carries the detour hash", () => {
    const os = on("standalone", IPHONE)
    const here = `${PAGE}${STATUS_BAR_RESAMPLE_HASH}`
    ;(
      window as unknown as { happyDOM: { setURL: (url: string) => void } }
    ).happyDOM.setURL(here)
    const native = vi.spyOn(History.prototype, "replaceState")
    mount()

    os.switchTo(true)

    expect(native).toHaveBeenCalledTimes(2)
    expect(native.mock.calls[0]?.[2]).not.toBe(here)
    expect(window.location.href).toBe(here)
  })

  it("does nothing in a browser tab, a native build or an Android install", () => {
    const cases: Array<[Shell, string]> = [
      ["web", IPHONE],
      ["native", IPHONE],
      ["standalone", ANDROID],
    ]
    for (const [shell, ua] of cases) {
      const os = on(shell, ua)
      const native = vi.spyOn(History.prototype, "replaceState")
      const { unmount } = mount()
      os.switchTo(true)
      expect(
        native,
        `${shell} on ${ua.slice(13, 20)}`,
      ).not.toHaveBeenCalled()
      unmount()
      vi.restoreAllMocks()
      Reflect.deleteProperty(globalThis, "Capacitor")
    }
  })

  it("stops listening on unmount", () => {
    const os = on("standalone", IPHONE)
    const { unmount } = mount()
    unmount()
    const native = vi.spyOn(History.prototype, "replaceState")
    os.switchTo(true)
    expect(native).not.toHaveBeenCalled()
  })
})
