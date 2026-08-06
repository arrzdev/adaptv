import { afterEach, describe, expect, it, vi } from "vitest"

/*
 * measureDynamicTypeScale reads an ambient WebKit signal (the `-apple-system-body`
 * keyword behind the `-webkit-touch-callout` gate) and memoises the result at module
 * scope. Each test therefore imports a FRESH module — `vi.resetModules()` + dynamic
 * import — so the cache from one case cannot leak into the next, and stubs the two
 * globals the measurement touches (`CSS.supports`, `getComputedStyle`).
 */

async function freshMeasure() {
  vi.resetModules()
  return (await import("#adaptv/utils/text-scale")).measureDynamicTypeScale
}

describe("measureDynamicTypeScale", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it("returns 1 off iOS-WebKit — the -webkit-touch-callout gate is false", async () => {
    // happy-dom has no `-webkit-touch-callout`; force it explicitly so the test states
    // the contract regardless of the environment's default.
    vi.stubGlobal("CSS", { supports: () => false })
    const measure = await freshMeasure()
    expect(measure()).toBe(1)
  })

  it("returns 1 with no document (SSR)", async () => {
    const measure = await freshMeasure()
    vi.stubGlobal("document", undefined)
    expect(measure()).toBe(1)
  })

  it("on iOS-WebKit, returns the measured -apple-system-body px over 17", async () => {
    vi.stubGlobal("CSS", { supports: () => true })
    // 34px is the size iOS reports for -apple-system-body at the 2× accessibility step.
    vi.stubGlobal("getComputedStyle", () => ({ fontSize: "34px" }))
    const measure = await freshMeasure()
    expect(measure()).toBeCloseTo(2) // 34 / 17
  })

  it("returns 1 at the default text size (17px measures back to a 1× factor)", async () => {
    vi.stubGlobal("CSS", { supports: () => true })
    vi.stubGlobal("getComputedStyle", () => ({ fontSize: "17px" }))
    const measure = await freshMeasure()
    expect(measure()).toBe(1)
  })

  it("memoises — a second call does not re-measure", async () => {
    vi.stubGlobal("CSS", { supports: () => true })
    const computeStyle = vi.fn(() => ({ fontSize: "25.5px" }))
    vi.stubGlobal("getComputedStyle", computeStyle)
    const measure = await freshMeasure()

    const first = measure()
    const second = measure()

    expect(second).toBe(first)
    expect(first).toBeCloseTo(1.5) // 25.5 / 17
    expect(computeStyle).toHaveBeenCalledTimes(1) // cached after the first read
  })
})
