import { describe, expect, it } from "vitest"
import type {
  DropdownPlacement,
  Rect,
  Size,
} from "#adaptv/components/dropdown/dropdown-position"
import {
  DROPDOWN_MIN_CONTENT_HEIGHT,
  DROPDOWN_GUTTER as G,
  DROPDOWN_VIEWPORT_PADDING as PAD,
  parsePlacement,
  resolveDropdownPosition,
} from "#adaptv/components/dropdown/dropdown-position"

// a phone viewport; every case is written against it so the numbers are legible
const VIEWPORT: Size = { width: 390, height: 844 }
const CONTENT: Size = { width: 200, height: 240 }

function resolve(
  overrides: Partial<{
    trigger: Rect
    content: Size
    viewport: Size
    insets: Partial<{
      top: number
      right: number
      bottom: number
      left: number
    }>
    placement: DropdownPlacement
  }> = {},
) {
  return resolveDropdownPosition({
    trigger: { x: 40, y: 400, width: 120, height: 44 },
    content: CONTENT,
    viewport: VIEWPORT,
    ...overrides,
  })
}

describe("parsePlacement", () => {
  it("splits side and align, defaulting a bare side to centre", () => {
    expect(parsePlacement("bottom-start")).toEqual({
      side: "bottom",
      align: "start",
    })
    expect(parsePlacement("top-end")).toEqual({
      side: "top",
      align: "end",
    })
    expect(parsePlacement("bottom")).toEqual({
      side: "bottom",
      align: "center",
    })
  })
})

describe("resolveDropdownPosition · the happy path", () => {
  it("opens below and start-aligned by default when there is room", () => {
    const p = resolve() // trigger mid-screen, plenty of room below
    expect(p.side).toBe("bottom")
    expect(p.align).toBe("start")
    expect(p.left).toBe(40) // aligned to the trigger's left
    expect(p.top).toBe(400 + 44 + G) // just below the trigger
    expect(p.maxHeight).toBeGreaterThanOrEqual(CONTENT.height) // uncapped
  })

  it("end-aligns to the trigger's right edge", () => {
    // trigger far enough in that the right-aligned menu stays on screen
    const trigger: Rect = { x: 150, y: 400, width: 120, height: 44 }
    const p = resolve({ trigger, placement: "bottom-end" })
    expect(p.left).toBe(150 + 120 - CONTENT.width) // 70, on-screen
  })

  it("centre-aligns over the trigger", () => {
    const trigger: Rect = { x: 120, y: 400, width: 120, height: 44 }
    const p = resolve({ trigger, placement: "bottom" })
    expect(p.left).toBe(120 + 120 / 2 - CONTENT.width / 2) // 80, on-screen
  })
})

describe("resolveDropdownPosition · flip (the up/down decision)", () => {
  it("flips ABOVE when there is no room below but room above", () => {
    // trigger near the bottom: only ~120px below, but ~700px above
    const p = resolve({
      trigger: { x: 40, y: 720, width: 120, height: 44 },
    })
    expect(p.side).toBe("top")
    expect(p.top).toBe(720 - G - CONTENT.height) // sits above the trigger
  })

  it("stays BELOW when the preferred side (top) has no room", () => {
    // asked for top, but the trigger is near the top with room only below
    const p = resolve({
      trigger: { x: 40, y: 10, width: 120, height: 44 },
      placement: "top-start",
    })
    expect(p.side).toBe("bottom")
  })

  it("when neither side fits, picks the roomier side and CAPS the height", () => {
    // a very tall menu, trigger just below centre: more room above than below
    const tall: Size = { width: 200, height: 2000 }
    const p = resolve({
      content: tall,
      trigger: { x: 40, y: 500, width: 120, height: 44 },
    })
    expect(p.side).toBe("top") // above has the most room here
    // capped to the available space, and the box then scrolls inside
    const spaceAbove = 500 - PAD - G
    expect(p.maxHeight).toBeCloseTo(spaceAbove, 0)
    expect(p.maxHeight).toBeLessThan(tall.height)
  })

  it("never crushes below the minimum height — it caps and scrolls", () => {
    // trigger pinned near the very bottom, tall content: tiny space below
    const tall: Size = { width: 200, height: 2000 }
    const p = resolve({
      content: tall,
      trigger: { x: 40, y: 800, width: 120, height: 40 },
      placement: "bottom-start",
    })
    expect(p.maxHeight).toBeGreaterThanOrEqual(DROPDOWN_MIN_CONTENT_HEIGHT)
  })
})

