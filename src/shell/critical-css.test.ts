import { describe, expect, it } from "vitest"
import { SPLASH_REVEALED_ATTR } from "#adaptv/hooks/use-splash-handoff"
import { BOOT_FAILED_ATTR } from "#adaptv/shell/boot-fallback"
import { getCriticalShellCss } from "#adaptv/shell/critical-css"
import {
  PREPAINT_TINT_ATTR,
  PREPAINT_TINT_VAR,
} from "#adaptv/shell/theme-init-script"

const LIGHT = "#eeeeec"
const DARK = "#0a0a0c"

// The splash overlay is gated pre-paint off the `data-adaptv-platform` stamp so the
// custom splash only paints where the policy allows — never a post-hydration flash.
describe("getCriticalShellCss — splash policy gate", () => {
  it("hides the custom splash in a browser tab by default (installed-only)", () => {
    const css = getCriticalShellCss(LIGHT, DARK, false)
    expect(css).toContain(
      `html[data-adaptv-platform="web"] [data-adaptv-splash]{display:none!important}`,
    )
  })

  it("never gates native or standalone (they always show the splash)", () => {
    const css = getCriticalShellCss(LIGHT, DARK, false)
    // the only splash-hiding rule targets the browser (`web`) tag
    expect(css).not.toContain(
      `html[data-adaptv-platform="native"] [data-adaptv-splash]{display:none`,
    )
    expect(css).not.toContain(
      `html[data-adaptv-platform="standalone"] [data-adaptv-splash]{display:none`,
    )
  })

  it("shows the splash everywhere when splashScreenInBrowser is opted in", () => {
    const css = getCriticalShellCss(LIGHT, DARK, true)
    expect(css).not.toContain("[data-adaptv-splash]{display:none")
  })

  //The splash is painted UNDER the OS launch splash, so its animations would run for
  //nobody and be part-way through by the time it is seen. They are held at frame one
  //until the handoff stamps `<html>`.
  it("holds the splash's animations until the handoff stamps <html>", () => {
    const css = getCriticalShellCss(LIGHT, DARK, false)
    expect(css).toContain(
      `html:not([data-adaptv-splash-revealed]) [data-adaptv-splash] *{animation-play-state:paused!important}`,
    )
  })

  //the CSS and the shell must name the same attribute — they are in different files
  //and nothing else would notice a rename until a splash animation silently froze
  it("keys the hold off the attribute the handoff actually writes", () => {
    const css = getCriticalShellCss(LIGHT, DARK, false)
    expect(css).toContain(`html:not([${SPLASH_REVEALED_ATTR}])`)
  })

  it("lets the hold go once the attribute is there (no permanent freeze)", () => {
    const css = getCriticalShellCss(LIGHT, DARK, false)
    //every paused rule is scoped by the :not() — nothing pauses unconditionally
    const paused = css
      .split("}")
      .filter((rule) => rule.includes("animation-play-state:paused"))
    expect(paused.length).toBeGreaterThan(0)
    for (const rule of paused)
      expect(rule).toContain(`:not([${SPLASH_REVEALED_ATTR}])`)
  })

  it("still paints the brand background pre-paint (anti-flash) both themes", () => {
    const css = getCriticalShellCss(LIGHT, DARK, false)
    expect(css).toContain(`background-color:${LIGHT}`)
    expect(css).toContain(`background-color:${DARK}`)
  })
})

//The head script can reach <html> but not <body>, and the base rules paint the body in
//the THEME colour over html. This rule is how a route's tint reaches the body before
//hydration; the names are written into the CSS string by hand, so pin them to the
//constants the script and `useSyncTheme` use.
describe("getCriticalShellCss — a route's tint before hydration", () => {
  const stamped = `html[${PREPAINT_TINT_ATTR}]:not([${BOOT_FAILED_ATTR}])`

  it("paints html and body from the script's stamp, over the theme rules", () => {
    expect(getCriticalShellCss(LIGHT, DARK, false)).toContain(
      `${stamped},${stamped} body{background-color:var(${PREPAINT_TINT_VAR})!important}`,
    )
  })

  //the boot fallback inherits the body's colour and sets theme-coloured text on it;
  //when the bundle fails nothing removes the stamp, so the tint must step aside
  it("steps aside once the boot fallback is showing", () => {
    const css = getCriticalShellCss(LIGHT, DARK, false)
    document.head.innerHTML = `<style>${css}</style>`
    document.documentElement.className = "light"
    document.documentElement.setAttribute(PREPAINT_TINT_ATTR, "")
    document.documentElement.style.setProperty(
      PREPAINT_TINT_VAR,
      "#0b6e4f",
    )
    try {
      expect(getComputedStyle(document.body).backgroundColor).toBe(
        "#0b6e4f",
      )
      document.documentElement.setAttribute(BOOT_FAILED_ATTR, "")
      expect(getComputedStyle(document.body).backgroundColor).toBe(LIGHT)
    } finally {
      document.head.innerHTML = ""
      document.documentElement.className = ""
      document.documentElement.removeAttribute(PREPAINT_TINT_ATTR)
      document.documentElement.removeAttribute(BOOT_FAILED_ATTR)
      document.documentElement.removeAttribute("style")
    }
  })
})
