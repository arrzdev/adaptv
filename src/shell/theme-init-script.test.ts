import { afterEach, describe, expect, it, vi } from "vitest"
import type { RouteTint } from "#adaptv/shell/route-tints"
import {
  getUiThemeInitScript,
  PREFERENCE_ATTR,
  THEME_COLOR_META_ID,
} from "#adaptv/shell/theme-init-script"

//Runs the generated pre-paint script in the happy-dom document and returns the
//`color-scheme` meta it produced. The script is a string (it must run before React,
//at first paint), so evaluating it is the only way to prove what it stamps.
function runInitScript(preference?: string): HTMLMetaElement | null {
  document.head.innerHTML = ""
  document.documentElement.className = ""
  document.documentElement.removeAttribute(PREFERENCE_ATTR)
  try {
    localStorage.removeItem("ui-theme-preference")
  } catch {}
  if (preference) {
    document.documentElement.setAttribute(PREFERENCE_ATTR, preference)
  }
  const script = getUiThemeInitScript({
    themeColorLight: "#eeeeec",
    themeColorDark: "#0a0a0c",
    defaultThemePreference: "system",
  })
  new Function(script)()
  return document.querySelector('meta[name="color-scheme"]')
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("getUiThemeInitScript — color-scheme is pinned to the resolved theme", () => {
  //Why this matters: a static `color-scheme: light dark` lets the DEVICE theme drive
  //Chrome's WebAPK system-bar canvas, so an Android standalone PWA forced to dark still
  //shows light (white) / system-dark (Chrome's dark canvas) gutters. Pinning the meta
  //to the app's resolved theme is the lever under test.
  it("pins to a single value when the app forces dark", () => {
    expect(runInitScript("dark")?.content).toBe("dark")
  })

  it("pins to a single value when the app forces light", () => {
    expect(runInitScript("light")?.content).toBe("light")
  })

  it("uses `light dark` only in system-follow mode", () => {
    //system mode reads matchMedia; the value it resolves to is irrelevant here — what
    //matters is that the meta stays `light dark` so the OS may drive it.
    vi.stubGlobal("matchMedia", () => ({ matches: false }))
    expect(runInitScript("system")?.content).toBe("light dark")
  })
})

/**
 * Run the script at `pathname` and report BOTH chrome outputs.
 *
 * They are asserted together on purpose: the meta tag is the Android/Chrome and
 * iOS <= 18 path and the html paint is the iOS 26+ one, so a change that fixes
 * one and drops the other looks green from either side alone.
 */
function runAt(
  pathname: string,
  routeTints: RouteTint[],
  base = "/",
): { meta: string | undefined; html: string } {
  document.head.innerHTML = ""
  document.documentElement.className = ""
  document.documentElement.removeAttribute("style")
  document.documentElement.setAttribute(PREFERENCE_ATTR, "dark")
  try {
    localStorage.removeItem("ui-theme-preference")
  } catch {}
  //The script reads `location.pathname` — it runs before any router exists, so the
  //URL is the only thing it can ask. happy-dom's own control surface is the way to
  //move it; it is not in the DOM lib's types, hence the narrow cast.
  ;(
    window as unknown as { happyDOM: { setURL: (url: string) => void } }
  ).happyDOM.setURL(`https://app.test${pathname}`)
  new Function(
    getUiThemeInitScript({
      themeColorLight: "#eeeeec",
      themeColorDark: "#0a0a0c",
      defaultThemePreference: "system",
      routeTints,
      base,
    }),
  )()
  return {
    meta: (
      document.getElementById(
        THEME_COLOR_META_ID,
      ) as HTMLMetaElement | null
    )?.content,
    html: document.documentElement.style.backgroundColor,
  }
}

const TINTS: RouteTint[] = [
  { id: "/_p/settings", path: "/settings", tint: "#0b6e4f" },
  { id: "/_p/posts/$postId", path: "/posts/$postId", tint: "#8f2d56" },
]

describe("getUiThemeInitScript — a route that pins the chrome", () => {
  //This is the whole reason the tint is computed at build time rather than read
  //off the route: by the time a router exists, the first frame is already on
  //screen. If this test can be made to pass with the table absent, the option
  //has stopped doing the one thing it is for.
  it("paints the route's colour on both outputs, not the theme's", () => {
    expect(runAt("/settings", TINTS)).toEqual({
      meta: "#0b6e4f",
      html: "#0b6e4f",
    })
  })

  it("falls back to the theme colour for a route that declares nothing", () => {
    expect(runAt("/lab", TINTS)).toEqual({
      meta: "#0a0a0c",
      html: "#0a0a0c",
    })
  })

  it("matches a parameterised route", () => {
    expect(runAt("/posts/17", TINTS).meta).toBe("#8f2d56")
  })

  it("strips the base first, so a subpath deploy still matches", () => {
    //without this every tint silently misses on a non-root deploy — and the app
    //looks exactly like one that declared no tints at all
    expect(runAt("/app/settings", TINTS, "/app/").meta).toBe("#0b6e4f")
  })

  it("strips a base written without its slash the same way", () => {
    //the runtime shell passes `import.meta.env.BASE_URL`, which is `"/app"` under
    //`--base /app`; stripping that left `p/settings`, so every tint missed
    expect(runAt("/app/settings", TINTS, "/app").meta).toBe("#0b6e4f")
    //and `/app` is not a prefix of `/application`
    expect(runAt("/application/settings", TINTS, "/app").meta).toBe(
      "#0a0a0c",
    )
  })

  it("is the plain theme script when no route declares a tint", () => {
    expect(runAt("/settings", []).meta).toBe("#0a0a0c")
  })
})
