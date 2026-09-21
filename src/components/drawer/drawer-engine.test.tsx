import { act, render } from "@testing-library/react"
import { createRef } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { gestureController } from "#adaptv/capabilities/gesture-controller"
import type { DrawerHandle } from "#adaptv/components/drawer"
import { Drawer } from "#adaptv/components/drawer"
import { drawerReleaseCloses } from "#adaptv/components/drawer/drawer-constants"
import { EdgeSwipeGestures } from "#adaptv/components/edge-swipe-gestures"
import { Swipeable } from "#adaptv/components/swipeable"
import type { GestureCapture } from "#adaptv/hooks/use-gesture-capture"
import {
  GesturePriority,
  useGestureCapture,
} from "#adaptv/hooks/use-gesture-capture"

//the release decision is recorded, not replaced: the real function still decides, the spy only
//says whether the engine asked it and with what start time
vi.mock(
  "#adaptv/components/drawer/drawer-constants",
  async (importOriginal) => {
    const real =
      await importOriginal<
        typeof import("#adaptv/components/drawer/drawer-constants")
      >()
    return {
      ...real,
      drawerReleaseCloses: vi.fn(real.drawerReleaseCloses),
    }
  },
)

//the caret repaint is a real DOM side effect irrelevant to the gesture under test
vi.mock("#adaptv/hooks/use-caret-repaint", () => ({
  beginCaretHold: () => () => {},
  preMuteCaret: () => {},
}))

const releaseSpy = vi.mocked(drawerReleaseCloses)

//happy-dom lays nothing out, so the engine would measure a 0px sheet and never close from a drag.
//400px of content is the geometry the release decision reads (closedY = 400).
const CONTENT_HEIGHT = 400

/*
 * A drawer drag that a higher-priority gesture pre-empts must END, not pause.
 *
 * The arbiter's contract (`useGestureCapture`): `onLost` is where a loser resets. The whole-sheet
 * touch drag keeps its own "this touch is mine" flag, and the drag has to stop reading the finger
 * the moment it loses the pointer — otherwise the sheet snaps open on the pre-emption and then
 * jumps back under the finger on the very next move, and the touchend decides close-or-snap for a
 * gesture the drawer no longer owns.
 */

/** Stands in for any gesture that outranks a drawer drag — the edge swipe's band, claimed the way it claims. */
function Outranker({ expose }: { expose: (c: GestureCapture) => void }) {
  expose(useGestureCapture({ priority: GesturePriority.EdgeSwipe }))
  return null
}

function touch(target: Element, clientY: number): Touch {
  return new Touch({ identifier: 1, target, clientX: 200, clientY })
}

function dispatchTouch(
  target: Element,
  type: "touchstart" | "touchmove" | "touchend",
  clientY: number,
) {
  const point = touch(target, clientY)
  act(() => {
    target.dispatchEvent(
      new TouchEvent(type, {
        bubbles: true,
        cancelable: true,
        touches: type === "touchend" ? [] : [point],
        changedTouches: [point],
      }),
    )
  })
}

async function mountOpenDrawer() {
  //the content box is the panel's first child; it has to measure before the open can even start
  const measure = HTMLElement.prototype.getBoundingClientRect
  vi.spyOn(
    HTMLElement.prototype,
    "getBoundingClientRect",
  ).mockImplementation(function (this: HTMLElement) {
    return this.parentElement?.hasAttribute("data-pwa-drawer")
      ? DOMRect.fromRect({ width: 390, height: CONTENT_HEIGHT })
      : measure.call(this)
  })
  const onOpenChange = vi.fn()
  const onAnimationEnd = vi.fn()
  let outranker!: GestureCapture
  const drawer = createRef<DrawerHandle>()
  const { baseElement } = render(
    <>
      <Outranker
        expose={(c) => {
          outranker = c
        }}
      />
      <Drawer
        ref={drawer}
        onOpenChange={onOpenChange}
        onAnimationEnd={onAnimationEnd}
      >
        <Drawer.Portal>
          <Drawer.Overlay />
          <Drawer.Content>
            <p data-testid="body">body</p>
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer>
    </>,
  )
  //opened after mount, the way a sheet is presented, so the panel mounts straight into its portal
  act(() => drawer.current?.show())
  onOpenChange.mockClear()
  //gesture on a settled sheet, so nothing of the open animation is still writing the transform
  await vi.waitFor(() => expect(onAnimationEnd).toHaveBeenCalledWith(true))
  const panel = baseElement.querySelector<HTMLElement>("[data-pwa-drawer]")
  const backdrop = baseElement.querySelector<HTMLElement>(
    "[data-pwa-drawer-overlay]",
  )
  const body = baseElement.querySelector<HTMLElement>("[data-testid=body]")
  if (!panel || !backdrop || !body) throw new Error("drawer did not mount")
  releaseSpy.mockClear()

  return {
    panel,
    backdrop,
    body,
    onOpenChange,
    outranker: () => outranker,
  }
}

