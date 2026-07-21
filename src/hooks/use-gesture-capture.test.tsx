import { render } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { gestureController } from "#nativ/capabilities/gesture-controller"
import type { GestureCapture } from "#nativ/hooks/use-gesture-capture"
import {
  GesturePriority,
  useGestureCapture,
} from "#nativ/hooks/use-gesture-capture"

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
