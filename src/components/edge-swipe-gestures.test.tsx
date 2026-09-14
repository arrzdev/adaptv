import { act, cleanup, render } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { gestureController } from "#adaptv/capabilities/gesture-controller"
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

/*
 * The shared arbiter claim. An edge touch claims at touchstart so a row swipe or
 * a drawer drag under the same finger is suppressed, which makes every way the
 * edge gesture is abandoned a way to leave the pointer held — and a held claim
 * deadens every lower-priority gesture on the screen until something releases
 * it, with no error anywhere.
 */
describe("EdgeSwipeGestures · the arbiter claim", () => {
  afterEach(() => {
    //a leaked claim would otherwise carry into the next test through the singleton
    gestureController.release(gestureController.getCaptured() ?? "")
  })

  //touches[] is every finger still down; changedTouches[] the one that changed
  function touches(
    type: string,
    down: Point[],
    changed: Point = down[0] ?? { clientX: 0, clientY: 0 },
  ): Event {
    const event = new Event(type, { bubbles: true })
    Object.defineProperty(event, "touches", { value: down })
    Object.defineProperty(event, "changedTouches", { value: [changed] })
    return event
  }
  const fire = (event: Event) =>
    act(() => {
      document.dispatchEvent(event)
    })

  const EDGE = { clientX: 5, clientY: 300 }
  const MIDDLE = { clientX: 200, clientY: 300 }

  it("holds the claim from an edge touchstart until that finger lifts", () => {
    render(<EdgeSwipeGestures left={vi.fn()} />)
    fire(touches("touchstart", [EDGE]))
    expect(gestureController.getCaptured()).not.toBeNull()
    fire(touches("touchend", [], EDGE))
    expect(gestureController.getCaptured()).toBeNull()
  })

  it("a second finger abandons the edge gesture and gives the claim back", () => {
    const left = vi.fn()
    render(<EdgeSwipeGestures left={left} />)
    fire(touches("touchstart", [EDGE]))
    fire(touches("touchstart", [EDGE, MIDDLE], MIDDLE))
    expect(gestureController.getCaptured()).toBeNull()
    fire(touches("touchend", [EDGE], MIDDLE))
    fire(touches("touchend", [], { clientX: 200, clientY: 305 }))
    expect(gestureController.getCaptured()).toBeNull()
    expect(left).not.toHaveBeenCalled()
  })

  it("a touch whose end never arrived is given back when the next touch starts", () => {
    render(<EdgeSwipeGestures left={vi.fn()} />)
    fire(touches("touchstart", [EDGE]))
    //no touchend or touchcancel for it; the next finger lands mid-screen
    fire(touches("touchstart", [MIDDLE]))
    expect(gestureController.getCaptured()).toBeNull()
  })

  it("re-binding mid-touch (a new edgeZone) does not strand the claim", () => {
    const { rerender } = render(<EdgeSwipeGestures left={vi.fn()} />)
    fire(touches("touchstart", [EDGE]))
    expect(gestureController.getCaptured()).not.toBeNull()
    rerender(<EdgeSwipeGestures left={vi.fn()} edgeZone={40} />)
    fire(touches("touchend", [], EDGE))
    expect(gestureController.getCaptured()).toBeNull()
  })

  it("a touchcancel gives the claim back", () => {
    render(<EdgeSwipeGestures left={vi.fn()} />)
    fire(touches("touchstart", [EDGE]))
    fire(touches("touchcancel", []))
    expect(gestureController.getCaptured()).toBeNull()
  })
})
