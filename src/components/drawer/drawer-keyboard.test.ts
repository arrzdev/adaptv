import { describe, expect, it, vi } from "vitest"
import {
  DRAWER_CONTENT_LAYOUT_CLASS,
  DRAWER_CONTENT_MAX_HEIGHT_VAR,
} from "#adaptv/components/drawer/drawer-engine"
import {
  readDrawerStylesheetCap,
  resolveDrawerKeyboardRoom,
  resolveShrunkViewportCap,
  scrollDrawerInputIntoView,
  shouldPrimeKeyboardFloor,
  unpaidKeyboardHeight,
  viewportShrinksUnderKeyboard,
} from "#adaptv/components/drawer/drawer-keyboard"
import { compileAdaptvStyles } from "#adaptv/styles/compile.test-helper"
import { resolveCompiledLength } from "#adaptv/styles/viewport-units.test-helper"

//the caret repaint is a real DOM side effect irrelevant to the scroll maths under test
vi.mock("#adaptv/hooks/use-caret-repaint", () => ({
  beginCaretHold: () => () => {},
  preMuteCaret: () => {},
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
    expect(css).toContain("calc(100vh - var(--adaptv-inset-top))")
    expect(css).toContain("97dvh")
    //no keyboard term anywhere in the cap — the room effect owns that, inline and imperatively
    expect(css).not.toContain("--adaptv-drawer-keyboard")
  })

  /*
   * The consumer's cap rides in as a variable, and it is the first term of a `min()` — so it can
   * only ever ask the sheet to stop HIGHER. That ordering is the whole guarantee: a drawer that
   * reaches the screen edge stops being a drawer, so the platform ceiling is adaptv's to keep.
   *
   * Tailwind is the failure mode worth a test here rather than a comment. An arbitrary value it
   * cannot parse emits NOTHING — no error, no rule, just a class that never matches — so the cap
   * would silently become "whatever the content is" and the sheet would grow to the full viewport
   * on a device nobody re-measured.
   */
  it("lets the consumer's variable lower it, never raise it", async () => {
    const css = await compileAdaptvStyles(
      DRAWER_CONTENT_LAYOUT_CLASS.split(" "),
    )
    //both platform caps went through Tailwind intact, each behind the consumer's term
    expect(css).toContain(
      "max-height: min(var(--pwa-drawer-max-height,100vh), calc(100vh - var(--adaptv-inset-top)))",
    )
    expect(css).toContain(
      "max-height: min(var(--pwa-drawer-max-height,100vh), 97dvh)",
    )
    //`100vh` is `lvh` and both ceilings are strictly under it, so an unset variable resolves
    //the `min()` to the platform cap unchanged — the default is not a behaviour change
    expect(css).not.toContain("max-height: var(--pwa-drawer-max-height)")
  })

  it("is the box an installed app can show, on iOS 26 as on iOS 18", async () => {
    const cap = (surface: Parameters<typeof resolveCompiledLength>[2]) =>
      resolveCompiledLength(
        DRAWER_CONTENT_LAYOUT_CLASS,
        "max-height",
        surface,
      )
    //iOS 26.1 installed: the page starts 62pt down the 874pt screen, below the status bar, with
    //a top inset of 0, and 100dvh is 812 while 100vh is still 874. A 100vh cap made a tall sheet
    //874pt tall, so its handle and title slid 62pt up under the status bar.
    expect(
      await cap({
        platform: "standalone",
        vh: 874,
        dvh: 812,
        insetTop: 0,
      }),
    ).toBe(812)
    //iOS 18.0 installed runs under the status bar: the screen minus the 59pt inset, as before,
    //whether 100dvh reads 852 (the playground) or 793 (a static installed page)
    expect(
      await cap({
        platform: "standalone",
        vh: 852,
        dvh: 852,
        insetTop: 59,
      }),
    ).toBe(793)
    expect(
      await cap({
        platform: "standalone",
        vh: 852,
        dvh: 793,
        insetTop: 59,
      }),
    ).toBe(793)
    //the consumer's request still wins when it is lower
    expect(
      await cap({
        platform: "standalone",
        vh: 874,
        dvh: 812,
        insetTop: 0,
        vars: { "--pwa-drawer-max-height": "60dvh" },
      }),
    ).toBeCloseTo(487.2)
    //native stays on the layout viewport whatever the dynamic one does, and a tab on 97dvh
    expect(
      await cap({ platform: "native", vh: 852, dvh: 500, insetTop: 59 }),
    ).toBe(793)
    expect(
      await cap({ platform: "web", vh: 754, dvh: 714, insetTop: 0 }),
    ).toBeCloseTo(692.58)
  })

  it("keeps the cap on the content box — never on the panel, which carries the tail", () => {
    //the panel is sheet + hidden tail (`bottom: -excess` + a spacer), so a cap there is spent on
    //the tail first. This constant is the one that must own it.
    expect(DRAWER_CONTENT_LAYOUT_CLASS).toContain("max-h-")
    expect(DRAWER_CONTENT_LAYOUT_CLASS).toContain(
      DRAWER_CONTENT_MAX_HEIGHT_VAR,
    )
  })
})

