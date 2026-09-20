import { afterEach, describe, expect, it, vi } from "vitest"
import { getCriticalShellCss } from "#adaptv/shell/critical-css"
import type { RouteTint } from "#adaptv/shell/route-tints"
import {
  getUiThemeInitScript,
  PREFERENCE_ATTR,
  PREPAINT_TINT_ATTR,
  PREPAINT_TINT_VAR,
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

/**
 * The BODY, before anything but the head script and the critical CSS has run.
 *
 * iOS 26 takes both bars from the page's painted edge, and the body is that edge: it
 * covers `html` wherever it has a box. The critical CSS paints `html.dark body` with the
 * THEME colour, so an `html`-only tint was hidden under it until `useSyncTheme` painted
 * the body after hydration — measured on an iOS 26.1 simulator as ~557 ms of theme
 * colour in both bars on a cold launch of a tinted route.
 */
function bodyAt(pathname: string, routeTints: RouteTint[]): string {
  document.documentElement.removeAttribute(PREPAINT_TINT_ATTR)
  runAt(pathname, routeTints)
  //the shell emits the critical CSS ahead of the script; order does not decide the
  //outcome here (importance does), but the document should look like the real one
  const critical = document.createElement("style")
  critical.textContent = getCriticalShellCss("#eeeeec", "#0a0a0c", false)
  document.head.prepend(critical)
  return getComputedStyle(document.body).backgroundColor
}

describe("getUiThemeInitScript — the body is painted before the app runs", () => {
  afterEach(() => {
    document.documentElement.removeAttribute(PREPAINT_TINT_ATTR)
    document.documentElement.removeAttribute("style")
    document.head.innerHTML = ""
  })

  it("paints a tinted route's colour on the body, over the critical CSS", () => {
    expect(bodyAt("/settings", TINTS)).toBe("#0b6e4f")
    //through <html>, not a node in <head>: a head node the script adds lands among
    //the server-rendered ones and React's hydration of the document trips on it
    expect(
      document.documentElement.style.getPropertyValue(PREPAINT_TINT_VAR),
    ).toBe("#0b6e4f")
  })

  it("does not stamp a tint the engine rejects, so the theme still paints", () => {
    //the build-time scan only checks for a string literal; an invalid colour
    //through var() computes to transparent in a browser and would beat the theme
    //rules. happy-dom does not compute that, so the body colour cannot prove it
    //here: the absent stamp is the guard, since without it no rule reads the var
    runAt("/settings", [
      { id: "/_p/settings", path: "/settings", tint: "brand-green" },
    ])
    expect(document.documentElement.hasAttribute(PREPAINT_TINT_ATTR)).toBe(
      false,
    )
    expect(
      document.documentElement.style.getPropertyValue(PREPAINT_TINT_VAR),
    ).toBe("")
  })

  it("leaves the body to the critical CSS on a route that declares nothing", () => {
    expect(bodyAt("/lab", TINTS)).toBe("#0a0a0c")
    //and adds nothing that could pin a colour across a theme switch before hydration
    expect(document.documentElement.hasAttribute(PREPAINT_TINT_ATTR)).toBe(
      false,
    )
  })
})