function translateY(panel: HTMLElement): number {
  const match = /translate3d\(0(?:px)?, (-?[\d.]+)px, 0(?:px)?\)/.exec(
    panel.style.transform,
  )
  if (!match)
    throw new Error(`unexpected transform "${panel.style.transform}"`)
  return Number(match[1])
}

//comfortably past the close duration's timer fallback (no getAnimations in happy-dom)
function settle(ms = 700) {
  return act(() => new Promise((resolve) => setTimeout(resolve, ms)))
}

afterEach(() => {
  vi.restoreAllMocks()
  //a test that fails mid-gesture must not leave the shared arbiter held for the next one
  const held = gestureController.getCaptured()
  if (held) gestureController.release(held)
})

describe("the whole-sheet touch drag", () => {
  it("premise: moves under the finger and a long drag closes the sheet", async () => {
    const { panel, body, onOpenChange } = await mountOpenDrawer()

    dispatchTouch(body, "touchstart", 100)
    //past the 4px slop: the drag commits and anchors at this finger position
    dispatchTouch(body, "touchmove", 110)
    dispatchTouch(body, "touchmove", 250)
    expect(translateY(panel)).toBe(140)

    dispatchTouch(body, "touchmove", 480)
    expect(translateY(panel)).toBe(370)

    dispatchTouch(body, "touchend", 480)
    expect(releaseSpy).toHaveBeenCalledOnce()
    const [draggedDown, startTime] = releaseSpy.mock.calls[0]
    expect(draggedDown).toBe(370)
    expect(typeof startTime).toBe("number")
    expect(releaseSpy.mock.results[0].value).toBe(true)

    await vi.waitFor(() =>
      expect(onOpenChange).toHaveBeenCalledWith(false),
    )
  })

  it("stops following the finger once a higher-priority gesture pre-empts it", async () => {
    const { panel, backdrop, body, onOpenChange, outranker } =
      await mountOpenDrawer()

    dispatchTouch(body, "touchstart", 100)
    dispatchTouch(body, "touchmove", 110)
    dispatchTouch(body, "touchmove", 250)
    expect(translateY(panel)).toBe(140)
    const drawerCapture = gestureController.getCaptured()
    expect(drawerCapture).not.toBeNull()

    //the pre-emption, through the arbiter's public API
    act(() => {
      expect(outranker().request()).toBe(true)
    })
    expect(gestureController.getCaptured()).not.toBe(drawerCapture)
    //onLost snapped the sheet home and dropped the drag styling
    expect(translateY(panel)).toBe(0)
    expect.soft(backdrop.dataset.dragging).toBe("false")

    //the same finger keeps moving: the sheet is no longer the drawer's to move
    dispatchTouch(body, "touchmove", 480)
    expect.soft(translateY(panel)).toBe(0)
    //twice: a touch still marked active would re-anchor on the first move and follow the second,
    //which the release spy alone cannot see once the release function is renamed or inlined
    dispatchTouch(body, "touchmove", 600)
    expect.soft(translateY(panel)).toBe(0)

    //and lifting it decides nothing — no release read with a null start time, no close. Soft, so
    //a regression reports every consequence at once rather than only the first
    dispatchTouch(body, "touchend", 480)
    expect.soft(releaseSpy).not.toHaveBeenCalled()
    await settle()
    expect.soft(onOpenChange).not.toHaveBeenCalled()
    expect.soft(backdrop.dataset.state).toBe("open")
    expect.soft(translateY(panel)).toBe(0)
    //the winner still holds the pointer — the loser's touchend must not free it
    expect.soft(outranker().isCaptured()).toBe(true)

    //a fresh touch after the winner lets go is a normal drag again
    act(() => outranker().release())
    dispatchTouch(body, "touchstart", 100)
    dispatchTouch(body, "touchmove", 110)
    dispatchTouch(body, "touchmove", 200)
    expect(translateY(panel)).toBe(90)
    dispatchTouch(body, "touchend", 200)
  })
})

