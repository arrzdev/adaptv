import { render } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { gestureController } from "#adaptv/capabilities/gesture-controller"
import type { GestureCapture } from "#adaptv/hooks/use-gesture-capture"
import {
  GesturePriority,
  useGestureCapture,
} from "#adaptv/hooks/use-gesture-capture"

function Probe({
  priority,
  onLost,
  enabled,
  expose,
}: {
  priority: number
  onLost?: () => void
  enabled?: boolean
  expose: (c: GestureCapture) => void
}) {
  expose(useGestureCapture({ priority, onLost, enabled }))
  return null
}

function mount(props: Omit<Parameters<typeof Probe>[0], "expose">) {
  let capture!: GestureCapture
  const result = render(
    <Probe
      {...props}
      expose={(c) => {
        capture = c
      }}
    />,
  )
  return { capture: () => capture, ...result }
}

describe("useGestureCapture", () => {
  it("grants capture to a mounted gesture", () => {
    const { capture } = mount({ priority: GesturePriority.DrawerDrag })
    expect(capture().request()).toBe(true)
    expect(capture().isCaptured()).toBe(true)
    capture().release()
  })

  it("gives two instances separate identities", () => {
    //two Swipeable rows on one screen must COMPETE, not alias into one gesture —
    //otherwise the second row's request looks like the first re-requesting its
    //own capture and is silently granted
    const a = mount({ priority: GesturePriority.SwipeableRow })
    const b = mount({ priority: GesturePriority.SwipeableRow })

    expect(a.capture().request()).toBe(true)
    expect(b.capture().request()).toBe(false)
    a.capture().release()
  })

  it("lets a higher-priority gesture pre-empt, and tells the loser", () => {
    const onLost = vi.fn()
    const row = mount({ priority: GesturePriority.SwipeableRow, onLost })
    const edge = mount({ priority: GesturePriority.EdgeSwipe })

    row.capture().request()
    expect(edge.capture().request()).toBe(true)
    //without this the row stays mid-drag forever: its onEnd never fires and the
    //element is left translated
    expect(onLost).toHaveBeenCalledOnce()
    edge.capture().release()
  })

  it("releases the pointer when the component unmounts", () => {
    //a Swipeable removed from a list mid-drag must not hold the pointer forever,
    //which would silently deaden every gesture on the screen
    const { capture, unmount } = mount({
      priority: GesturePriority.DrawerDrag,
    })
    capture().request()
    unmount()
    expect(gestureController.getCaptured()).toBeNull()
  })

  it("still tells a gesture held at unmount that it lost the pointer", () => {
    const onLost = vi.fn()
    const { capture, unmount } = mount({
      priority: GesturePriority.DrawerDrag,
      onLost,
    })
    capture().request()
    unmount()
    expect(onLost).toHaveBeenCalledOnce()
  })

  it("leaves nothing behind in the controller when it unmounts", () => {
    //every Drawer, Swipeable and EdgeSwipeGestures unmount used to park its id
    //in the controller's disabled set for good: measured at 9 ids per `/` ↔
    //`/settings` round trip in the playground, 5400 after 600, with no cap.
    //`useId` never reuses an id, so the only honest reading of "holds nothing"
    //is behavioural — the disabled set's one reader is `requestCapture`, which
    //refuses an id that is still in it
    const ids: string[] = []
    for (let i = 0; i < 20; i++) {
      const { capture, rerender, unmount } = mount({
        priority: GesturePriority.SwipeableRow,
      })
      capture().request()
      ids.push(gestureController.getCaptured() ?? "")
      //half of them go away while disabled, which is the other way an id is
      //sitting in the disabled set at the moment it unmounts
      if (i % 2 === 1) {
        rerender(
          <Probe
            priority={GesturePriority.SwipeableRow}
            enabled={false}
            expose={() => {}}
          />,
        )
      }
      unmount()
    }

    expect(new Set(ids).size).toBe(20)
    const refused = ids.filter((id) => {
      const granted = gestureController.requestCapture(id, 0)
      gestureController.release(id)
      return !granted
    })
    expect(refused).toEqual([])
  })

  it("stops refusing once re-enabled, and refuses again when disabled", () => {
    const onLost = vi.fn()
    const view = mount({
      priority: GesturePriority.DrawerDrag,
      enabled: true,
      onLost,
    })
    view.capture().request()

    const rerender = (enabled: boolean) =>
      view.rerender(
        <Probe
          priority={GesturePriority.DrawerDrag}
          enabled={enabled}
          onLost={onLost}
          expose={() => {}}
        />,
      )

    rerender(false)
    expect(gestureController.getCaptured()).toBeNull()
    expect(onLost).toHaveBeenCalledOnce()
    expect(view.capture().request()).toBe(false)

    rerender(true)
    expect(view.capture().request()).toBe(true)
    view.capture().release()
    view.unmount()
  })

  it("refuses capture while disabled", () => {
    const { capture } = mount({
      priority: GesturePriority.DrawerDrag,
      enabled: false,
    })
    expect(capture().request()).toBe(false)
  })
})

describe("GesturePriority ordering", () => {
  it("ranks edge-swipe above drawer above row above scroll", () => {
    //edge-swipe is system-level navigation the user expects to win from
    //anywhere; a drawer is the foreground surface, so it outranks scrolling
    expect(GesturePriority.EdgeSwipe).toBeGreaterThan(
      GesturePriority.DrawerDrag,
    )
    expect(GesturePriority.DrawerDrag).toBeGreaterThan(
      GesturePriority.SwipeableRow,
    )
    expect(GesturePriority.SwipeableRow).toBeGreaterThan(
      GesturePriority.Scroll,
    )
  })
})
