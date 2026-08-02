import { describe, expect, it } from "vitest"
import { DRAWER_CONTENT_LAYOUT_CLASS } from "#adaptv/components/drawer/drawer-engine"
import { resolveDrawerKeyboardRoom } from "#adaptv/components/drawer/drawer-keyboard"
import { compileAdaptvStyles } from "#adaptv/styles/compile.test-helper"

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
