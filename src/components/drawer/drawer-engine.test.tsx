import { act, render } from "@testing-library/react"
import { createRef } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { gestureController } from "#adaptv/capabilities/gesture-controller"
import type { DrawerHandle } from "#adaptv/components/drawer"
import { Drawer } from "#adaptv/components/drawer"
import { resolveDrawerDragRelease } from "#adaptv/components/drawer/drawer-constants"
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
      resolveDrawerDragRelease: vi.fn(real.resolveDrawerDragRelease),
    }
  },
)

//the caret repaint is a real DOM side effect irrelevant to the gesture under test
vi.mock("#adaptv/hooks/use-caret-repaint", () => ({
  beginCaretHold: () => () => {},
  preMuteCaret: () => {},
}))

const releaseSpy = vi.mocked(resolveDrawerDragRelease)

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
    expect(
      Number.isFinite(releaseSpy.mock.results[0].value.velocityY),
    ).toBe(true)

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
