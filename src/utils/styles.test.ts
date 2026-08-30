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

  it("resolves a locked scroll axis against a consumer's", () => {
    //adaptv used to ship `scrollable-x` / `scrollable-y` as single utilities with a
    //hand-written conflict table. They are plain Tailwind now, so the resolution comes
    //from the groups tailwind-merge already owns — and the shorthand a consumer is most
    //likely to reach for has to lose to the locked axis too.
    //a scroller always locks the PAIR, because that is what pins the cross axis —
    //`overflow-x` and `overflow-y` are different properties and do not fight each
    //other, so locking one axis alone would leave the other to the consumer
    expect(
      mergeStyles({
        className: "overflow-y-auto",
        locked: "overflow-x-auto overflow-y-hidden",
      }),
    ).toBe("overflow-x-auto overflow-y-hidden")
    expect(
      mergeStyles({
        className: "overflow-hidden",
        locked: "overflow-y-auto overflow-x-hidden",
      }),
    ).toBe("overflow-y-auto overflow-x-hidden")
  })

  /*
   * `selectable` is the opt-in against the app-wide `user-select: none` that
   * `ui.noSelect` stamps, so it has to conflict with Tailwind's `select-*`. It did
   * not until `pwa-select-behavior` was registered: BOTH classes reached the DOM and
   * compiled source order decided the winner — the same silent failure the
   * `scrollable-y` case in `cn.ts` documents, and the reason §5.5's registration rule
   * is not optional. `Text selectable` must beat a stray consumer `select-none`.
   */
  it("resolves `selectable` against Tailwind's select-* group", () => {
    const locked = mergeStyles({
      className: "select-none",
      locked: "selectable",
    })
    expect(locked).toContain("selectable")
    expect(locked).not.toContain("select-none")

    //…and the consumer still wins over a mere base
    const overridden = mergeStyles({
      base: "selectable",
      className: "select-none",
    })
    expect(overridden).toContain("select-none")
    expect(overridden).not.toContain("selectable")
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

// The inline tier mirrors the class tiers, because inline style is its OWN cascade
// origin: a `style` prop forwarded straight to the node beats every author rule,
// `locked` classes included. → docs/decisions/styling.md §2
describe("mergeStyles — the inline-style tier", () => {
  it("stays a plain string for a classes-only call (every existing call site)", () => {
    const out = mergeStyles({ base: "flex", locked: "min-h-0" })
    expect(typeof out).toBe("string")
    expect(out).toBe("flex min-h-0")
  })

  it("returns { className, style } as soon as an inline layer is named", () => {
    const out = mergeStyles({
      base: "flex",
      className: "p-4",
      locked: "touch-pan-x",
      style: { color: "red" },
    })
    expect(out).toEqual({
      className: "flex p-4 touch-pan-x",
      style: { color: "red" },
    })
  })

  it("names the tier even when the value is undefined — the shape must be stable", () => {
    //a primitive that always forwards `style` must not change return shape with it
    const out = mergeStyles({ base: "flex", style: undefined })
    expect(out).toEqual({ className: "flex", style: undefined })
  })

  it("consumer style overrides baseStyle", () => {
    const out = mergeStyles({
      baseStyle: { color: "red", margin: 0 },
      style: { color: "blue" },
    })
    expect(out.style).toEqual({ color: "blue", margin: 0 })
  })

  it("lockedStyle wins over both", () => {
    const out = mergeStyles({
      baseStyle: { position: "static" },
      style: { position: "absolute" },
      lockedStyle: { position: "fixed" },
    })
    expect(out.style).toEqual({ position: "fixed" })
  })

  //the genuine reliability gain over the class path: object spread resolves PER
  //PROPERTY, so unlike `cn` there is no conflict-group registry that can fall out
  //of step with a new utility (see the `scrollable-y` case in cn.ts).
  it("resolves per property, leaving untouched ones from lower tiers alone", () => {
    const out = mergeStyles({
      baseStyle: { color: "red", fontSize: 12, opacity: 1 },
      style: { color: "blue", opacity: 0.5 },
      lockedStyle: { opacity: 1 },
    })
    expect(out.style).toEqual({ color: "blue", fontSize: 12, opacity: 1 })
  })

  it("gives undefined, not an empty object, when no layer declared anything", () => {
    const out = mergeStyles({ base: "flex", style: undefined })
    expect(out.style).toBeUndefined()
  })

  it("merges both tiers independently in one call", () => {
    const out = mergeStyles({
      base: "p-2 touch-auto",
      className: "p-4",
      locked: "touch-pan-x",
      baseStyle: { color: "red" },
      style: { background: "white" },
    })
    expect(out.className).toBe("p-4 touch-pan-x")
    expect(out.style).toEqual({ color: "red", background: "white" })
  })
})

describe("the custom behaviour groups must conflict with what they EXPAND to", () => {
  //`scrollable-y` WAS a Tailwind `@utility` that expanded to overflow-y, overflow-x,
  //touch-action AND overscroll-behavior-y. tailwind-merge only drops a class it
  //knows conflicts — and a custom group it has never heard of conflicts with
  //nothing by default. Spelling the expansion out at the call site is what removed
  //the problem; these tests are the guard that the replacement really does merge.
  //
  //The consequence is subtle and bad: BOTH classes survive the merge, so which one
  //applies is decided by the order the rules happen to appear in the compiled
  //stylesheet — not by the order the caller wrote them. `locked` then silently
  //stops being a guarantee, which is the entire point of the layer.
  it("lets a locked scroll utility beat a consumer overflow class", () => {
    const out = mergeStyles({
      className: "overflow-hidden",
      locked: "overflow-y-auto",
    })
    expect(out).toContain("overflow-y-auto")
    expect(out).not.toContain("overflow-hidden")
  })

  it("lets a locked overflow class beat a consumer scroll utility", () => {
    //the inverse must hold too: `scrollEnabled={false}` renders `overflow-hidden`
    //as the locked layer and must win over a consumer's own `overflow-y-auto`
    const out = mergeStyles({
      className: "overflow-y-auto",
      locked: "overflow-hidden",
    })
    expect(out).toContain("overflow-hidden")
    expect(out).not.toContain("overflow-y-auto")
  })

  it("resolves touch-action against the locked pass-through", () => {
    //a stray `touch-none` from a consumer would kill `pointercancel` on iOS and strand
    //the press engine, so the locked longhand has to drop it
    const out = mergeStyles({
      className: "touch-none",
      locked: "touch-pan-x touch-pan-y touch-pinch-zoom",
    })
    expect(out).toBe("touch-pan-x touch-pan-y touch-pinch-zoom")
  })

  it("lets a consumer's cursor through, which the old bundle did not", () => {
    /*
     * The reported bug. `clickable` bundled `touch-action` with `cursor: pointer` and
     * was applied as `locked`, so the cursor was locked too and `cursor-wait` on a
     * pending button was unreachable — and because `cn` did not know the two fought,
     * BOTH were emitted and Tailwind's print order picked the winner.
     */
    const out = mergeStyles({
      base: "cursor-pointer",
      className: "cursor-wait",
      locked: "touch-pan-x touch-pan-y touch-pinch-zoom",
    })
    expect(out).toContain("cursor-wait")
    expect(out).not.toContain("cursor-pointer")
    expect(out).toContain("touch-pan-x")
  })

  it("lets a locked clickable beat a consumer touch-action", () => {
    //`clickable` sets `touch-action: pan-x pan-y pinch-zoom` (the WebKit 240917
    //workaround); a consumer `touch-none` must not silently undo it
    const out = mergeStyles({
      className: "touch-none",
      locked: "touch-pan-x",
    })
    expect(out).toContain("touch-pan-x")
    expect(out).not.toContain("touch-none")
  })

  it("keeps non-conflicting classes from every layer", () => {
    const out = mergeStyles({
      base: "rounded",
      className: "bg-red-500",
      locked: "overflow-y-auto",
    })
    expect(out).toContain("rounded")
    expect(out).toContain("bg-red-500")
    expect(out).toContain("overflow-y-auto")
  })
})
