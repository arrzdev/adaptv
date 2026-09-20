import { act, cleanup, render } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  BackPriority,
  registerBackHandler,
} from "#adaptv/capabilities/back-chain"
import { EdgeSwipeGestures } from "#adaptv/components/edge-swipe-gestures"

afterEach(cleanup)

type Point = { clientX: number; clientY: number }

//the component only reads touches[0] / changedTouches[0] / touches.length off the
//event, so a plain Event with those fields defined is enough to drive it
function touchEvent(type: string, point: Point): Event {
  const event = new Event(type, { bubbles: true })
  const isEnd = type === "touchend" || type === "touchcancel"
  Object.defineProperty(event, "touches", { value: isEnd ? [] : [point] })
  Object.defineProperty(event, "changedTouches", { value: [point] })
  return event
}

function swipe(from: Point, to: Point) {
  act(() => {
    document.dispatchEvent(touchEvent("touchstart", from))
    document.dispatchEvent(touchEvent("touchend", to))
  })
}

describe("EdgeSwipeGestures", () => {
  it("fires left on a left-edge rightward swipe past the threshold", () => {
    const left = vi.fn()
    render(<EdgeSwipeGestures left={left} />)
    swipe({ clientX: 5, clientY: 200 }, { clientX: 120, clientY: 205 })
    expect(left).toHaveBeenCalledTimes(1)
  })

  it("walks the back chain before firing left, so an open menu consumes the swipe", () => {
    //what the iPhone simulator showed with a Select open: the edge swipe popped
    //the route while the Android button, which runs the chain, closed the list
    const left = vi.fn()
    const menu = vi.fn(() => true)
    const unregister = registerBackHandler(menu, BackPriority.Transient)
    render(<EdgeSwipeGestures left={left} />)
    swipe({ clientX: 5, clientY: 200 }, { clientX: 120, clientY: 205 })
    expect(menu).toHaveBeenCalledTimes(1)
    expect(left).not.toHaveBeenCalled()
    unregister()
  })

  it("fires left when nothing in the chain claims the swipe", () => {
    const left = vi.fn()
    const deferring = vi.fn(() => false)
    const unregister = registerBackHandler(
      deferring,
      BackPriority.Transient,
    )
    render(<EdgeSwipeGestures left={left} />)
    swipe({ clientX: 5, clientY: 200 }, { clientX: 120, clientY: 205 })
    expect(deferring).toHaveBeenCalledTimes(1)
    expect(left).toHaveBeenCalledTimes(1)
    unregister()
  })

  it("a right-edge swipe is not a back press and never touches the chain", () => {
    const right = vi.fn()
    const menu = vi.fn(() => true)
    const unregister = registerBackHandler(menu, BackPriority.Transient)
    render(<EdgeSwipeGestures right={right} />)
    const w = window.innerWidth
    swipe(
      { clientX: w - 5, clientY: 200 },
      { clientX: w - 120, clientY: 205 },
    )
    expect(menu).not.toHaveBeenCalled()
    expect(right).toHaveBeenCalledTimes(1)
    unregister()
  })

  it("fires right on a right-edge leftward swipe", () => {
    const right = vi.fn()
    render(<EdgeSwipeGestures right={right} />)
    const w = window.innerWidth
    swipe(
      { clientX: w - 5, clientY: 200 },
      { clientX: w - 120, clientY: 205 },
    )
    expect(right).toHaveBeenCalledTimes(1)
  })

  it("ignores a vertical drag from the edge (it's a scroll, not a swipe)", () => {
    const left = vi.fn()
    render(<EdgeSwipeGestures left={left} />)
    swipe({ clientX: 5, clientY: 100 }, { clientX: 40, clientY: 400 })
    expect(left).not.toHaveBeenCalled()
  })

  it("ignores a swipe shorter than the threshold", () => {
    const left = vi.fn()
    render(<EdgeSwipeGestures left={left} />)
    swipe({ clientX: 5, clientY: 200 }, { clientX: 40, clientY: 205 })
    expect(left).not.toHaveBeenCalled()
  })

  it("ignores a swipe that starts away from an edge", () => {
    const left = vi.fn()
    render(<EdgeSwipeGestures left={left} />)
    swipe({ clientX: 200, clientY: 200 }, { clientX: 360, clientY: 205 })
    expect(left).not.toHaveBeenCalled()
  })

  it("does nothing when disabled", () => {
    const left = vi.fn()
    render(<EdgeSwipeGestures left={left} enabled={false} />)
    swipe({ clientX: 5, clientY: 200 }, { clientX: 220, clientY: 205 })
    expect(left).not.toHaveBeenCalled()
  })
})
