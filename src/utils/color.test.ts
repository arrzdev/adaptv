import { describe, expect, it } from "vitest"
import type { Rgb } from "#adaptv/utils/color"
import {
  compositeOver,
  formatHex,
  mixRgb,
  parseCssColor,
} from "#adaptv/utils/color"

describe("parseCssColor", () => {
  it("reads every hex length", () => {
    expect(parseCssColor("#fff")).toEqual({
      r: 255,
      g: 255,
      b: 255,
      a: 1,
    })
    expect(parseCssColor("#1b1b1b")).toEqual({
      r: 27,
      g: 27,
      b: 27,
      a: 1,
    })
    expect(parseCssColor("#0000")?.a).toBe(0)
    expect(parseCssColor("#00000080")?.a).toBeCloseTo(0.502, 3)
  })

  it("reads both rgb() syntaxes, which is what computed styles hand back", () => {
    //legacy comma form — Chrome and Safari both serialise `background-color`
    //this way today, and the whole scrim path depends on reading it
    expect(parseCssColor("rgba(0, 0, 0, 0.4)")).toEqual({
      r: 0,
      g: 0,
      b: 0,
      a: 0.4,
    })
    //modern space/slash form
    expect(parseCssColor("rgb(0 0 0 / 40%)")).toEqual({
      r: 0,
      g: 0,
      b: 0,
      a: 0.4,
    })
    expect(parseCssColor("rgb(100% 0% 0%)")).toEqual({
      r: 255,
      g: 0,
      b: 0,
      a: 1,
    })
  })

  /**
   * Not an exotic branch: Tailwind v4 compiles every opacity modifier (`bg-black/40`) to a `color-mix()`, and both
   * Chrome and WebKit resolve that to an `oklab()`/`oklch()` computed value. The drawer's own
   * default scrim reads back as `oklch(0 0 0 / 0.65)` on a running build — measured, not assumed
   * — so a parser that only knew `rgb()` would have made the whole tint a silent no-op on the
   * repo's own styling.
   */
  describe("the modern syntaxes, which are the common case", () => {
    it("reads oklch, alpha and all", () => {
      const black = parseCssColor("oklch(0 0 0 / 0.65)")
      expect(black?.a).toBeCloseTo(0.65, 6)
      expect(black?.r).toBeCloseTo(0, 4)
      expect(black?.g).toBeCloseTo(0, 4)
      expect(black?.b).toBeCloseTo(0, 4)

      //oklch(1 0 0) is white — the round trip through OKLab must land on 255,
      //not on 254-point-something that rounds a shade off every tint
      const white = parseCssColor("oklch(1 0 0)")
      expect(formatHex(white as Rgb)).toBe("#ffffff")
    })

    it("reads oklab, which is what color-mix() resolves to", () => {
      const mixed = parseCssColor("oklab(0 0 0 / 0.4)")
      expect(mixed?.a).toBeCloseTo(0.4, 6)
      expect(formatHex(mixed as Rgb)).toBe("#000000")
    })

    /**
     * Ground truth, not arithmetic checked against itself: each of these was painted into a 1×1
     * canvas by Chrome on a running build and read back with `getImageData`. If the conversion
     * below ever drifts from what the engine actually rasterises, the tint stops matching the
     * scrim it is meant to continue — which is the one failure this whole file exists to prevent.
     */
    it.each([
      ["oklch(0.4406 0.1009 303.37)", "#5e4380"],
      ["oklch(0.7 0.15 90)", "#c39900"],
      ["oklch(0.7 0.15 250)", "#4ba3f7"],
      ["oklab(0.5 0.1 -0.1)", "#81459a"],
      //out of sRGB's gamut: the engine clips it, and so does this
      ["oklch(0.6 0.25 30)", "#f10000"],
    ])("matches what Chrome rasterises for %s", (input, expected) => {
      expect(formatHex(parseCssColor(input) as Rgb)).toBe(expected)
    })

    it("takes hue in any angle unit, and `none` as zero", () => {
      const deg = formatHex(parseCssColor("oklch(0.7 0.15 90deg)") as Rgb)
      expect(
        formatHex(parseCssColor("oklch(0.7 0.15 0.25turn)") as Rgb),
      ).toBe(deg)
      expect(formatHex(parseCssColor("oklch(0.7 0.15 none)") as Rgb)).toBe(
        formatHex(parseCssColor("oklch(0.7 0.15 0)") as Rgb),
      )
    })

    it("clips out-of-gamut rather than emitting a channel a meta cannot carry", () => {
      const wide = parseCssColor("oklch(0.7 0.4 30)")
      expect(wide?.r).toBeLessThanOrEqual(255)
      expect(wide?.g).toBeGreaterThanOrEqual(0)
      expect(formatHex(wide as Rgb)).toMatch(/^#[0-9a-f]{6}$/)
    })
  })

  it("refuses what it cannot read rather than guessing", () => {
    //a near-miss tint is worse than none — the seam is what the eye lands on
    expect(parseCssColor("color(display-p3 0 0 0)")).toBeNull()
    expect(parseCssColor("rebeccapurple")).toBeNull()
    expect(parseCssColor("")).toBeNull()
  })
})

describe("compositeOver", () => {
  it("returns the backdrop when the scrim is invisible", () => {
    const base = { r: 238, g: 238, b: 236 }
    expect(compositeOver({ r: 0, g: 0, b: 0, a: 0 }, base)).toEqual(base)
  })

  it("returns the scrim when it is opaque", () => {
    expect(
      compositeOver(
        { r: 0, g: 0, b: 0, a: 1 },
        { r: 238, g: 238, b: 236 },
      ),
    ).toEqual({ r: 0, g: 0, b: 0 })
  })

  it("darkens by exactly the scrim's alpha", () => {
    const out = compositeOver(
      { r: 0, g: 0, b: 0, a: 0.4 },
      { r: 100, g: 200, b: 50 },
    )
    expect(out).toEqual({ r: 60, g: 120, b: 30 })
  })
})

describe("mixRgb", () => {
  it("pins both ends", () => {
    const from = { r: 238, g: 238, b: 236 }
    const to = { r: 10, g: 10, b: 12 }
    expect(mixRgb(from, to, 0)).toEqual(from)
    expect(mixRgb(from, to, 1)).toEqual(to)
  })

  /**
   * The identity the whole tint design rests on: a tween between the two ENDPOINT colours is not
   * an approximation of a scrim fading in — it is the same arithmetic. So a consumer animating
   * `theme-color` from A to B gets, for free, the exact colour the chrome would show if it could
   * see the half-faded overlay, and the drawer needs no privileged "composite at progress" path.
   */
  it("equals compositing the scrim at that fraction of its opacity", () => {
    const base = { r: 238, g: 238, b: 236 }
    const scrim = { r: 0, g: 0, b: 0, a: 0.4 }
    const opaqueEnd = compositeOver(scrim, base)

    for (const t of [0, 0.13, 0.25, 0.5, 0.77, 1]) {
      const tweened = mixRgb(base, opaqueEnd, t)
      const composited = compositeOver({ ...scrim, a: scrim.a * t }, base)
      expect(tweened.r).toBeCloseTo(composited.r, 10)
      expect(tweened.g).toBeCloseTo(composited.g, 10)
      expect(tweened.b).toBeCloseTo(composited.b, 10)
    }
  })
})

describe("formatHex", () => {
  it("rounds and pads", () => {
    expect(formatHex({ r: 0, g: 0, b: 0 })).toBe("#000000")
    expect(formatHex({ r: 142.6, g: 7.2, b: 255 })).toBe("#8f07ff")
  })
})
