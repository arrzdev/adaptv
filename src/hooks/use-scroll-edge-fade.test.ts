import { act, renderHook } from "@testing-library/react"
import { createRef } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useScrollEdgeFade } from "#adaptv/hooks/use-scroll-edge-fade"

/* =============================================================================
 * A SCROLLABLE STUB
 *
 * jsdom lays nothing out, so `scrollTop`/`scrollHeight`/`clientHeight` are all 0 on
 * a real element and every strength would read 0 — a suite that passes because
 * nothing scrolls. These are defined as writable own properties instead, so a test
 * states the scroll geometry it means and the hook's arithmetic is the only thing
 * under test.
 * ============================================================================= */

type Geometry = {
  offset?: number
  extent?: number
  horizontal?: boolean
}

function makeScroller({
  offset = 0,
  extent = 1000,
  horizontal = false,
}: Geometry = {}) {
  const node = document.createElement("div")
  const viewport = 400
  const define = (name: string, value: number) =>
    Object.defineProperty(node, name, { value, writable: true })

  if (horizontal) {
    define("scrollLeft", offset)
    define("clientWidth", viewport)
    define("scrollWidth", viewport + extent)
  } else {
    define("scrollTop", offset)
    define("clientHeight", viewport)
    define("scrollHeight", viewport + extent)
  }
  document.body.append(node)
  return node
}

const strengths = (node: HTMLElement) => ({
  start: node.style.getPropertyValue("--fade-start"),
  end: node.style.getPropertyValue("--fade-end"),
})

function mount(
  node: HTMLElement,
  opts: Parameters<typeof useScrollEdgeFade>[2],
) {
  const ref =
    createRef<HTMLElement>() as React.RefObject<HTMLElement | null>
  ref.current = node
  return renderHook(() => useScrollEdgeFade(ref, true, opts))
}

const BOTH = { start: true, end: true, horizontal: false }

beforeEach(() => {
  //the hook coalesces every recompute into a frame; drive it deterministically
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    cb(0)
    return 1
  })
  vi.stubGlobal("cancelAnimationFrame", () => {})
})

afterEach(() => {
  vi.unstubAllGlobals()
  document.body.replaceChildren()
})

describe("useScrollEdgeFade — the strengths that make a tall fade usable", () => {
  it("is off at the edge it is parked against", () => {
    //the whole reported problem: a tall fade permanently greying out the first line
    //of content, even when there is demonstrably nothing above it
    const node = makeScroller({ offset: 0 })
    mount(node, BOTH)
    expect(strengths(node).start).toBe("0")
  })

  it("is fully on at the far edge while there is content that way", () => {
    const node = makeScroller({ offset: 0, extent: 1000 })
    mount(node, BOTH)
    expect(strengths(node).end).toBe("1")
  })

  it("ramps in rather than popping", () => {
    //half the ramp distance → half strength. A step function would flash the fade
    //on at the first scrolled pixel, which is what makes a deep fade look broken.
    const node = makeScroller({ offset: 12 })
    mount(node, BOTH)
    expect(Number(strengths(node).start)).toBeCloseTo(0.5)
  })

  it("drops the far edge once the content is exhausted", () => {
    const node = makeScroller({ offset: 1000, extent: 1000 })
    mount(node, BOTH)
    expect(strengths(node).end).toBe("0")
    expect(strengths(node).start).toBe("1")
  })

  it("reports 0 at both ends when nothing overflows", () => {
    //so `fade` can be left on unconditionally — a short list must not wear a fade
    const node = makeScroller({ offset: 0, extent: 0 })
    mount(node, BOTH)
    expect(strengths(node)).toEqual({ start: "0", end: "0" })
  })

  it("survives iOS rubber-band, which scrolls PAST both ends", () => {
    /*
     * Overscroll drives `scrollTop` negative at the top and beyond the extent at the
     * bottom. Unclamped, the strength goes negative, the mask's colour stops come out
     * in the wrong order, and the edge flickers opaque for the length of the bounce —
     * visible only on a real device, which is exactly why it is pinned here.
     */
    const top = makeScroller({ offset: -60 })
    mount(top, BOTH)
    expect(Number(strengths(top).start)).toBeGreaterThanOrEqual(0)
    expect(Number(strengths(top).end)).toBeLessThanOrEqual(1)

    const bottom = makeScroller({ offset: 1060, extent: 1000 })
    mount(bottom, BOTH)
    expect(Number(strengths(bottom).end)).toBeGreaterThanOrEqual(0)
  })

  it("holds a disabled end at 0 no matter where the scroll is", () => {
    const node = makeScroller({ offset: 500, extent: 1000 })
    mount(node, { start: false, end: true, horizontal: false })
    expect(strengths(node).start).toBe("0")
    expect(strengths(node).end).toBe("1")
  })

  it("reads the inline axis when horizontal", () => {
    //start/end are logical — the same two names, a different pair of measurements,
    //and no branch anywhere in the component
    const node = makeScroller({
      offset: 500,
      extent: 1000,
      horizontal: true,
    })
    mount(node, { start: true, end: true, horizontal: true })
    expect(strengths(node)).toEqual({ start: "1", end: "1" })
  })

  it("recomputes on scroll", () => {
    const node = makeScroller({ offset: 0 })
    mount(node, BOTH)
    expect(strengths(node).start).toBe("0")

    act(() => {
      ;(node as unknown as { scrollTop: number }).scrollTop = 400
      node.dispatchEvent(new Event("scroll"))
    })
    expect(strengths(node).start).toBe("1")
  })

  it("leaves no strengths behind when it unmounts", () => {
    //a re-render that turns fades off must not strand the element mid-fade
    const node = makeScroller({ offset: 500 })
    const { unmount } = mount(node, BOTH)
    expect(strengths(node).start).toBe("1")

    unmount()
    expect(strengths(node)).toEqual({ start: "", end: "" })
  })

  it("does nothing at all when no end is faded", () => {
    const node = makeScroller({ offset: 500 })
    const ref =
      createRef<HTMLElement>() as React.RefObject<HTMLElement | null>
    ref.current = node
    renderHook(() =>
      useScrollEdgeFade(ref, false, {
        start: false,
        end: false,
        horizontal: false,
      }),
    )
    expect(strengths(node)).toEqual({ start: "", end: "" })
  })
})
