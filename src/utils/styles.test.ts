import { describe, expect, it } from "vitest"
import { mergeStyles } from "#adaptv/utils/styles"

// The primitive styling contract (VISION.md): three layers, precedence
//   base (overridable defaults)  <  className (consumer)  <  locked (structural)
// implemented via tailwind-merge last-wins order: cn(base, className, locked).

describe("mergeStyles", () => {
  it("consumer className overrides base defaults", () => {
    const out = mergeStyles({ base: "p-2 rounded", className: "p-4" })
    expect(out).toContain("p-4")
    expect(out).not.toContain("p-2")
    // untouched base classes survive
    expect(out).toContain("rounded")
  })

  it("locked structural styles win over the consumer className", () => {
    const out = mergeStyles({
      base: "overflow-visible",
      className: "overflow-auto", // consumer tries to override structure
      locked: "overflow-hidden", // …but structure wins
    })
    expect(out).toContain("overflow-hidden")
    expect(out).not.toContain("overflow-auto")
    expect(out).not.toContain("overflow-visible")
  })

  it("locked wins over base too", () => {
    const out = mergeStyles({ base: "touch-auto", locked: "touch-none" })
    expect(out).toContain("touch-none")
    expect(out).not.toContain("touch-auto")
  })

  it("resolves adaptv's custom behavior groups (scrollable-*)", () => {
    // a consumer scrollable-y is overridden by a locked scrollable-x
    const out = mergeStyles({
      className: "scrollable-y",
      locked: "scrollable-x",
    })
    expect(out).toContain("scrollable-x")
    expect(out).not.toContain("scrollable-y")
  })

  it("returns just base+locked when no className is given", () => {
    const out = mergeStyles({ base: "flex", locked: "min-h-0" })
    expect(out).toBe("flex min-h-0")
  })

  it("accepts conditional class values (clsx-style)", () => {
    const out = mergeStyles({
      base: ["rounded", { hidden: false, "font-bold": true }],
      className: undefined,
    })
    expect(out).toContain("rounded")
    expect(out).toContain("font-bold")
    expect(out).not.toContain("hidden")
  })
})

describe("the custom behaviour groups must conflict with what they EXPAND to", () => {
  //`scrollable-y` is a Tailwind `@utility` that expands to overflow-y, overflow-x,
  //touch-action AND overscroll-behavior-y. tailwind-merge only drops a class it
  //knows conflicts — and a custom group it has never heard of conflicts with
  //nothing by default.
  //
  //The consequence is subtle and bad: BOTH classes survive the merge, so which one
  //applies is decided by the order the rules happen to appear in the compiled
  //stylesheet — not by the order the caller wrote them. `locked` then silently
  //stops being a guarantee, which is the entire point of the layer.
  it("lets a locked scroll utility beat a consumer overflow class", () => {
    const out = mergeStyles({
      className: "overflow-hidden",
      locked: "scrollable-y",
    })
    expect(out).toContain("scrollable-y")
    expect(out).not.toContain("overflow-hidden")
  })

  it("lets a locked overflow class beat a consumer scroll utility", () => {
    //the inverse must hold too: `scrollEnabled={false}` renders `overflow-hidden`
    //as the locked layer and must win over a consumer `scrollable-y`
    const out = mergeStyles({
      className: "scrollable-y",
      locked: "overflow-hidden",
    })
    expect(out).toContain("overflow-hidden")
    expect(out).not.toContain("scrollable-y")
  })

  it("resolves the scroll utility against touch-action too", () => {
    //`scrollable-y` sets `touch-action: pan-y`; a stray `touch-none` would kill
    //the scroll it is supposed to guarantee
    const out = mergeStyles({
      className: "touch-none",
      locked: "scrollable-y",
    })
    expect(out).toContain("scrollable-y")
    expect(out).not.toContain("touch-none")
  })

  it("lets a locked clickable beat a consumer touch-action", () => {
    //`clickable` sets `touch-action: pan-x pan-y pinch-zoom` (the WebKit 240917
    //workaround); a consumer `touch-none` must not silently undo it
    const out = mergeStyles({
      className: "touch-none",
      locked: "clickable",
    })
    expect(out).toContain("clickable")
    expect(out).not.toContain("touch-none")
  })

  it("keeps non-conflicting classes from every layer", () => {
    const out = mergeStyles({
      base: "rounded",
      className: "bg-red-500",
      locked: "scrollable-y",
    })
    expect(out).toContain("rounded")
    expect(out).toContain("bg-red-500")
    expect(out).toContain("scrollable-y")
  })
})
