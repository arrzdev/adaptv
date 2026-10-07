import { describe, expect, it } from "vitest"
import {
  composeStyles,
  joinClasses,
  mergeInlineStyles,
} from "#adaptv/utils/styles"

// The class tier is a join, not a merge: nothing in a primitive's class attribute is
// adaptv's, so there is nothing to resolve (docs/decisions/styling.md §2, §3.3). The
// inline tier is where `locked` lives, and it merges per property (§2.1).

describe("joinClasses", () => {
  it("joins in order and skips falsy values", () => {
    expect(joinClasses("a", false, null, undefined, 0, "", "b")).toBe(
      "a b",
    )
  })

  it("keeps two conflicting classes — resolving them is the consumer's tool's job", () => {
    expect(joinClasses("p-2", "p-4")).toBe("p-2 p-4")
    expect(joinClasses("select-none", "selectable")).toBe(
      "select-none selectable",
    )
  })

  it("flattens nested lists (the render element's classes, then className)", () => {
    expect(joinClasses(["a", undefined], ["b", ["c", false]])).toBe(
      "a b c",
    )
  })

  it("trims each part and gives an empty string for nothing", () => {
    expect(joinClasses("  a  ", " ")).toBe("a")
    expect(joinClasses()).toBe("")
  })
})

describe("mergeInlineStyles", () => {
  it("consumer style overrides baseStyle", () => {
    expect(
      mergeInlineStyles({
        baseStyle: { color: "red", margin: 0 },
        style: { color: "blue" },
      }),
    ).toEqual({ color: "blue", margin: 0 })
  })

  it("lockedStyle wins over both", () => {
    expect(
      mergeInlineStyles({
        baseStyle: { position: "static" },
        style: { position: "absolute" },
        lockedStyle: { position: "fixed" },
      }),
    ).toEqual({ position: "fixed" })
  })

  it("resolves per property, leaving untouched ones from lower tiers alone", () => {
    expect(
      mergeInlineStyles({
        baseStyle: { color: "red", fontSize: 12, opacity: 1 },
        style: { color: "blue", opacity: 0.5 },
        lockedStyle: { opacity: 1 },
      }),
    ).toEqual({ color: "blue", fontSize: 12, opacity: 1 })
  })

  it("gives undefined, not an empty object, when no layer declared anything", () => {
    expect(mergeInlineStyles({ style: undefined })).toBeUndefined()
    expect(mergeInlineStyles({ style: {} })).toBeUndefined()
  })
})

describe("composeStyles", () => {
  it("stays a plain string for a classes-only call", () => {
    const out = composeStyles({ className: ["a", false, "b"] })
    expect(typeof out).toBe("string")
    expect(out).toBe("a b")
  })

  it("returns { className, style } as soon as an inline layer is named", () => {
    expect(
      composeStyles({
        className: "p-4",
        style: { color: "red" },
        lockedStyle: { touchAction: "pan-x pan-y pinch-zoom" },
      }),
    ).toEqual({
      className: "p-4",
      style: { color: "red", touchAction: "pan-x pan-y pinch-zoom" },
    })
  })

  it("names the tier even when the value is undefined — the shape must be stable", () => {
    //a primitive that always forwards `style` must not change return shape with it
    expect(composeStyles({ className: "flex", style: undefined })).toEqual(
      {
        className: "flex",
        style: undefined,
      },
    )
  })
})