/*
 * A drag that begins while the sheet is still sliding open.
 *
 * The open is a CSS keyframe, and a running keyframe outranks the inline transform. So at the
 * moment the drag commits the sheet is PAINTED somewhere down the curve while the inline style
 * already says 0 (the target). A takeover that only switched the transition off dropped the
 * keyframe without committing its live value: the sheet snapped to 0 and every finger frame after
 * that was measured from there — it moved UP against a finger moving down, then jumped by the
 * whole remaining travel on release (stress-drawer.spec.ts, cases 2 and 2b, on both engines).
 *
 * happy-dom runs no keyframe, so the mid-slide paint is what `getComputedStyle` reports for the
 * panel: 200px down while the inline transform says 0 — exactly the split the engine has to read
 * through.
 */
describe("a drag that starts mid-slide", () => {
  const PAINTED_Y = 200

  function paintPanelAt(panel: HTMLElement, translateY: number) {
    const real = window.getComputedStyle.bind(window)
    const spy = vi
      .spyOn(window, "getComputedStyle")
      .mockImplementation((element, pseudo) => {
        const style = real(element, pseudo)
        if (element !== panel) return style
        return new Proxy(style, {
          get: (target, key) =>
            key === "transform"
              ? `translate3d(0, ${translateY}px, 0)`
              : Reflect.get(target, key),
        })
      })
    return () => spy.mockRestore()
  }

  it("the whole-sheet touch drag starts from where the sheet is painted and closes from there", async () => {
    const { panel, body, onOpenChange } = await mountOpenDrawer()
    const unpaint = paintPanelAt(panel, PAINTED_Y)

    dispatchTouch(body, "touchstart", 100)
    //past the slop: the takeover reads the painted 200px, not the inline 0
    dispatchTouch(body, "touchmove", 110)
    unpaint()
    expect(translateY(panel)).toBe(PAINTED_Y)

    dispatchTouch(body, "touchmove", 250)
    expect(translateY(panel)).toBe(PAINTED_Y + 140)

    //the release rule reads the finger's own travel, and the close continues from the sheet
    dispatchTouch(body, "touchend", 480)
    expect(releaseSpy.mock.calls[0]?.[0]).toBe(370)
    await vi.waitFor(() =>
      expect(onOpenChange).toHaveBeenCalledWith(false),
    )
  })

  it("the handle's mouse drag starts from where the sheet is painted", async () => {
    const { panel, handle, backdrop, onOpenChange } =
      await mountForHandleDrag()
    const unpaint = paintPanelAt(panel, PAINTED_Y)

    mouse(handle, "pointerdown", 100)
    unpaint()
    expect(translateY(panel)).toBe(PAINTED_Y)

    mouse(handle, "pointermove", 150)
    expect(translateY(panel)).toBe(PAINTED_Y + 50)
    //back above where it was taken over, the sheet still follows — it is below open
    mouse(handle, "pointermove", 50)
    expect(translateY(panel)).toBe(PAINTED_Y - 50)

    //a short, slow drag from mid-slide is not a close: the sheet snaps open from where it is
    await settle(600)
    mouse(handle, "pointerup", 50)
    await settle()
    expect(translateY(panel)).toBe(0)
    expect(backdrop.dataset.state).toBe("open")
    expect(onOpenChange).not.toHaveBeenCalled()
  })
})

/*
 * The handle's mouse drag claims the shared arbiter, so it has to give it back.
 *
 * A trackpad on an iPad or a touchscreen laptop's mouse drags the sheet by its handle, and that
 * path claims the pointer at pointerdown with `blocksScroll`. If its pointerup or pointercancel
 * does not release, the drawer stays the arbiter's holder after the drag is over — even after it
 * closed the sheet — so the next edge swipe pre-empts a drag that no longer exists (and the
 * drawer's `onLost` snaps a sheet nobody is touching), and a row swipe, which ranks below a drawer
 * drag, is refused outright.
 */

