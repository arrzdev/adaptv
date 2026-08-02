import { describe, expect, it, vi } from "vitest"
import { DRAWER_CONTENT_LAYOUT_CLASS } from "#adaptv/components/drawer/drawer-engine"
import {
  resolveDrawerKeyboardRoom,
  scrollDrawerInputIntoView,
  shouldPrimeKeyboardFloor,
} from "#adaptv/components/drawer/drawer-keyboard"
import { compileAdaptvStyles } from "#adaptv/styles/compile.test-helper"

//the caret repaint is a real DOM side effect irrelevant to the scroll maths under test
vi.mock("#adaptv/hooks/use-caret-repaint", () => ({
  beginCaretHold: () => () => {},
}))

/*
 * The drawer's answer to the keyboard, which is NOT "move out of its way".
 *
 * The sheet is infinitely tall and grows to what it needs, so a keyboard is a slice of the
 * bottom that stops being usable: hold that slice as room under the content and let the box
 * grow by the same amount to pay for it. Device numbers throughout are from the iPhone 16 Pro
 * this was measured on — 874pt viewport, 812 cap, 336 keyboard.
 */

const CAP = 812
const KEYBOARD = 336

describe("the box grows by the room it has to hold", () => {
  it("grows a short sheet by the whole keyboard, so nothing it was showing is lost", () => {
    //200 of content + 336 of room = 536, well under the cap: every row stays visible, the sheet
    //just reaches higher up the screen
    expect(resolveDrawerKeyboardRoom(KEYBOARD, 200, CAP)).toEqual({
      room: KEYBOARD,
      maxHeight: 536,
    })
  })

  it("grows a tall sheet only to the cap, and the scroller absorbs the rest", () => {
    //610 + 336 would be 946; capped at 812, so 134 of content moves below the fold — reachable
    //by scrolling, which is the whole point of spending the growth on the box and not on a
    //translate
    expect(resolveDrawerKeyboardRoom(KEYBOARD, 610, CAP)).toEqual({
      room: KEYBOARD,
      maxHeight: CAP,
    })
  })

  it("holds the room even when there is no growth left to pay for it", () => {
    //already at the cap: the sheet cannot grow, so the room comes straight out of the scroller.
    //The stack still clears the keyboard — that is the part that must never be negotiable.
    expect(resolveDrawerKeyboardRoom(KEYBOARD, 1200, CAP)).toEqual({
      room: KEYBOARD,
      maxHeight: CAP,
    })
  })

  it("resolves the resting box, which is what the return animates back to", () => {
    expect(resolveDrawerKeyboardRoom(0, 610, CAP)).toEqual({
      room: 0,
      maxHeight: 610,
    })
    expect(resolveDrawerKeyboardRoom(0, 1200, CAP)).toEqual({
      room: 0,
      maxHeight: CAP,
    })
  })
})

/*
 * The floor primed on focus, ahead of the keyboard.
 *
 * The flicker it closes: a picker open with no keyboard yet (no room held), then a text-input tap.
 * The picker collapses on the focus frame; the keyboard's height lands a frame or two later. With
 * no room held the collapse cannot ride the keyboard-room effect (that early-returns at room 0), so
 * the box shrinks raw and the sheet's top DROPS, then snaps back UP when the keyboard grows it.
 * Pinning a floor on focus holds the top across the gap; the keyboard-room effect's heldFloor path
 * then eases it to the final height in one motion. The gate answers ONLY the flicker-prone state.
 */
describe("shouldPrimeKeyboardFloor", () => {
  const flickerProne = {
    enabled: true,
    isClosing: false,
    roomHeld: false,
    floorHeld: false,
    capHeld: false,
  }

  it("primes in the exact flicker-prone state: enabled, at rest, nothing held", () => {
    expect(shouldPrimeKeyboardFloor(flickerProne)).toBe(true)
  })

  it("never when disabled — folds in open/avoidKeyboard off and a field that raises no keyboard", () => {
    //a readonly/disabled field, or a closed / keyboard-blind drawer, all arrive here as enabled:false
    expect(
      shouldPrimeKeyboardFloor({ ...flickerProne, enabled: false }),
    ).toBe(false)
  })

  it("never when room is already held — a field switch with the keyboard up; reaim owns that collapse", () => {
    expect(
      shouldPrimeKeyboardFloor({ ...flickerProne, roomHeld: true }),
    ).toBe(false)
  })

  it("never when a floor is already held — don't re-prime a second focus onto the first", () => {
    expect(
      shouldPrimeKeyboardFloor({ ...flickerProne, floorHeld: true }),
    ).toBe(false)
  })

  it("never when the engine already owns the cap — it is mid-motion, do not perturb it", () => {
    expect(
      shouldPrimeKeyboardFloor({ ...flickerProne, capHeld: true }),
    ).toBe(false)
  })

  it("never while closing — the sheet is sliding out carrying whatever it held", () => {
    expect(
      shouldPrimeKeyboardFloor({ ...flickerProne, isClosing: true }),
    ).toBe(false)
  })
})

