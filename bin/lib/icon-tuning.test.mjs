import { describe, expect, it } from "vitest"
import { DEFAULT_MARGIN } from "./icon-geometry.mjs"
import { parseTuning, TUNING } from "./icon-tuning.mjs"

const parse = (flags) => parseTuning(flags)

describe("parseTuning — defaults are opinions a power user can take back", () => {
  it("says nothing at all when no flag is passed", () => {
    const { values, errors, warnings } = parse({})
    expect(values).toEqual({ margin: DEFAULT_MARGIN, padding: 0 })
    expect(errors).toEqual([])
    expect(warnings).toEqual([])
  })

  it("stays silent on a value that is simply NOT the default", () => {
    //Passing a flag is not itself something to comment on. Only the unusual band is.
    const { warnings, errors } = parse({ margin: "20", padding: "10" })
    expect([...errors, ...warnings]).toEqual([])
  })

  it("refuses only what cannot be used, and names the range", () => {
    const { errors } = parse({ margin: "90" })
    expect(errors).toEqual([
      `'--margin' must be a percentage between 0 and 50, got "90"`,
    ])
  })

  it("reports EVERY bad number at once, not one command at a time", () => {
    //R33: a config fixed one line per run is worse than a list.
    expect(parse({ margin: "-5", padding: "99" }).errors).toHaveLength(2)
  })

  it("rejects a flag passed with no value rather than reading it as a number", () => {
    //`parseFlags` turns a bare `--margin` into `true`; `Number(true)` is 1, which would
    //silently mean "1%" — a number the dev never typed.
    expect(parse({ margin: true }).values.margin).toBe(DEFAULT_MARGIN)
    expect(parse({ margin: "abc" }).errors).toHaveLength(1)
  })

  it("falls back to the default for a value it refused, so the run is describable", () => {
    expect(parse({ margin: "90" }).values.margin).toBe(DEFAULT_MARGIN)
  })

  describe("warns, never refuses, inside the range", () => {
    it("calls out a margin tighter than the default — the direction that costs pixels", () => {
      expect(parse({ margin: "3" }).warnings).toEqual([
        `--margin 3 leaves less room than the ${DEFAULT_MARGIN}% default`,
      ])
      expect(parse({ margin: "3" }).errors).toEqual([])
    })

    it("has its own sentence for zero, which is the one that can actually crop", () => {
      expect(parse({ margin: "0" }).warnings).toEqual([
        "--margin 0 leaves no room, so art sits flush to every edge",
      ])
    })

    it("calls out a margin so large the mark gets small", () => {
      expect(parse({ margin: "45" }).warnings[0]).toContain("--margin 45")
      expect(parse({ margin: "45" }).errors).toEqual([])
    })

    it("calls out heavy padding, which stacks on a fit adaptv already computed", () => {
      expect(parse({ padding: "35" }).warnings[0]).toContain(
        "--padding 35",
      )
    })

    it("keeps every line inside a narrow terminal", () => {
      for (const flags of [
        { margin: "0" },
        { margin: "3" },
        { margin: "45" },
        { padding: "35" },
        { margin: "90", padding: "99" },
      ])
        for (const line of [
          ...parse(flags).errors,
          ...parse(flags).warnings,
        ])
          expect(line.length).toBeLessThanOrEqual(72)
    })
  })
})

describe("TUNING — the two ranges do different jobs", () => {
  it("puts the default at the edge of the band it recommends", () => {
    //Below the default is worth a word; at or above it, up to the band's top, is not.
    expect(TUNING.margin.band[0]).toBe(DEFAULT_MARGIN)
    expect(TUNING.padding.band[0]).toBe(TUNING.padding.fallback)
  })

  it("keeps the usable range wider than the recommended one", () => {
    for (const spec of Object.values(TUNING)) {
      expect(spec.min).toBeLessThanOrEqual(spec.band[0])
      expect(spec.max).toBeGreaterThan(spec.band[1])
    }
  })
})
