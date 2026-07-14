import { describe, expect, it } from "vitest"
import { mergeStyles } from "#nativ/utils/styles"

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

  it("resolves nativ's custom behavior groups (scrollable-*)", () => {
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
