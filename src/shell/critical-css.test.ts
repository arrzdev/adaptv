import { describe, expect, it } from "vitest"
import { getCriticalShellCss } from "#nativ/shell/critical-css"

const LIGHT = "#eeeeec"
const DARK = "#0a0a0c"

// The splash overlay is gated pre-paint off the `data-nativ-platform` stamp so the
// custom splash only paints where the policy allows — never a post-hydration flash.
describe("getCriticalShellCss — splash policy gate", () => {
  it("hides the custom splash in a browser tab by default (installed-only)", () => {
    const css = getCriticalShellCss(LIGHT, DARK, false)
    expect(css).toContain(
      `html[data-nativ-platform="web"] [data-nativ-splash]{display:none!important}`,
    )
  })

  it("never gates native or standalone (they always show the splash)", () => {
    const css = getCriticalShellCss(LIGHT, DARK, false)
    // the only splash-hiding rule targets the browser (`web`) tag
    expect(css).not.toContain(
      `html[data-nativ-platform="native"] [data-nativ-splash]{display:none`,
    )
    expect(css).not.toContain(
      `html[data-nativ-platform="standalone"] [data-nativ-splash]{display:none`,
    )
  })

  it("shows the splash everywhere when splashScreenInBrowser is opted in", () => {
    const css = getCriticalShellCss(LIGHT, DARK, true)
    expect(css).not.toContain("[data-nativ-splash]{display:none")
  })

  it("still paints the brand background pre-paint (anti-flash) both themes", () => {
    const css = getCriticalShellCss(LIGHT, DARK, false)
    expect(css).toContain(`background-color:${LIGHT}`)
    expect(css).toContain(`background-color:${DARK}`)
  })
})