/*
 * The shrunk-viewport path: the layout viewport has already lost the keyboard, so the room
 * mechanism must NOT run (reserving room on top of the shrink double-counts: a keyboard-sized blank
 * band above the keyboard and the footer below the viewport). The sheet instead holds no room and
 * caps at what is visible. Two ways in — measured, when `useLayoutViewportShrink` reports a shrink
 * that covers the keyboard (the Android WebView under Capacitor 8, `innerHeight` 923 → 587 for a
 * 336px keyboard); and guessed, for VK-less non-iOS Chromium (a plain-http ip:port LAN build), where
 * `useFreezeViewport` has no API to hold the viewport and the shrink is known before it can be
 * measured. iOS (scroll-lock, the OS resize off, shrink 0) stays on the room path.
 */
describe("viewportShrinksUnderKeyboard", () => {
  it("is true only for VK-less, non-iOS, non-native (non-secure Chromium web)", () => {
    expect(
      viewportShrinksUnderKeyboard({
        isIOS: false,
        hasNativeKeyboard: false,
        hasVirtualKeyboardApi: false,
      }),
    ).toBe(true)
  })

  it("is false on iOS — the scroll-lock freeze needs no API", () => {
    expect(
      viewportShrinksUnderKeyboard({
        isIOS: true,
        hasNativeKeyboard: false,
        hasVirtualKeyboardApi: false,
      }),
    ).toBe(false)
  })

  it("is false on native until the layout viewport is measured to have shrunk", () => {
    expect(
      viewportShrinksUnderKeyboard({
        isIOS: false,
        hasNativeKeyboard: true,
        hasVirtualKeyboardApi: false,
        keyboardHeight: 336,
        layoutShrink: 0,
      }),
    ).toBe(false)
  })

  it("is true on native once the shrink covers the keyboard — the Android WebView pays for it", () => {
    //Pixel 10 emulator: innerHeight 923 → 587 for a 336px keyboard, overlaysContent true throughout
    expect(
      viewportShrinksUnderKeyboard({
        isIOS: false,
        hasNativeKeyboard: true,
        hasVirtualKeyboardApi: true,
        keyboardHeight: 336,
        layoutShrink: 336,
      }),
    ).toBe(true)
    //a sub-pixel disagreement between the plugin's height and the inset padding still counts
    expect(
      viewportShrinksUnderKeyboard({
        isIOS: false,
        hasNativeKeyboard: true,
        hasVirtualKeyboardApi: true,
        keyboardHeight: 336,
        layoutShrink: 335,
      }),
    ).toBe(true)
  })

  it("is false for a partial shrink — the remainder is room, not a cap", () => {
    expect(
      viewportShrinksUnderKeyboard({
        isIOS: false,
        hasNativeKeyboard: true,
        hasVirtualKeyboardApi: true,
        keyboardHeight: 360,
        layoutShrink: 336,
      }),
    ).toBe(false)
  })

  it("stays true while the cap is held, so the keyboard's close releases it on the same path", () => {
    expect(
      viewportShrinksUnderKeyboard({
        isIOS: false,
        hasNativeKeyboard: true,
        hasVirtualKeyboardApi: true,
        keyboardHeight: 0,
        layoutShrink: 0,
        capHeld: true,
      }),
    ).toBe(true)
  })

  it("is false in a secure context — overlaysContent holds the layout height", () => {
    expect(
      viewportShrinksUnderKeyboard({
        isIOS: false,
        hasNativeKeyboard: false,
        hasVirtualKeyboardApi: true,
      }),
    ).toBe(false)
  })
})

describe("unpaidKeyboardHeight", () => {
  it("is the whole keyboard when the viewport kept its height (iOS)", () => {
    expect(unpaidKeyboardHeight(345, 0)).toBe(345)
  })

  it("is zero when the viewport gave the whole keyboard up (the Android WebView)", () => {
    expect(unpaidKeyboardHeight(336, 336)).toBe(0)
  })

  it("is the remainder for a partial shrink, and never negative", () => {
    expect(unpaidKeyboardHeight(360, 336)).toBe(24)
    expect(unpaidKeyboardHeight(336, 400)).toBe(0)
    expect(unpaidKeyboardHeight(336, -5)).toBe(336)
  })
})

describe("readDrawerStylesheetCap", () => {
  it("reads the stylesheet's cap under the engine's inline override and puts the override back", () => {
    const style = document.createElement("style")
    style.textContent = ".capped { max-height: 533px }"
    document.head.append(style)
    const el = document.createElement("div")
    el.className = "capped"
    el.style.maxHeight = "250.667px"
    document.body.append(el)

    expect(readDrawerStylesheetCap(el)).toBe(533)
    expect(el.style.maxHeight).toBe("250.667px")

    el.remove()
    style.remove()
  })

  it("is unbounded when the stylesheet sets none", () => {
    const el = document.createElement("div")
    document.body.append(el)
    expect(readDrawerStylesheetCap(el)).toBe(Number.POSITIVE_INFINITY)
    el.remove()
  })
})

describe("resolveShrunkViewportCap", () => {
  it("caps at the visible viewport when it is shorter than the stylesheet cap", () => {
    //keyboard up: 423 of viewport is left above it, well under the 812 dvh cap → fit the 423
    expect(resolveShrunkViewportCap(true, 423, 812)).toBe(423)
  })

  it("keeps the stylesheet cap when the viewport is the taller of the two", () => {
    //a short keyboard on a tall screen: the stylesheet cap still binds
    expect(resolveShrunkViewportCap(true, 812, 600)).toBe(600)
  })

  it("returns null while the keyboard is closed — the box rides the stylesheet cap", () => {
    expect(resolveShrunkViewportCap(false, 423, 812)).toBeNull()
  })

  it("returns null for a non-positive viewport (never seen a real measurement)", () => {
    expect(resolveShrunkViewportCap(true, 0, 812)).toBeNull()
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