function mouse(
  target: Element,
  type: "pointerdown" | "pointermove" | "pointerup" | "pointercancel",
  clientY: number,
  pointerType: "mouse" | "touch" = "mouse",
) {
  act(() => {
    target.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        pointerType,
        pointerId: 7,
        button: 0,
        clientX: 200,
        clientY,
      }),
    )
  })
}

/** Counts the drawer's own `onLost`: every capture requested at the drawer band is wrapped on its way in. */
function spyOnDrawerLost() {
  const request = gestureController.requestCapture
  const onLost = vi.fn()
  vi.spyOn(gestureController, "requestCapture").mockImplementation(
    (id, priority, lost, options) =>
      request(
        id,
        priority,
        priority === GesturePriority.DrawerDrag
          ? () => {
              onLost()
              lost?.()
            }
          : lost,
        options,
      ),
  )
  return onLost
}

async function mountForHandleDrag() {
  //happy-dom has no active pointer to capture
  vi.spyOn(HTMLElement.prototype, "setPointerCapture").mockImplementation(
    () => {},
  )
  const drawerLost = spyOnDrawerLost()
  const mounted = await mountOpenDrawer()
  const handle = mounted.panel.firstElementChild
    ?.firstElementChild as HTMLElement | null
  if (!handle) throw new Error("drawer handle did not mount")
  return { ...mounted, handle, drawerLost }
}

