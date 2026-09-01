import { describe, expect, it } from "vitest"
import {
  computeScrollIntoViewTop,
  resolveAvoidanceSpace,
  resolveReservedSpace,
} from "#adaptv/components/avoid-keyboard/use-keyboard-avoidance"

describe("resolveAvoidanceSpace", () => {
  const viewportHeight = 800

  it("reserves nothing when the keyboard is closed", () => {
    expect(
      resolveAvoidanceSpace({
        containerBottom: 800,
        viewportHeight,
        keyboardHeight: 0,
      }),
    ).toBe(0)
  })

  it("reserves the overlap when the wrapper sits behind the keyboard", () => {
    //keyboard top = 800 - 300 = 500; wrapper bottom 800 → 300px hidden
    expect(
      resolveAvoidanceSpace({
        containerBottom: 800,
        viewportHeight,
        keyboardHeight: 300,
      }),
    ).toBe(300)
  })

  it("reserves only the hidden slice when the wrapper ends above the viewport bottom", () => {
    //keyboard top = 500; wrapper bottom 620 → 120px hidden
    expect(
      resolveAvoidanceSpace({
        containerBottom: 620,
        viewportHeight,
        keyboardHeight: 300,
      }),
    ).toBe(120)
  })

  it("reserves nothing when the wrapper ends above the keyboard line", () => {
    //keyboard top = 500; wrapper bottom 480 → no overlap
    expect(
      resolveAvoidanceSpace({
        containerBottom: 480,
        viewportHeight,
        keyboardHeight: 300,
      }),
    ).toBe(0)
  })
})

describe("computeScrollIntoViewTop", () => {
  //keyboardTop well below the 500px scroller bottom → line falls on the scroller bottom
  const base = {
    scrollTop: 0,
    scrollerTop: 0,
    scrollerBottom: 500,
    keyboardTop: 1000,
    topInset: 0,
    buffer: 24,
  }

  it("leaves scrollTop unchanged when the input already clears the keyboard line", () => {
    expect(
      computeScrollIntoViewTop({
        ...base,
        inputTop: 300,
        inputBottom: 340,
      }),
    ).toBe(0)
  })

  it("scrolls just enough to clear the keyboard line plus buffer", () => {
    //keyboard line = 500 - 24 = 476; input bottom 520 → delta 44
    expect(
      computeScrollIntoViewTop({
        ...base,
        inputTop: 480,
        inputBottom: 520,
      }),
    ).toBe(44)
  })

  it("adds the delta onto the current scrollTop", () => {
    expect(
      computeScrollIntoViewTop({
        ...base,
        scrollTop: 100,
        inputTop: 480,
        inputBottom: 520,
      }),
    ).toBe(144)
  })

  it("never lifts the input's top above the scroller's top", () => {
    //delta would be 44, but the input top is only 10px below the scroller top → capped at 10
    expect(
      computeScrollIntoViewTop({
        ...base,
        scrollerTop: 0,
        inputTop: 10,
        inputBottom: 520,
      }),
    ).toBe(10)
  })

  it("uses the keyboard top, not the scroller bottom, when the scroller runs behind the keyboard", () => {
    //full-height scroller (bottom 800) behind a keyboard whose top is 500.
    //line = min(800, 500) - 24 = 476; input bottom 560 → delta 84 (the scroller
    //bottom alone would put the line at 776 and barely scroll at all).
    expect(
      computeScrollIntoViewTop({
        scrollTop: 0,
        scrollerTop: 0,
        scrollerBottom: 800,
        keyboardTop: 500,
        topInset: 0,
        inputTop: 520,
        inputBottom: 560,
        buffer: 24,
      }),
    ).toBe(84)
  })

  it("scrolls down to reveal a field that sits above the visible top", () => {
    //field scrolled off the top (top -100, bottom -40) → scroll down by 100 so its
    //top lands at the scroller top. scrollTop 200 → 100.
    expect(
      computeScrollIntoViewTop({
        ...base,
        scrollTop: 200,
        inputTop: -100,
        inputBottom: -40,
      }),
    ).toBe(100)
  })

  it("does not push a tall above-field's bottom past the keyboard line", () => {
    //tall field (top -100, bottom 470) above the top; bringing its top to 0 would
    //push the bottom (570) past the line (476). Capped at maxDelta = 476 - 470 = 6.
    expect(
      computeScrollIntoViewTop({
        ...base,
        scrollTop: 200,
        inputTop: -100,
        inputBottom: 470,
      }),
    ).toBe(194)
  })

  it("lands a revealed above-field below the safe-area top inset", () => {
    //topInset 60 → safe top line at 60. field top -100 → scroll down by 160 so it
    //lands at 60 (clear of the notch), not at the literal top (0). scrollTop 200 → 40.
    expect(
      computeScrollIntoViewTop({
        ...base,
        scrollTop: 200,
        topInset: 60,
        inputTop: -100,
        inputBottom: -40,
      }),
    ).toBe(40)
  })
})

describe("resolveReservedSpace", () => {
  it("reserves the safe-area inset (plus gap) when the keyboard is closed", () => {
    expect(
      resolveReservedSpace({
        restingInset: 8,
        safeInsetBottom: 34,
        overlap: 0,
      }),
    ).toBe(42)
  })

  it("lets the keyboard subsume the safe inset — they never stack", () => {
    //overlap 290 > safe 34, so the safe inset is not added on top: 8 + max(34, 290)
    expect(
      resolveReservedSpace({
        restingInset: 8,
        safeInsetBottom: 34,
        overlap: 290,
      }),
    ).toBe(298)
  })

  it("keeps the safe inset when it is larger than a small overlap", () => {
    expect(
      resolveReservedSpace({
        restingInset: 8,
        safeInsetBottom: 34,
        overlap: 20,
      }),
    ).toBe(42)
  })

  it("returns 0 with no obstruction, so the element's own padding/margin applies", () => {
    expect(
      resolveReservedSpace({
        restingInset: 8,
        safeInsetBottom: 0,
        overlap: 0,
      }),
    ).toBe(0)
  })
})
