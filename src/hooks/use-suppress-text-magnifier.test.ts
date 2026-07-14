import { cleanup, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useSuppressTextMagnifier } from "#nativ/hooks/use-suppress-text-magnifier"

/* =============================================================================
 * SYNTHETIC TOUCH EVENTS
 *
 * The hook attaches real listeners to `document`, so the tests dispatch real
 * events on real elements. happy-dom has no `TouchEvent` constructor, so we
 * build a plain `Event` and graft the `touches` / `changedTouches` the hook
 * reads. Dispatching on an in-tree element gives it a real `target` so the
 * editable / interactive `closest()` checks resolve.
 * ============================================================================= */

type Point = { x: number; y: number }

function touchList(point: Point) {
  return [{ clientX: point.x, clientY: point.y }]
}

//dispatch a touch event of `type` from `target` and report whether the browser
//default was cancelled (i.e. the loupe would have been suppressed)
function fireTouch(
  type: "touchstart" | "touchmove" | "touchend",
  target: Element,
  point: Point,
  fingers = 1,
): boolean {
  const event = new Event(type, { bubbles: true, cancelable: true })
  //touchend lifts the last finger, so the active `touches` list is empty there
  const active =
    type === "touchend" ? [] : Array(fingers).fill(touchList(point)[0])
  Object.defineProperty(event, "touches", {
    value: active,
    configurable: true,
  })
  Object.defineProperty(event, "changedTouches", {
    value: touchList(point),
    configurable: true,
  })
  target.dispatchEvent(event)
  return event.defaultPrevented
}

//a complete clean tap: finger down then up at the same point, no movement
function tap(target: Element, point: Point) {
  fireTouch("touchstart", target, point)
  vi.advanceTimersByTime(40)
  fireTouch("touchend", target, point)
}

/* =============================================================================
 * FIXTURES
 * ============================================================================= */

function appendEl(html: { tag: string; attrs?: Record<string, string> }) {
  const el = document.createElement(html.tag)
  for (const [name, value] of Object.entries(html.attrs ?? {})) {
    el.setAttribute(name, value)
  }
  document.body.appendChild(el)
  return el
}

let plain: Element
let editable: Element
let clickable: Element

beforeEach(() => {
  vi.useFakeTimers()
  //start the clock well past 0 — the hook treats a 0 anchor as "no first tap"
  vi.setSystemTime(new Date("2026-01-01T00:00:00Z"))
  plain = appendEl({ tag: "div" })
  editable = appendEl({ tag: "input" })
  clickable = appendEl({ tag: "button", attrs: { class: "clickable" } })
  renderHook(() => useSuppressTextMagnifier())
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  document.body.innerHTML = ""
})

/* =============================================================================
 * TESTS
 * ============================================================================= */

describe("useSuppressTextMagnifier", () => {
  it("cancels the second tap of a genuine double-tap over plain content", () => {
    tap(plain, { x: 50, y: 50 })
    vi.advanceTimersByTime(120)
    const prevented = fireTouch("touchstart", plain, { x: 52, y: 51 })
    expect(prevented).toBe(true)
  })

  it("leaves a lone first tap alone", () => {
    const prevented = fireTouch("touchstart", plain, { x: 50, y: 50 })
    expect(prevented).toBe(false)
  })

  it("attaches nothing when the patch is disabled (enabled: false)", () => {
    //spy created after the default enabled render in beforeEach, so it only sees
    //the disabled render's calls — the gate should add zero touch listeners.
    const addSpy = vi.spyOn(document, "addEventListener")
    renderHook(() => useSuppressTextMagnifier({ enabled: false }))
    const touchListeners = addSpy.mock.calls.filter(([type]) =>
      String(type).startsWith("touch"),
    )
    expect(touchListeners).toHaveLength(0)
    addSpy.mockRestore()
  })

  it("never cancels a scroll flick that follows a scroll", () => {
    //first touch moves → it's a scroll, not a clean tap, so it arms nothing
    fireTouch("touchstart", plain, { x: 50, y: 50 })
    fireTouch("touchmove", plain, { x: 50, y: 95 })
    fireTouch("touchend", plain, { x: 50, y: 95 })
    vi.advanceTimersByTime(60)
    //a rapid follow-up flick from the same area must still scroll
    const prevented = fireTouch("touchstart", plain, { x: 50, y: 92 })
    expect(prevented).toBe(false)
  })

  it("does not chain across rapid tap-spam on the same point", () => {
    tap(plain, { x: 50, y: 50 })
    vi.advanceTimersByTime(120)
    //the real second tap is suppressed...
    expect(fireTouch("touchstart", plain, { x: 50, y: 50 })).toBe(true)
    fireTouch("touchend", plain, { x: 50, y: 50 })
    //...but the next tap is not — the consumed tap doesn't re-arm a pair
    vi.advanceTimersByTime(120)
    expect(fireTouch("touchstart", plain, { x: 50, y: 50 })).toBe(false)
  })

  it("ignores a second tap outside the double-tap time window", () => {
    tap(plain, { x: 50, y: 50 })
    vi.advanceTimersByTime(500)
    const prevented = fireTouch("touchstart", plain, { x: 50, y: 50 })
    expect(prevented).toBe(false)
  })

  it("ignores a second tap outside the double-tap radius", () => {
    tap(plain, { x: 50, y: 50 })
    vi.advanceTimersByTime(120)
    const prevented = fireTouch("touchstart", plain, { x: 50, y: 120 })
    expect(prevented).toBe(false)
  })

  it("ignores multi-touch (pinch/zoom)", () => {
    tap(plain, { x: 50, y: 50 })
    vi.advanceTimersByTime(120)
    const prevented = fireTouch("touchstart", plain, { x: 52, y: 51 }, 2)
    expect(prevented).toBe(false)
  })

  it("leaves editable targets native (keeps the caret loupe)", () => {
    tap(editable, { x: 50, y: 50 })
    vi.advanceTimersByTime(120)
    const prevented = fireTouch("touchstart", editable, { x: 50, y: 50 })
    expect(prevented).toBe(false)
  })

  it("leaves interactive .clickable targets native", () => {
    tap(clickable, { x: 50, y: 50 })
    vi.advanceTimersByTime(120)
    const prevented = fireTouch("touchstart", clickable, { x: 50, y: 50 })
    expect(prevented).toBe(false)
  })
})
