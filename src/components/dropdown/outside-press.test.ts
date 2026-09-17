import { afterEach, describe, expect, it, vi } from "vitest"
import { gestureController } from "#adaptv/capabilities/gesture-controller"
import { subscribeOutsidePress } from "#adaptv/components/dropdown/outside-press"

/**
 * The outside press is the one dismissal path that competes with a gesture for
 * the same finger. Order matters: a touch's `pointerdown` precedes its
 * `touchstart`, and `touchstart` is where the edge swipe claims the arbiter.
 */

let unsubscribe = () => {}
afterEach(() => {
  unsubscribe()
  gestureController.release("edge-swipe")
})

function subscribe(inside: Element) {
  const onOutside = vi.fn()
  unsubscribe = subscribeOutsidePress(
    (t) => inside.contains(t as Node),
    onOutside,
  )
  return onOutside
}

describe("subscribeOutsidePress", () => {
  it("a mouse pointerdown outside dismisses at once", () => {
    const panel = document.body.appendChild(document.createElement("div"))
    const onOutside = subscribe(panel)
    document.body.dispatchEvent(
      new PointerEvent("pointerdown", {
        pointerType: "mouse",
        bubbles: true,
      }),
    )
    expect(onOutside).toHaveBeenCalledTimes(1)
  })

  it("a mouse pointerdown inside does not", () => {
    const panel = document.body.appendChild(document.createElement("div"))
    const onOutside = subscribe(panel)
    panel.dispatchEvent(
      new PointerEvent("pointerdown", {
        pointerType: "mouse",
        bubbles: true,
      }),
    )
    expect(onOutside).not.toHaveBeenCalled()
  })

  it("a touch pointerdown decides nothing; its touchstart dismisses", () => {
    const panel = document.body.appendChild(document.createElement("div"))
    const onOutside = subscribe(panel)
    document.body.dispatchEvent(
      new PointerEvent("pointerdown", {
        pointerType: "touch",
        bubbles: true,
      }),
    )
    expect(onOutside).not.toHaveBeenCalled()
    document.body.dispatchEvent(
      new TouchEvent("touchstart", { bubbles: true }),
    )
    expect(onOutside).toHaveBeenCalledTimes(1)
  })

  it("a touch a gesture already owns is not a press", () => {
    //the edge swipe claims on a document-level touchstart listener, which runs
    //before the window-level one this helper installs
    const panel = document.body.appendChild(document.createElement("div"))
    const onOutside = subscribe(panel)
    document.addEventListener(
      "touchstart",
      () => gestureController.requestCapture("edge-swipe", 400),
      { once: true },
    )
    document.body.dispatchEvent(
      new PointerEvent("pointerdown", {
        pointerType: "touch",
        bubbles: true,
      }),
    )
    document.body.dispatchEvent(
      new TouchEvent("touchstart", { bubbles: true }),
    )
    expect(gestureController.getCaptured()).toBe("edge-swipe")
    expect(onOutside).not.toHaveBeenCalled()
  })

  it("unsubscribing removes both listeners", () => {
    const panel = document.body.appendChild(document.createElement("div"))
    const onOutside = subscribe(panel)
    unsubscribe()
    document.body.dispatchEvent(
      new PointerEvent("pointerdown", {
        pointerType: "mouse",
        bubbles: true,
      }),
    )
    document.body.dispatchEvent(
      new TouchEvent("touchstart", { bubbles: true }),
    )
    expect(onOutside).not.toHaveBeenCalled()
  })
})