describe("the handle's mouse drag", () => {
  it("premise: holds the arbiter, blocking scroll, while the drag is live", async () => {
    const { panel, handle } = await mountForHandleDrag()
    expect(gestureController.getCaptured()).toBeNull()

    mouse(handle, "pointerdown", 100)
    mouse(handle, "pointermove", 110)
    expect(translateY(panel)).toBe(10)
    expect(gestureController.getCaptured()).not.toBeNull()
    expect(gestureController.isScrollBlocked()).toBe(true)
    mouse(handle, "pointerup", 110)
  })

  it("gives the arbiter back when a short drag snaps the sheet open", async () => {
    const { panel, backdrop, handle, onOpenChange, drawerLost } =
      await mountForHandleDrag()

    mouse(handle, "pointerdown", 100)
    mouse(handle, "pointermove", 110)
    //held still, so the release reads as a slow 10px drag, not a flick
    await settle(600)
    mouse(handle, "pointerup", 110)

    expect(gestureController.getCaptured()).toBeNull()
    expect(gestureController.isScrollBlocked()).toBe(false)
    await settle()
    expect(translateY(panel)).toBe(0)
    expect(backdrop.dataset.state).toBe("open")
    expect(onOpenChange).not.toHaveBeenCalled()
    expect(drawerLost).not.toHaveBeenCalled()
  })

  it("gives the arbiter back when the drag closes the sheet", async () => {
    const { handle, onOpenChange, drawerLost } = await mountForHandleDrag()

    mouse(handle, "pointerdown", 100)
    mouse(handle, "pointermove", 400)
    mouse(handle, "pointerup", 400)

    //free at once, not only once the close has run: the close animation is nobody's gesture
    expect(gestureController.getCaptured()).toBeNull()
    expect(gestureController.isScrollBlocked()).toBe(false)
    await vi.waitFor(() =>
      expect(onOpenChange).toHaveBeenCalledWith(false),
    )
    expect(gestureController.getCaptured()).toBeNull()
    expect(drawerLost).not.toHaveBeenCalled()
  })

  it("gives the arbiter back when the pointer is cancelled mid-drag", async () => {
    const { handle, drawerLost } = await mountForHandleDrag()

    mouse(handle, "pointerdown", 100)
    mouse(handle, "pointermove", 150)
    expect(gestureController.getCaptured()).not.toBeNull()
    mouse(handle, "pointercancel", 150)

    expect(gestureController.getCaptured()).toBeNull()
    expect(gestureController.isScrollBlocked()).toBe(false)
    expect(drawerLost).not.toHaveBeenCalled()
  })

  it("a touch cancel on the handle does not free a whole-sheet touch drag that still holds the arbiter", async () => {
    const { panel, body, handle } = await mountForHandleDrag()

    dispatchTouch(body, "touchstart", 100)
    dispatchTouch(body, "touchmove", 110)
    dispatchTouch(body, "touchmove", 200)
    const drawerCapture = gestureController.getCaptured()
    expect(drawerCapture).not.toBeNull()

    //the handle's cancel is wired for every pointer type; a touch one is not the mouse drag's end
    mouse(handle, "pointercancel", 200, "touch")
    expect(gestureController.getCaptured()).toBe(drawerCapture)
    expect(gestureController.isScrollBlocked()).toBe(true)

    dispatchTouch(body, "touchmove", 220)
    expect(translateY(panel)).toBe(110)
    dispatchTouch(body, "touchend", 220)
    expect(gestureController.getCaptured()).toBeNull()
  })

  it("after the drag, an edge swipe claims without pre-empting the drawer", async () => {
    const { panel, handle, drawerLost } = await mountForHandleDrag()
    const onBack = vi.fn()
    render(<EdgeSwipeGestures left={onBack} />)

    mouse(handle, "pointerdown", 100)
    mouse(handle, "pointermove", 110)
    const drawerCapture = gestureController.getCaptured()
    expect(drawerCapture).not.toBeNull()
    await settle(600)
    mouse(handle, "pointerup", 110)
    await settle()

    //a touch in the left edge strip — the real recogniser claims at touchstart
    const start = new Touch({
      identifier: 2,
      target: document.body,
      clientX: 4,
      clientY: 300,
    })
    act(() => {
      document.body.dispatchEvent(
        new TouchEvent("touchstart", {
          bubbles: true,
          touches: [start],
          changedTouches: [start],
        }),
      )
    })
    const edgeCapture = gestureController.getCaptured()
    expect(edgeCapture).not.toBeNull()
    expect(edgeCapture).not.toBe(drawerCapture)
    expect(gestureController.isScrollBlocked()).toBe(false)
    //nothing was pre-empted: no drawer drag was live to lose, and the settled sheet stays put
    expect(drawerLost).not.toHaveBeenCalled()
    expect(translateY(panel)).toBe(0)

    const end = new Touch({
      identifier: 2,
      target: document.body,
      clientX: 120,
      clientY: 300,
    })
    act(() => {
      document.body.dispatchEvent(
        new TouchEvent("touchend", {
          bubbles: true,
          touches: [],
          changedTouches: [end],
        }),
      )
    })
    expect(onBack).toHaveBeenCalledOnce()
    expect(gestureController.getCaptured()).toBeNull()
  })

  it("after the drag, a swipeable row's claim is granted", async () => {
    const { handle, drawerLost } = await mountForHandleDrag()
    const { container } = render(
      <Swipeable>
        <Swipeable.Content>row</Swipeable.Content>
        <Swipeable.RightActions>
          <button type="button">delete</button>
        </Swipeable.RightActions>
      </Swipeable>,
    )
    const row = container.querySelector<HTMLElement>(
      "[data-swipeable-content]",
    )
    if (!row) throw new Error("swipeable row did not mount")

    mouse(handle, "pointerdown", 100)
    mouse(handle, "pointermove", 110)
    const drawerCapture = gestureController.getCaptured()
    expect(drawerCapture).not.toBeNull()
    await settle(600)
    mouse(handle, "pointerup", 110)
    await settle()

    //a mouse row swipe, past the 8px dead zone and horizontal: the row claims at its lock
    const rowPointer = (type: string, clientX: number) =>
      act(() => {
        row.dispatchEvent(
          new PointerEvent(type, {
            bubbles: true,
            cancelable: true,
            pointerType: "mouse",
            pointerId: 9,
            button: 0,
            clientX,
            clientY: 50,
          }),
        )
      })
    rowPointer("pointerdown", 200)
    rowPointer("pointermove", 180)
    rowPointer("pointermove", 160)
    const rowCapture = gestureController.getCaptured()
    expect(rowCapture).not.toBeNull()
    expect(rowCapture).not.toBe(drawerCapture)
    expect(gestureController.isScrollBlocked()).toBe(true)
    expect(drawerLost).not.toHaveBeenCalled()

    rowPointer("pointerup", 160)
    expect(gestureController.getCaptured()).toBeNull()
  })
})
