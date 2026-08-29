import { describe, expect, it } from "vitest"
import { SPLASH_REVEALED_ATTR } from "#adaptv/hooks/use-splash-handoff"
import { getCriticalShellCss } from "#adaptv/shell/critical-css"

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