describe("the cap the box grows into", () => {
  it("is the viewport minus the notch, and nothing to do with the keyboard", async () => {
    //the keyboard is answered by growing + holding room, NOT by shrinking this. An earlier pass
    //subtracted the keyboard height here; it produced the same resting geometry and a much worse
    //motion, because the box then had to shrink while the panel translated up to compensate.
    const css = await compileAdaptvStyles(
      DRAWER_CONTENT_LAYOUT_CLASS.split(" "),
    )
    expect(css).toContain(
      "max-height: calc(100vh - var(--adaptv-inset-top))",
    )
    expect(css).toContain("max-height: 97dvh")
    //no keyboard term anywhere in the cap — the room effect owns that, inline and imperatively
    expect(css).not.toContain("--adaptv-drawer-keyboard")
  })
})

/*
 * Bring a focused field into view — and do NOTHING when it is already there.
 *
 * The fix under test: `scrollDrawerInputIntoView` used to align the field to the TOP of the scroller
 * unconditionally, so a perfectly visible field 40px down still scrolled 40px — sliding its label
 * under the drag handle. It must now be a no-op when the field is in view, and otherwise nudge by the
 * SMALLEST amount that clears the edge, never align-to-top.
 *
 * The geometry is faked because happy-dom lays nothing out: getBoundingClientRect and the scroll
 * metrics are stubbed to describe a 300px window over 1000px of content.
 */
const VIEW_TOP = 100 //the scroller's own top in viewport coords
const CLIENT_H = 300
const SCROLL_H = 1000

function makeScroller(scrollTop: number): HTMLElement {
  const el = document.createElement("div")
  Object.defineProperty(el, "clientHeight", { value: CLIENT_H })
  Object.defineProperty(el, "scrollHeight", { value: SCROLL_H })
  el.scrollTop = scrollTop
  el.getBoundingClientRect = () =>
    ({ top: VIEW_TOP, height: CLIENT_H }) as DOMRect
  el.scrollTo = vi.fn() as unknown as typeof el.scrollTo
  return el
}

//a field whose top sits `contentTop` px down the scroller's CONTENT (not the viewport), rendered at
//the viewport position that content position currently maps to
function makeField(
  contentTop: number,
  scroller: HTMLElement,
  height = 40,
): HTMLElement {
  const el = document.createElement("input")
  const viewportTop = VIEW_TOP + contentTop - scroller.scrollTop
  el.getBoundingClientRect = () =>
    ({ top: viewportTop, height }) as DOMRect
  return el
}

describe("scrollDrawerInputIntoView", () => {
  it("does nothing for a field already comfortably in view", () => {
    const scroller = makeScroller(0)
    //40px down at scrollTop 0 — visible, but the old align-to-top would have scrolled here
    const field = makeField(40, scroller)

    scrollDrawerInputIntoView(scroller, field)

    expect(scroller.scrollTo).not.toHaveBeenCalled()
  })

  it("nudges up by the minimum when the field sits above the window", () => {
    const scroller = makeScroller(200)
    //content-top 150 is 50px above the current viewTop (200) → just clear it, don't align to top
    const field = makeField(150, scroller)

    scrollDrawerInputIntoView(scroller, field)

    //target = inputTop - MARGIN = 150 - 12 = 138
    expect(scroller.scrollTo).toHaveBeenCalledWith(
      expect.objectContaining({ top: 138 }),
    )
  })

  it("nudges down by the minimum when the field falls below the window", () => {
    const scroller = makeScroller(0)
    //content-top 350 is below the 300px window → reveal its bottom, not align its top
    const field = makeField(350, scroller)

    scrollDrawerInputIntoView(scroller, field)

    //target = inputBottom - clientHeight + MARGIN = 390 - 300 + 12 = 102 (NOT 338 = align-to-top)
    expect(scroller.scrollTo).toHaveBeenCalledWith(
      expect.objectContaining({ top: 102 }),
    )
  })

  it("clamps the target to the scrollable range", () => {
    const scroller = makeScroller(0)
    //a field far past the end would target beyond max scroll; clamp to scrollHeight - clientHeight
    const field = makeField(2000, scroller)

    scrollDrawerInputIntoView(scroller, field)

    expect(scroller.scrollTo).toHaveBeenCalledWith(
      expect.objectContaining({ top: SCROLL_H - CLIENT_H }),
    )
  })

  it("does not scroll for a sub-pixel correction", () => {
    const scroller = makeScroller(0)
    //field bottom exactly at the margin edge — the computed target rounds to the current scrollTop
    const field = makeField(CLIENT_H - 12 - 40, scroller) //inputBottom = viewBottom - MARGIN

    scrollDrawerInputIntoView(scroller, field)

    expect(scroller.scrollTo).not.toHaveBeenCalled()
  })
})
