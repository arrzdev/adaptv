import { beforeEach, describe, expect, it, vi } from "vitest"
import { createGestureController } from "#adaptv/capabilities/gesture-controller"

let controller: ReturnType<typeof createGestureController>

beforeEach(() => {
  controller = createGestureController()
})

describe("capture — one gesture owns the pointer at a time", () => {
  //Drawer drag, Swipeable row, ScrollView and edge-swipe-back all compete for the
  //same pointer stream on a real screen. Exactly one may win; without a shared
  //arbiter each handler is blind to the others and two can start at once.
  it("grants the first request", () => {
    expect(controller.requestCapture("drawer", 10)).toBe(true)
    expect(controller.getCaptured()).toBe("drawer")
  })

  it("refuses a lower-priority request while captured", () => {
    controller.requestCapture("drawer", 10)
    expect(controller.requestCapture("swipeable", 5)).toBe(false)
    expect(controller.getCaptured()).toBe("drawer")
  })

  it("refuses an EQUAL-priority request — first wins, no thrash", () => {
    //ties must not pre-empt: two same-priority handlers would otherwise steal the
    //pointer back and forth on every move event
    controller.requestCapture("a", 10)
    expect(controller.requestCapture("b", 10)).toBe(false)
    expect(controller.getCaptured()).toBe("a")
  })

  it("lets a strictly higher priority pre-empt", () => {
    //edge-swipe-back must be able to take the pointer from a list scroll
    controller.requestCapture("scroll", 5)
    expect(controller.requestCapture("edge-swipe", 10)).toBe(true)
    expect(controller.getCaptured()).toBe("edge-swipe")
  })

  it("notifies the pre-empted gesture so it can reset its own state", () => {
    //without this the loser stays mid-drag forever: its onEnd never fires and the
    //element is left translated
    const onLost = vi.fn()
    controller.requestCapture("scroll", 5, onLost)
    controller.requestCapture("edge-swipe", 10)
    expect(onLost).toHaveBeenCalledOnce()
  })

  it("does not notify the winner when it re-requests its own capture", () => {
    const onLost = vi.fn()
    controller.requestCapture("drawer", 10, onLost)
    controller.requestCapture("drawer", 10, onLost)
    expect(onLost).not.toHaveBeenCalled()
  })
})

describe("release", () => {
  it("frees the pointer for the next gesture", () => {
    controller.requestCapture("drawer", 10)
    controller.release("drawer")
    expect(controller.getCaptured()).toBeNull()
    expect(controller.requestCapture("swipeable", 1)).toBe(true)
  })

  it("ignores a release from a gesture that no longer owns the capture", () => {
    //a pre-empted gesture's cleanup must not free the pointer out from under the
    //gesture that took it — a real ordering hazard, since the loser's own
    //pointerup often arrives AFTER the winner started
    controller.requestCapture("scroll", 5)
    controller.requestCapture("edge-swipe", 10)
    controller.release("scroll")
    expect(controller.getCaptured()).toBe("edge-swipe")
  })

  it("is safe to release when nothing is captured", () => {
    expect(() => controller.release("nobody")).not.toThrow()
  })
})

describe("scroll blocking", () => {
  //`touch-action` cannot be changed mid-touch on iOS, so blocking the scroller
  //while a drag owns the pointer is the only reliable cross-platform mechanism.
  it("reports blocked while a blocking gesture holds the capture", () => {
    controller.requestCapture("drawer", 10, undefined, {
      blocksScroll: true,
    })
    expect(controller.isScrollBlocked()).toBe(true)
  })

  it("does not block for a non-blocking gesture", () => {
    controller.requestCapture("tap", 10)
    expect(controller.isScrollBlocked()).toBe(false)
  })

  it("stops blocking on release", () => {
    controller.requestCapture("drawer", 10, undefined, {
      blocksScroll: true,
    })
    controller.release("drawer")
    expect(controller.isScrollBlocked()).toBe(false)
  })

  it("stops blocking when a non-blocking gesture pre-empts", () => {
    controller.requestCapture("drawer", 5, undefined, {
      blocksScroll: true,
    })
    controller.requestCapture("edge-swipe", 10)
    expect(controller.isScrollBlocked()).toBe(false)
  })
})

describe("disable", () => {
  it("refuses capture for a disabled gesture", () => {
    controller.setEnabled("drawer", false)
    expect(controller.requestCapture("drawer", 10)).toBe(false)
  })

  it("releases the capture if the holder is disabled mid-gesture", () => {
    //a drawer unmounting mid-drag must not leave the pointer permanently held —
    //that would silently deaden every gesture on the screen
    const onLost = vi.fn()
    controller.requestCapture("drawer", 10, onLost)
    controller.setEnabled("drawer", false)
    expect(controller.getCaptured()).toBeNull()
    expect(onLost).toHaveBeenCalledOnce()
  })

  it("can be re-enabled", () => {
    controller.setEnabled("drawer", false)
    controller.setEnabled("drawer", true)
    expect(controller.requestCapture("drawer", 10)).toBe(true)
  })
})