describe("resolveDropdownPosition · horizontal shift (stay on screen)", () => {
  it("shifts LEFT when a start-aligned menu would overflow the right edge", () => {
    // trigger hugging the right edge; start-align would push the menu off-screen
    const p = resolve({
      trigger: { x: 340, y: 400, width: 44, height: 44 },
      placement: "bottom-start",
    })
    const rightEdge = VIEWPORT.width - PAD
    expect(p.left).toBe(rightEdge - CONTENT.width) // shifted fully into view
    expect(p.left + p.maxWidth).toBeLessThanOrEqual(rightEdge)
  })

  it("shifts RIGHT when a menu would overflow the left edge", () => {
    const p = resolve({
      trigger: { x: 4, y: 400, width: 44, height: 44 },
      placement: "bottom-end", // end-align would pull it off the left
    })
    expect(p.left).toBe(PAD)
  })

  it("caps width and pins to the left when content is wider than the viewport", () => {
    const wide: Size = { width: 900, height: 200 }
    const p = resolve({ content: wide })
    expect(p.maxWidth).toBe(VIEWPORT.width - 2 * PAD)
    expect(p.left).toBe(PAD)
  })
})

describe("resolveDropdownPosition · occlusion (carousel / off-screen trigger)", () => {
  it("opens INSIDE the viewport when the trigger is scrolled off the top", () => {
    // a carousel row scrolled up: the trigger's top is above the viewport
    const p = resolve({
      trigger: { x: 40, y: -30, width: 120, height: 44 },
      placement: "top-start",
    })
    expect(p.top).toBeGreaterThanOrEqual(PAD) // never above the viewport
  })

  it("opens INSIDE the viewport when the trigger is scrolled off the bottom", () => {
    const p = resolve({
      trigger: { x: 40, y: 900, width: 120, height: 44 },
    })
    expect(
      p.top + Math.min(CONTENT.height, p.maxHeight),
    ).toBeLessThanOrEqual(VIEWPORT.height - PAD)
  })

  it("keeps a horizontally clipped trigger's menu on the visible part", () => {
    // trigger half off the right of the screen (a carousel mid-scroll)
    const p = resolve({
      trigger: { x: 360, y: 400, width: 120, height: 44 },
      placement: "bottom-start",
    })
    expect(p.left).toBeGreaterThanOrEqual(PAD)
    expect(p.left + p.maxWidth).toBeLessThanOrEqual(VIEWPORT.width - PAD)
  })
})

describe("resolveDropdownPosition · safe-area insets", () => {
  it("treats an inset home indicator as the bottom edge — flips earlier", () => {
    // without the inset there'd be room below; a big bottom inset removes it
    const trigger: Rect = { x: 40, y: 400, width: 120, height: 44 }
    const withoutInset = resolve({ trigger })
    const withInset = resolve({ trigger, insets: { bottom: 300 } })
    expect(withoutInset.side).toBe("bottom")
    expect(withInset.side).toBe("top") // the inset ate the space below
  })

  it("clamps within the left inset (a notch in landscape)", () => {
    const p = resolve({
      trigger: { x: 0, y: 400, width: 44, height: 44 },
      insets: { left: 60 },
      placement: "bottom-start",
    })
    expect(p.left).toBeGreaterThanOrEqual(60 + PAD)
  })
})
