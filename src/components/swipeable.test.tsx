import { act, fireEvent, render } from "@testing-library/react"
import type { ComponentProps, ReactNode } from "react"
import { createRef, useState } from "react"
import { renderToString } from "react-dom/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { gestureController } from "#adaptv/capabilities/gesture-controller"
import type {
  SwipeableGroupHandle,
  SwipeableHandle,
} from "#adaptv/components/swipeable"
import {
  isSwipeableGestureTarget,
  Swipeable,
  useSwipeable,
} from "#adaptv/components/swipeable"

/*
 * The row engine, driven the way a consumer's user drives it.
 *
 * The release ladder itself is pinned as numbers in swipeable-physics.test.ts;
 * this file pins what sits around it — the dead zone and the direction lock, the
 * 1:1 tracking and the rubber band, which gesture paths reach the ladder at all,
 * and every way an open row is dismissed. What happy-dom cannot express (the
 * browser's own touch-slop arbitration against a native scroll, an <img> drag
 * stealing the pointer) is playground/e2e/swipeable.spec.ts's job, under CDP
 * touch.
 *
 * Two seams make it deterministic. happy-dom lays nothing out, so every action
 * panel reports a stubbed natural width (80px, a typical tray button) through
 * `offsetWidth`, which is the only thing the engine measures. And the clock is
 * faked — `performance.now()` and requestAnimationFrame share one timeline — so
 * a drag's release velocity is exactly the px/s the test moved at, and a spring
 * runs frame by frame under the test's control.
 */

const W = 80
const widths: Record<string, number> = { left: W, right: W }
const offsetWidth = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  "offsetWidth",
)

//a frame at 60Hz
const FRAME = 16

beforeEach(() => {
  widths.left = W
  widths.right = W
  Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
    configurable: true,
    get(this: HTMLElement) {
      const side = this.getAttribute("data-swipeable-actions")
      return side ? (widths[side] ?? 0) : 0
    },
  })
  vi.useFakeTimers({
    toFake: [
      "requestAnimationFrame",
      "cancelAnimationFrame",
      "performance",
    ],
  })
})

afterEach(() => {
  vi.useRealTimers()
  if (offsetWidth) {
    Object.defineProperty(
      HTMLElement.prototype,
      "offsetWidth",
      offsetWidth,
    )
  }
  vi.unstubAllGlobals()
})

/* ---- harness ------------------------------------------------------------- */

function advance(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms)
  })
}

/** Run springs to rest. A row spring settles well inside 700ms. */
function settle() {
  advance(1500)
}

type RowProps = Omit<ComponentProps<typeof Swipeable>, "children"> & {
  left?: boolean
  right?: boolean
  onArchive?: () => void
  onDelete?: () => void
  label?: string
  children?: ReactNode
}

function Row({
  left = true,
  right = true,
  onArchive,
  onDelete,
  label = "row",
  children,
  ...props
}: RowProps) {
  return (
    <Swipeable {...props}>
      {left && (
        <Swipeable.LeftActions>
          <button type="button" onClick={onArchive}>
            archive {label}
          </button>
        </Swipeable.LeftActions>
      )}
      <Swipeable.Content>
        <span>{label}</span>
        {children}
      </Swipeable.Content>
      {right && (
        <Swipeable.RightActions>
          <button type="button" onClick={onDelete}>
            delete {label}
          </button>
        </Swipeable.RightActions>
      )}
    </Swipeable>
  )
}

function parts(container: ParentNode, index = 0) {
  const root = container.querySelectorAll<HTMLElement>(
    "[data-swipeable-root]",
  )[index]
  if (!root) throw new Error(`no swipeable root at ${index}`)
  const q = (sel: string) => root.querySelector<HTMLElement>(sel)
  return {
    root,
    content: q("[data-swipeable-content]") as HTMLElement,
    leftPanel: q('[data-swipeable-actions="left"]'),
    rightPanel: q('[data-swipeable-actions="right"]'),
    leftFill: q('[data-swipeable-fill="left"]'),
    rightFill: q('[data-swipeable-fill="right"]'),
  }
}

function tx(el: HTMLElement | null): number {
  const m = /translateX\((-?[\d.]+)px\)/.exec(el?.style.transform ?? "")
  return m ? Number(m[1]) : 0
}

const ORIGIN = { x: 200, y: 100 }

/** A mouse drag: down at the origin, `steps` moves `stepMs` apart along
 *  (dx, dy), `holdMs` still, then up. Returns the content offset after every
 *  move — the trace a finger would see. */
function mouseDrag(
  content: HTMLElement,
  dx: number,
  {
    dy = 0,
    steps = Math.max(1, Math.abs(Math.round(dx))),
    stepMs = FRAME,
    holdMs = 0,
    release = true,
    pointerId = 1,
  }: {
    dy?: number
    steps?: number
    stepMs?: number
    holdMs?: number
    release?: boolean
    pointerId?: number
  } = {},
) {
  const trace: number[] = []
  const at = (i: number) => ({
    clientX: ORIGIN.x + (dx * i) / steps,
    clientY: ORIGIN.y + (dy * i) / steps,
  })
  act(() => {
    fireEvent.pointerDown(content, {
      pointerId,
      pointerType: "mouse",
      button: 0,
      ...at(0),
    })
  })
  for (let i = 1; i <= steps; i += 1) {
    advance(stepMs)
    act(() => {
      fireEvent.pointerMove(content, {
        pointerId,
        pointerType: "mouse",
        ...at(i),
      })
    })
    trace.push(tx(content))
  }
  if (holdMs) advance(holdMs)
  if (release) {
    act(() => {
      fireEvent.pointerUp(content, {
        pointerId,
        pointerType: "mouse",
        ...at(steps),
      })
    })
  }
  return trace
}

/** A slow drag: 2px a frame = 125px/s, well under the 250px/s flick, so the
 *  release is decided by position alone. */
function slowDrag(content: HTMLElement, dx: number) {
  return mouseDrag(content, dx, { steps: Math.abs(dx) / 2 })
}

/** A flick: two 10ms moves of dx/2 — a release velocity of dx/0.01 px/s. */
function flick(content: HTMLElement, dx: number) {
  return mouseDrag(content, dx, { steps: 2, stepMs: 10 })
}

/** A mouse drag along explicit `[ms since pointerdown, dx]` points, released
 *  at the last one — for a drag whose speed changes part way through. */
function mousePath(content: HTMLElement, points: [number, number][]) {
  act(() => {
    fireEvent.pointerDown(content, {
      pointerId: 1,
      pointerType: "mouse",
      button: 0,
      clientX: ORIGIN.x,
      clientY: ORIGIN.y,
    })
  })
  let t = 0
  for (const [ms, dx] of points) {
    advance(ms - t)
    t = ms
    act(() => {
      fireEvent.pointerMove(content, {
        pointerId: 1,
        pointerType: "mouse",
        clientX: ORIGIN.x + dx,
        clientY: ORIGIN.y,
      })
    })
  }
  act(() => {
    fireEvent.pointerUp(content, { pointerId: 1, pointerType: "mouse" })
  })
}

//the component reads touches[0] off the event and nothing else, so a plain
//cancelable Event carrying that list is a faithful stand-in
function touchEvent(type: string, point?: { x: number; y: number }) {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperty(event, "touches", {
    value: point ? [{ clientX: point.x, clientY: point.y }] : [],
  })
  return event
}

/** A touch drag the way a browser delivers one: pointerdown (which is where the
 *  pointer id is recorded), then touchstart / touchmove… / touchend. Returns
 *  whether each move was preventDefault'ed — i.e. whether the row blocked the
 *  native scroll for that move — and the offset after it. */
function touchDrag(
  content: HTMLElement,
  moves: { x: number; y: number }[],
  { release = true, stepMs = FRAME } = {},
) {
  const prevented: boolean[] = []
  const trace: number[] = []
  act(() => {
    fireEvent.pointerDown(content, {
      pointerId: 7,
      pointerType: "touch",
      button: 0,
      clientX: ORIGIN.x,
      clientY: ORIGIN.y,
    })
    content.dispatchEvent(touchEvent("touchstart", ORIGIN))
  })
  for (const m of moves) {
    advance(stepMs)
    const event = touchEvent("touchmove", {
      x: ORIGIN.x + m.x,
      y: ORIGIN.y + m.y,
    })
    act(() => {
      content.dispatchEvent(event)
    })
    prevented.push(event.defaultPrevented)
    trace.push(tx(content))
  }
  if (release) {
    act(() => {
      content.dispatchEvent(touchEvent("touchend"))
    })
  }
  return { prevented, trace }
}

const line = (n: number, dx: number, dy = 0) =>
  Array.from({ length: n }, (_, i) => ({
    x: (dx * (i + 1)) / n,
    y: (dy * (i + 1)) / n,
  }))

/* ---- tracking ------------------------------------------------------------ */

describe("Swipeable · the row follows the finger", () => {
  it("holds still through an 8px dead zone, then tracks 1:1 from the touch origin", () => {
    //one pixel a frame, the way a real finger starts — a chunked drag would
    //step straight over the dead zone and hide a jump at the lock
    const { container } = render(<Row />)
    const { content } = parts(container)
    const trace = mouseDrag(content, -20, { steps: 20, release: false })
    expect(trace).toEqual([
      0, 0, 0, 0, 0, 0, 0, -8, -9, -10, -11, -12, -13, -14, -15, -16, -17,
      -18, -19, -20,
    ])
  })

  it("slides the revealed tray in with the content and leaves the other parked", () => {
    const { container } = render(<Row />)
    const { content, rightPanel, leftPanel } = parts(container)
    mouseDrag(content, -40, { release: false })
    expect(tx(content)).toBe(-40)
    //the right tray starts one natural width off its edge and rides in
    expect(tx(rightPanel)).toBe(W - 40)
    //the left tray stays a full width beyond the content, off-screen
    expect(tx(leftPanel)).toBe(-W - 40)
  })

  it("rubber-bands past the tray's natural width, capped at half of it", () => {
    const { container } = render(<Row />)
    const { content, rightPanel, rightFill } = parts(container)
    const trace = mouseDrag(content, -200, { steps: 40, release: false })
    //-100px of finger: 80 + (20 × 0.4 friction) = 88
    expect(trace[19]).toBeCloseTo(-88, 5)
    //-200px of finger: the resistance is capped at W/2
    expect(trace[39]).toBe(-W - W / 2)
    //past the natural width the tray parks, pinned to the edge, and the fill
    //rides in the gap between it and the content
    expect(tx(rightPanel)).toBe(0)
    expect(tx(rightFill)).toBe(-120)
  })

  it("honours overshootFriction", () => {
    const { container } = render(<Row overshootFriction={0.1} />)
    const { content } = parts(container)
    const trace = mouseDrag(content, -100, { steps: 50, release: false })
    expect(trace.at(-1)).toBeCloseTo(-82, 5)
  })

  it("will not move toward a side that has no actions, nor open it", () => {
    const onOpen = vi.fn()
    const { container } = render(<Row left={false} onOpen={onOpen} />)
    const { content } = parts(container)
    const trace = mouseDrag(content, 60, { steps: 30 })
    expect(trace.every((x) => x === 0)).toBe(true)
    flick(content, 40)
    settle()
    expect(onOpen).not.toHaveBeenCalled()
    expect(tx(content)).toBe(0)
  })
})

/* ---- release ------------------------------------------------------------- */

describe("Swipeable · what a release commits to", () => {
  function Probe() {
    const { openSide, isOpen, isEnabled } = useSwipeable()
    return (
      <output data-testid="probe">
        {`${String(openSide)}|${String(isOpen)}|${String(isEnabled)}`}
      </output>
    )
  }

  it("opens past 30% of the tray and settles fully open, reporting the side", () => {
    const onOpen = vi.fn()
    const ref = createRef<SwipeableHandle>()
    const { container, getByTestId } = render(
      <Row ref={ref} onOpen={onOpen}>
        <Probe />
      </Row>,
    )
    const { content, rightPanel } = parts(container)
    expect(getByTestId("probe").textContent).toBe("false|false|true")

    slowDrag(content, -30)
    expect(onOpen).toHaveBeenCalledExactlyOnceWith("right")
    expect(ref.current?.open).toBe("right")
    expect(getByTestId("probe").textContent).toBe("right|true|true")

    settle()
    expect(tx(content)).toBe(-W)
    expect(tx(rightPanel)).toBe(0)
    expect(content.style.willChange).toBe("")
  })

  it("opens the left tray for a rightward drag", () => {
    const onOpen = vi.fn()
    const { container } = render(<Row onOpen={onOpen} />)
    const { content } = parts(container)
    slowDrag(content, 30)
    settle()
    expect(onOpen).toHaveBeenCalledExactlyOnceWith("left")
    expect(tx(content)).toBe(W)
  })

  it("snaps back from under the threshold with no half-open resting state", () => {
    const onOpen = vi.fn()
    const ref = createRef<SwipeableHandle>()
    const { container } = render(<Row ref={ref} onOpen={onOpen} />)
    const { content } = parts(container)
    slowDrag(content, -20)
    settle()
    expect(onOpen).not.toHaveBeenCalled()
    expect(ref.current?.open).toBe(false)
    //cleared, not a stray translateX(0px) left on the node
    expect(content.style.transform).toBe("")
  })

  it("lets openThreshold move the line", () => {
    const onOpen = vi.fn()
    const { container } = render(
      <Row openThreshold={0.6} onOpen={onOpen} />,
    )
    const { content } = parts(container)
    slowDrag(content, -40) //past 30%, under 60%
    settle()
    expect(onOpen).not.toHaveBeenCalled()
    slowDrag(content, -50)
    settle()
    expect(onOpen).toHaveBeenCalledExactlyOnceWith("right")
  })

  //a finger that flicks and then stops has no velocity when it lifts. Held
  //still, it delivers no further moves, so the samples still end on the flick;
  //the release has to be measured against the moment of release, or a pause
  //before lifting is invisible and the stale flick decides
  it("a flick that stops before the finger lifts is not a flick: position decides", () => {
    const onOpen = vi.fn()
    const { container } = render(<Row onOpen={onOpen} />)
    const { content } = parts(container)
    //16px at 1000px/s, then 200ms held still — under the 24px open line
    mouseDrag(content, -16, { steps: 2, stepMs: 8, holdMs: 200 })
    settle()
    expect(onOpen).not.toHaveBeenCalled()
    expect(tx(content)).toBe(0)
  })

  it("an open row flicked back and then held keeps its position's verdict", () => {
    const onClose = vi.fn()
    const ref = createRef<SwipeableHandle>()
    const { container } = render(<Row ref={ref} onClose={onClose} />)
    const { content } = parts(container)
    slowDrag(content, -40)
    settle()
    //-80 → -68 at 1500px/s, held: still past the -60 close line, so it stays
    mouseDrag(content, 12, { steps: 2, stepMs: 4, holdMs: 200 })
    settle()
    expect(onClose).not.toHaveBeenCalled()
    expect(ref.current?.open).toBe("right")
    expect(tx(content)).toBe(-W)
  })

  //the pause that expires a flick is the velocity window itself: a lift just
  //inside it is still the flick, a lift just past it is not
  it.each([
    { holdMs: 55, opens: true },
    { holdMs: 65, opens: false },
  ])(
    "a flick held $holdMs ms before the lift opens: $opens",
    ({ holdMs, opens }) => {
      const onOpen = vi.fn()
      const { container } = render(<Row onOpen={onOpen} />)
      const { content } = parts(container)
      mouseDrag(content, -16, { steps: 2, stepMs: 8, holdMs })
      settle()
      expect(onOpen).toHaveBeenCalledTimes(opens ? 1 : 0)
      expect(tx(content)).toBe(opens ? -W : 0)
    },
  )

  it("a flick opens from well under the position threshold", () => {
    const onOpen = vi.fn()
    const { container } = render(<Row onOpen={onOpen} />)
    const { content } = parts(container)
    flick(content, -12) //-1200px/s, 12px of travel
    settle()
    expect(onOpen).toHaveBeenCalledExactlyOnceWith("right")
    expect(tx(content)).toBe(-W)
  })

  it("lets velocityThreshold decide what counts as a flick", () => {
    const onOpen = vi.fn()
    const { container } = render(
      <Row velocityThreshold={5000} onOpen={onOpen} />,
    )
    const { content } = parts(container)
    flick(content, -12)
    settle()
    expect(onOpen).not.toHaveBeenCalled()
    expect(tx(content)).toBe(0)
  })

  it("a drag that was fast and then slowed is judged on its last 60ms, not the whole drag", () => {
    const onOpen = vi.fn()
    const { container } = render(<Row onOpen={onOpen} />)
    const { content } = parts(container)
    //20px in 8ms, then 1px every ~33ms: over the whole drag that is -293px/s,
    //a flick; over the trailing 60ms it is -29px/s. 22px is under the open line
    mousePath(content, [
      [4, -10],
      [8, -20],
      [40, -21],
      [75, -22],
    ])
    settle()
    expect(onOpen).not.toHaveBeenCalled()
    expect(tx(content)).toBe(0)
  })

  it("an open row closes once dragged back past 25% of the tray", () => {
    const onClose = vi.fn()
    const ref = createRef<SwipeableHandle>()
    const { container } = render(<Row ref={ref} onClose={onClose} />)
    const { content } = parts(container)
    slowDrag(content, -40)
    settle()
    expect(ref.current?.open).toBe("right")

    slowDrag(content, 24) //-80 → -56, past the -60 line
    expect(ref.current?.open).toBe(false)
    settle()
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(tx(content)).toBe(0)
  })

  it("an open row nudged back less than 25% stays open", () => {
    const onClose = vi.fn()
    const ref = createRef<SwipeableHandle>()
    const { container } = render(<Row ref={ref} onClose={onClose} />)
    const { content } = parts(container)
    slowDrag(content, -40)
    settle()
    slowDrag(content, 12) //-80 → -68
    settle()
    expect(onClose).not.toHaveBeenCalled()
    expect(ref.current?.open).toBe("right")
    expect(tx(content)).toBe(-W)
  })

  it("a flick through an open row swaps it to the other tray", () => {
    const onOpen = vi.fn()
    const { container } = render(<Row onOpen={onOpen} />)
    const { content } = parts(container)
    slowDrag(content, -40)
    settle()
    //from -80, a hard rightward drag that ends past centre
    mouseDrag(content, 100, { steps: 4, stepMs: 10 })
    settle()
    expect(onOpen).toHaveBeenLastCalledWith("left")
    expect(tx(content)).toBe(W)
  })

  it("a tap on an open row's content closes it", () => {
    const ref = createRef<SwipeableHandle>()
    const { container } = render(<Row ref={ref} />)
    const { content } = parts(container)
    slowDrag(content, -40)
    settle()
    mouseDrag(content, 0, { steps: 1 })
    expect(ref.current?.open).toBe(false)
    settle()
    expect(tx(content)).toBe(0)
  })

  it("a closing flick is a hard stop at closed — it never swings into the other tray", () => {
    const { container } = render(<Row />)
    const { content, leftPanel } = parts(container)
    slowDrag(content, -40)
    settle()

    //flick shut from -80 hard enough to carry far past 0 on a free spring, and
    //sample every frame of the close
    mouseDrag(content, 60, { steps: 2, stepMs: 8 })
    const frames: number[] = []
    for (let i = 0; i < 60; i += 1) {
      advance(FRAME)
      frames.push(tx(content))
    }
    expect(Math.max(...frames)).toBeLessThanOrEqual(0)
    expect(frames.at(-1)).toBe(0)
    expect(tx(leftPanel)).toBe(-W)
  })

  it("a flick shut that is walled at closed stops there too, instead of swinging into the missing tray", () => {
    //no left tray: a hard rightward flick from right-open is clamped to 0 while
    //the finger is still moving, so the close starts AT 0 with all the flick's
    //momentum — the one case where the offset alone cannot say which side the
    //row is closing from
    const { container } = render(<Row left={false} />)
    const { content } = parts(container)
    slowDrag(content, -40)
    settle()
    mouseDrag(content, 120, { steps: 2, stepMs: 8 })
    const frames: number[] = []
    for (let i = 0; i < 60; i += 1) {
      advance(FRAME)
      frames.push(tx(content))
    }
    expect(frames.filter((x) => x > 0)).toEqual([])
    expect(frames.at(-1)).toBe(0)
  })

  it("springs, rather than jumps, to open", () => {
    const { container } = render(<Row />)
    const { content } = parts(container)
    slowDrag(content, -30)
    const frames: number[] = []
    for (let i = 0; i < 40; i += 1) {
      advance(FRAME)
      frames.push(tx(content))
    }
    //in flight on the first frames, strictly heading for the tray…
    expect(frames[0]).toBeLessThan(-30)
    expect(frames[0]).toBeGreaterThan(-W)
    expect(content.style.willChange).toBe("")
    //…and exactly at rest by the end
    expect(frames.at(-1)).toBe(-W)
  })

  it("with reduced motion, lands in one step and never schedules a frame", () => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query.includes("prefers-reduced-motion"),
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }))
    const { container } = render(<Row />)
    const { content } = parts(container)
    slowDrag(content, -30)
    expect(tx(content)).toBe(-W)
    expect(vi.getTimerCount()).toBe(0)
  })
})

/* ---- direction lock ------------------------------------------------------ */

describe("Swipeable · the direction lock (touch)", () => {
  afterEach(() => {
    //a test that leaves capture held would leak into the next through the
    //singleton arbiter
    gestureController.release(gestureController.getCaptured() ?? "")
  })

  it("never blocks the native scroll before the gesture has declared itself", () => {
    const { container } = render(<Row />)
    const { content } = parts(container)
    const { prevented } = touchDrag(content, line(7, -7), {
      release: false,
    })
    expect(prevented.every((p) => !p)).toBe(true)
  })

  it("a horizontal drag locks: every move from the lock blocks the scroll and owns the pointer", () => {
    const { container } = render(<Row />)
    const { content } = parts(container)
    const { prevented, trace } = touchDrag(content, line(20, -40, -6), {
      release: false,
    })
    //the first three moves are inside the 8px slop
    expect(prevented).toEqual([
      false,
      false,
      false,
      ...Array.from({ length: 17 }, () => true),
    ])
    expect(trace.at(-1)).toBe(-40)
    expect(gestureController.getCaptured()).not.toBeNull()
    expect(gestureController.isScrollBlocked()).toBe(true)
    expect(content.hasPointerCapture(7)).toBe(true)

    act(() => {
      content.dispatchEvent(touchEvent("touchend"))
    })
    expect(gestureController.getCaptured()).toBeNull()
  })

  it("a drag steeper than 30° is a scroll: the row never moves and never blocks it, even if the finger turns sideways later", () => {
    const onOpen = vi.fn()
    const { container } = render(<Row onOpen={onOpen} />)
    const { content } = parts(container)
    //35° off horizontal to lock, then a long sideways run
    const steep = line(
      10,
      -Math.cos((35 * Math.PI) / 180) * 20,
      -Math.sin((35 * Math.PI) / 180) * 20,
    )
    const sideways = line(20, -120).map((m) => ({
      x: m.x + steep[9].x,
      y: steep[9].y,
    }))
    const { prevented, trace } = touchDrag(content, [
      ...steep,
      ...sideways,
    ])
    expect(prevented.some(Boolean)).toBe(false)
    expect(trace.every((x) => x === 0)).toBe(true)
    expect(gestureController.getCaptured()).toBeNull()
    settle()
    expect(onOpen).not.toHaveBeenCalled()
  })

  it("a drag at 25° is still a swipe", () => {
    const { container } = render(<Row />)
    const { content } = parts(container)
    const a = (25 * Math.PI) / 180
    const { prevented, trace } = touchDrag(
      content,
      line(10, -Math.cos(a) * 40, -Math.sin(a) * 40),
      { release: false },
    )
    expect(prevented.at(-1)).toBe(true)
    expect(trace.at(-1)).toBeCloseTo(-Math.cos(a) * 40, 5)
  })

  it("directionLockAngle widens or narrows the cone", () => {
    const { container } = render(<Row directionLockAngle={10} />)
    const { content } = parts(container)
    const a = (25 * Math.PI) / 180
    const { prevented, trace } = touchDrag(
      content,
      line(10, -Math.cos(a) * 40, -Math.sin(a) * 40),
    )
    expect(prevented.some(Boolean)).toBe(false)
    expect(trace.every((x) => x === 0)).toBe(true)
  })

  it("a mouse drag obeys the same lock", () => {
    const { container } = render(<Row />)
    const { content } = parts(container)
    const trace = mouseDrag(content, -10, { dy: 40, steps: 20 })
    expect(trace.every((x) => x === 0)).toBe(true)
  })

  it("opens on touchend past the threshold", () => {
    const onOpen = vi.fn()
    const { container } = render(<Row onOpen={onOpen} />)
    const { content } = parts(container)
    touchDrag(content, line(20, -40))
    settle()
    expect(onOpen).toHaveBeenCalledExactlyOnceWith("right")
    expect(tx(content)).toBe(-W)
  })

  it("a touchcancel ends the drag like a release", () => {
    const { container } = render(<Row />)
    const { content } = parts(container)
    touchDrag(content, line(10, -20), { release: false })
    act(() => {
      content.dispatchEvent(touchEvent("touchcancel"))
    })
    settle()
    expect(tx(content)).toBe(0)
    expect(gestureController.getCaptured()).toBeNull()
  })

  it("a window blur mid-drag ends it instead of stranding the row", () => {
    const { container } = render(<Row />)
    const { content } = parts(container)
    mouseDrag(content, -20, { steps: 10, release: false })
    expect(tx(content)).toBe(-20)
    act(() => {
      window.dispatchEvent(new Event("blur"))
    })
    settle()
    expect(tx(content)).toBe(0)
  })
})

/* ---- arbitration --------------------------------------------------------- */

describe("Swipeable · the shared gesture arbiter", () => {
  afterEach(() => {
    gestureController.unregister("test:higher")
  })

  it("claims only at the lock — a press that has not moved holds nothing", () => {
    const { container } = render(<Row />)
    const { content } = parts(container)
    mouseDrag(content, -4, { steps: 4, release: false })
    expect(gestureController.getCaptured()).toBeNull()
    mouseDrag(content, -20, { steps: 10, release: false })
    expect(gestureController.getCaptured()).not.toBeNull()
    act(() => {
      fireEvent.pointerUp(content, { pointerId: 1, pointerType: "mouse" })
    })
    expect(gestureController.getCaptured()).toBeNull()
  })

  it("pre-empted mid-drag by a higher-priority gesture, the row springs back and ignores the rest of the drag", () => {
    const onOpen = vi.fn()
    const { container } = render(<Row onOpen={onOpen} />)
    const { content } = parts(container)
    const { trace } = touchDrag(content, line(10, -20), { release: false })
    expect(trace.at(-1)).toBe(-20)

    act(() => {
      gestureController.requestCapture("test:higher", 400)
    })
    settle()
    expect(tx(content)).toBe(0)

    //the finger keeps going, far past the open threshold, and lifts
    for (const m of line(10, -80)) {
      advance(FRAME)
      act(() => {
        content.dispatchEvent(
          touchEvent("touchmove", { x: ORIGIN.x - 20 + m.x, y: ORIGIN.y }),
        )
      })
      expect(tx(content)).toBe(0)
    }
    act(() => {
      content.dispatchEvent(touchEvent("touchend"))
    })
    settle()
    expect(onOpen).not.toHaveBeenCalled()
  })

  //an edge swipe claims at touchstart inside its strip precisely so a row swipe
  //under the same finger is suppressed (the claim-point table in
  //docs/design/coordination.md). A row refused at its lock must give the finger
  //up, the way the edge swipe and the drawer handle do when THEY are refused —
  //not track it anyway and open on release on top of the gesture that won
  it("refused at the lock by a gesture that already holds the finger, a touch swipe never moves the row or blocks the scroll", () => {
    const onOpen = vi.fn()
    const { container } = render(<Row onOpen={onOpen} />)
    const { content } = parts(container)
    act(() => {
      gestureController.requestCapture("test:higher", 400)
    })

    const { prevented, trace } = touchDrag(content, line(20, -60))
    expect(trace.filter((x) => x !== 0)).toEqual([])
    expect(prevented.filter(Boolean)).toEqual([])
    settle()
    expect(onOpen).not.toHaveBeenCalled()
    expect(tx(content)).toBe(0)
    expect(gestureController.getCaptured()).toBe("test:higher")
  })

  it("refused at the lock, a mouse drag never moves the row either", () => {
    const onOpen = vi.fn()
    const { container } = render(<Row onOpen={onOpen} />)
    const { content } = parts(container)
    act(() => {
      gestureController.requestCapture("test:higher", 400)
    })

    const trace = slowDrag(content, -60)
    expect(trace.filter((x) => x !== 0)).toEqual([])
    settle()
    expect(onOpen).not.toHaveBeenCalled()
    expect(content.hasPointerCapture(1)).toBe(false)
  })

  it("enabled={false} makes the row inert to touch and mouse, and says so in context", () => {
    const onOpen = vi.fn()
    function Probe() {
      return (
        <i data-testid="enabled">{String(useSwipeable().isEnabled)}</i>
      )
    }
    const { container, getByTestId } = render(
      <Row enabled={false} onOpen={onOpen}>
        <Probe />
      </Row>,
    )
    const { content } = parts(container)
    expect(getByTestId("enabled").textContent).toBe("false")
    const { prevented, trace } = touchDrag(content, line(20, -60))
    expect(prevented.some(Boolean)).toBe(false)
    expect(trace.every((x) => x === 0)).toBe(true)
    expect(slowDrag(content, -60).every((x) => x === 0)).toBe(true)
    settle()
    expect(onOpen).not.toHaveBeenCalled()
    expect(gestureController.getCaptured()).toBeNull()
  })
})

/* ---- dismissal ----------------------------------------------------------- */

describe("Swipeable · how an open row is dismissed", () => {
  function openRight(content: HTMLElement) {
    slowDrag(content, -40)
    settle()
    expect(tx(content)).toBe(-W)
  }

  it("a pointer released anywhere outside the row closes it; inside does not", () => {
    const onClose = vi.fn()
    const { container } = render(
      <>
        <Row onClose={onClose} />
        <p data-testid="outside">elsewhere</p>
      </>,
    )
    const { content, rightPanel } = parts(container)
    openRight(content)

    act(() => {
      fireEvent.pointerUp(rightPanel as HTMLElement, { pointerId: 3 })
    })
    settle()
    expect(tx(content)).toBe(-W)

    act(() => {
      fireEvent.pointerUp(
        container.querySelector("[data-testid=outside]") as HTMLElement,
        { pointerId: 3 },
      )
    })
    settle()
    expect(tx(content)).toBe(0)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it("activating a tray action runs the action once and closes the row", () => {
    const ref = createRef<SwipeableHandle>()
    const onDelete = vi.fn()
    const { container, getByText } = render(
      <Row ref={ref} onDelete={onDelete} />,
    )
    const { content } = parts(container)
    openRight(content)

    //a click is what both a tap and a keyboard Enter/Space on the button produce
    act(() => {
      fireEvent.click(getByText("delete row"))
    })
    expect(onDelete).toHaveBeenCalledTimes(1)
    expect(ref.current?.open).toBe(false)
    settle()
    expect(tx(content)).toBe(0)
  })

  it("a click on the row's own content is not a tray activation", () => {
    const ref = createRef<SwipeableHandle>()
    const { container, getByText } = render(<Row ref={ref} />)
    const { content } = parts(container)
    openRight(content)
    act(() => {
      fireEvent.click(getByText("row"))
    })
    expect(ref.current?.open).toBe("right")
  })

  it("focusing a text field anywhere closes open rows, because the keyboard is coming", () => {
    const { container } = render(
      <>
        <Row />
        <input data-testid="text" />
        <input data-testid="box" type="checkbox" />
        <button data-testid="button" type="button">
          b
        </button>
      </>,
    )
    const { content } = parts(container)
    openRight(content)

    const focus = (id: string) =>
      act(() => {
        ;(
          container.querySelector(`[data-testid=${id}]`) as HTMLElement
        ).focus()
      })

    focus("box")
    focus("button")
    settle()
    expect(tx(content)).toBe(-W)

    focus("text")
    settle()
    expect(tx(content)).toBe(0)
  })

  it("scrolling the list the row lives in closes it", () => {
    const { container } = render(
      <div data-testid="list" style={{ overflowY: "auto", height: 200 }}>
        <Row />
      </div>,
    )
    const { content } = parts(container)
    openRight(content)
    act(() => {
      container
        .querySelector("[data-testid=list]")
        ?.dispatchEvent(new Event("scroll"))
    })
    settle()
    expect(tx(content)).toBe(0)
  })

  it("in a Group, opening one row closes the one already open", () => {
    const onClose = vi.fn()
    const { container } = render(
      <Swipeable.Group>
        <Row label="a" onClose={onClose} />
        <Row label="b" />
      </Swipeable.Group>,
    )
    const a = parts(container, 0).content
    const b = parts(container, 1).content
    openRight(a)
    //by touch, and without a pointerup: a pointer lifting outside row a would
    //close it through the outside-release dismisser alone, and this must pin
    //the Group — the only thing that closes a sibling opened programmatically
    touchDrag(b, line(20, -40))
    expect(tx(a)).toBeLessThan(0) //the close is a spring, not a jump
    settle()
    expect(tx(b)).toBe(-W)
    expect(tx(a)).toBe(0)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it("in a Group, a row opened through its open prop closes its sibling", () => {
    function List({ b }: { b: false | "right" }) {
      return (
        <Swipeable.Group>
          <Row label="a" />
          <Row label="b" open={b} />
        </Swipeable.Group>
      )
    }
    const { container, rerender } = render(<List b={false} />)
    const a = parts(container, 0).content
    openRight(a)
    rerender(<List b="right" />)
    settle()
    expect(tx(parts(container, 1).content)).toBe(-W)
    expect(tx(a)).toBe(0)
  })

  it("a Group with closeOnOpen={false} lets rows stay open together", () => {
    const { container } = render(
      <Swipeable.Group closeOnOpen={false}>
        <Row label="a" />
        <Row label="b" />
      </Swipeable.Group>,
    )
    const a = parts(container, 0).content
    const b = parts(container, 1).content
    openRight(a)
    //open b without a pointerup landing outside a (which would close a on its own)
    touchDrag(b, line(20, -40))
    settle()
    expect(tx(a)).toBe(-W)
    expect(tx(b)).toBe(-W)
  })

  it("Group's closeAll closes every member", () => {
    const group = createRef<SwipeableGroupHandle>()
    const onCloseB = vi.fn()
    function List() {
      const [showB, setShowB] = useState(true)
      return (
        <Swipeable.Group ref={group} closeOnOpen={false}>
          <button type="button" onClick={() => setShowB(false)}>
            drop b
          </button>
          <Row label="a" />
          {showB && <Row label="b" onClose={onCloseB} />}
        </Swipeable.Group>
      )
    }
    const { container, getByText } = render(<List />)
    const a = parts(container, 0).content
    touchDrag(a, line(20, -40))
    settle()
    act(() => {
      fireEvent.click(getByText("drop b"))
    })
    //the click's pointer never went up outside, so a is still open
    expect(tx(a)).toBe(-W)
    act(() => {
      group.current?.closeAll()
    })
    settle()
    expect(tx(a)).toBe(0)
    expect(onCloseB).not.toHaveBeenCalled()
  })
})

/* ---- controlled + imperative --------------------------------------------- */

describe("Swipeable · controlled and imperative", () => {
  it("open drives the row, and clearing it closes", () => {
    const onOpen = vi.fn()
    const onClose = vi.fn()
    const { container, rerender } = render(
      <Row open="left" onOpen={onOpen} onClose={onClose} />,
    )
    const { content } = parts(container)
    settle()
    expect(onOpen).toHaveBeenCalledExactlyOnceWith("left")
    expect(tx(content)).toBe(W)

    rerender(<Row open="right" onOpen={onOpen} onClose={onClose} />)
    settle()
    expect(tx(content)).toBe(-W)

    rerender(<Row open={false} onOpen={onOpen} onClose={onClose} />)
    settle()
    expect(tx(content)).toBe(0)
    expect(onClose).toHaveBeenCalledTimes(1)

    rerender(<Row open="right" onOpen={onOpen} onClose={onClose} />)
    settle()
    expect(tx(content)).toBe(-W)
    //once controlled, omitting open is the same as open={false}
    rerender(<Row onOpen={onOpen} onClose={onClose} />)
    settle()
    expect(tx(content)).toBe(0)
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it("an open requested before the tray has a width waits for layout, then opens", () => {
    const observers: { cb: () => void; nodes: Element[] }[] = []
    vi.stubGlobal(
      "ResizeObserver",
      class {
        entry: { cb: () => void; nodes: Element[] }
        constructor(cb: () => void) {
          this.entry = { cb, nodes: [] }
          observers.push(this.entry)
        }
        observe(node: Element) {
          this.entry.nodes.push(node)
        }
        disconnect() {
          this.entry.nodes = []
        }
      },
    )
    widths.right = 0
    const onOpen = vi.fn()
    const { container } = render(<Row open="right" onOpen={onOpen} />)
    const { content, rightPanel } = parts(container)
    settle()
    expect(onOpen).not.toHaveBeenCalled()
    expect(tx(content)).toBe(0)

    widths.right = 96
    const watcher = observers.find((o) =>
      o.nodes.includes(rightPanel as Element),
    )
    act(() => watcher?.cb())
    settle()
    expect(onOpen).toHaveBeenCalledExactlyOnceWith("right")
    expect(tx(content)).toBe(-96)
  })

  it("the handle reports the live side and closes on request", () => {
    const onClose = vi.fn()
    const ref = createRef<SwipeableHandle>()
    const { container } = render(<Row ref={ref} onClose={onClose} />)
    const { content } = parts(container)

    act(() => ref.current?.close())
    settle()
    expect(onClose).not.toHaveBeenCalled()

    slowDrag(content, 30)
    expect(ref.current?.open).toBe("left")
    act(() => ref.current?.close())
    expect(ref.current?.open).toBe(false)
    settle()
    expect(tx(content)).toBe(0)
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

/* ---- callbacks ----------------------------------------------------------- */

//onOpen and onClose report a change of state, closed to open and open to
//closed. A release that springs the row back to where it already was, or a
//close that finds nothing open, changed nothing, so it reports nothing
describe("Swipeable · onOpen and onClose report changes, not releases", () => {
  function openRight(content: HTMLElement) {
    slowDrag(content, -40)
    settle()
    expect(tx(content)).toBe(-W)
  }

  it("a drag from closed that springs back closed reports no close", () => {
    const onOpen = vi.fn()
    const onClose = vi.fn()
    const { container } = render(<Row onOpen={onOpen} onClose={onClose} />)
    const { content } = parts(container)
    slowDrag(content, -20) //under the 24px open line
    settle()
    expect(tx(content)).toBe(0)
    expect(onOpen).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })

  it("an open row nudged and sprung back open reports its open once", () => {
    const onOpen = vi.fn()
    const onClose = vi.fn()
    const { container } = render(<Row onOpen={onOpen} onClose={onClose} />)
    const { content } = parts(container)
    openRight(content)
    slowDrag(content, 12) //-80 → -68, inside the -60 close line
    settle()
    expect(tx(content)).toBe(-W)
    expect(onOpen).toHaveBeenCalledExactlyOnceWith("right")
    expect(onClose).not.toHaveBeenCalled()
  })

  it("a real open and a real close each report once, every time round", () => {
    const onOpen = vi.fn()
    const onClose = vi.fn()
    const ref = createRef<SwipeableHandle>()
    const { container } = render(
      <Row ref={ref} onOpen={onOpen} onClose={onClose} />,
    )
    const { content } = parts(container)
    openRight(content)
    expect(onOpen).toHaveBeenCalledExactlyOnceWith("right")
    expect(onClose).not.toHaveBeenCalled()

    slowDrag(content, 24) //-80 → -56, past the -60 line
    settle()
    expect(tx(content)).toBe(0)
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onOpen).toHaveBeenCalledTimes(1)

    //the same side again is a new open, and a close() a new close
    openRight(content)
    expect(onOpen).toHaveBeenCalledTimes(2)
    act(() => ref.current?.close())
    settle()
    expect(onClose).toHaveBeenCalledTimes(2)
    expect(onOpen).toHaveBeenCalledTimes(2)
  })

  it("a closing row grabbed and thrown back open reports neither a close nor a second open", () => {
    const onOpen = vi.fn()
    const onClose = vi.fn()
    const ref = createRef<SwipeableHandle>()
    const { container } = render(
      <Row ref={ref} onOpen={onOpen} onClose={onClose} />,
    )
    const { content } = parts(container)
    openRight(content)
    act(() => ref.current?.close())
    advance(FRAME)
    advance(FRAME)
    expect(tx(content)).toBeLessThan(-0.5)
    //the grab stops the close spring before it lands, then opens again
    mouseDrag(content, -60, { steps: 6 })
    settle()
    expect(tx(content)).toBe(-W)
    expect(ref.current?.open).toBe("right")
    expect(onClose).not.toHaveBeenCalled()
    expect(onOpen).toHaveBeenCalledExactlyOnceWith("right")
  })

  it("a row whose open prop follows its own callbacks reports each change once", () => {
    const onOpen = vi.fn()
    const onClose = vi.fn()
    function Controlled() {
      const [open, setOpen] = useState<false | "left" | "right">(false)
      return (
        <Row
          open={open}
          onOpen={(side) => {
            onOpen(side)
            setOpen(side)
          }}
          onClose={() => {
            onClose()
            setOpen(false)
          }}
        />
      )
    }
    const { container } = render(<Controlled />)
    const { content } = parts(container)
    openRight(content)
    expect(onOpen).toHaveBeenCalledExactlyOnceWith("right")

    slowDrag(content, 24)
    settle()
    expect(tx(content)).toBe(0)
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onOpen).toHaveBeenCalledTimes(1)
  })

  it("a close() during a drag that never opened the row reports no close", () => {
    const onClose = vi.fn()
    const ref = createRef<SwipeableHandle>()
    const { container } = render(<Row ref={ref} onClose={onClose} />)
    const { content } = parts(container)
    mouseDrag(content, -20, { steps: 10, release: false })
    expect(tx(content)).toBe(-20)
    act(() => ref.current?.close())
    act(() => {
      fireEvent.pointerUp(content, { pointerId: 1, pointerType: "mouse" })
    })
    settle()
    expect(tx(content)).toBe(0)
    expect(onClose).not.toHaveBeenCalled()
  })

  it("a tray action closes an open row with exactly one close", () => {
    const onClose = vi.fn()
    const onDelete = vi.fn()
    const { container, getByText } = render(
      <Row onClose={onClose} onDelete={onDelete} />,
    )
    const { content } = parts(container)
    openRight(content)
    act(() => {
      fireEvent.click(getByText("delete row"))
    })
    settle()
    expect(tx(content)).toBe(0)
    expect(onDelete).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it("a row with only onOpen reports every open, not just the first", () => {
    const onOpen = vi.fn()
    const ref = createRef<SwipeableHandle>()
    const { container } = render(<Row ref={ref} onOpen={onOpen} />)
    const { content } = parts(container)
    openRight(content)
    act(() => ref.current?.close())
    settle()
    openRight(content)
    expect(onOpen).toHaveBeenCalledTimes(2)
  })

  it("a close the parent asked for, caught and thrown back open, tells the parent it opened", () => {
    const seen: string[] = []
    let parentOpen: false | "left" | "right" = false
    let setParentOpen: (open: false | "left" | "right") => void = () => {}
    function Controlled() {
      const [open, setOpen] = useState<false | "left" | "right">(false)
      parentOpen = open
      setParentOpen = setOpen
      return (
        <Row
          open={open}
          onOpen={(side) => {
            seen.push(`open ${side}`)
            setOpen(side)
          }}
          onClose={() => {
            seen.push("close")
            setOpen(false)
          }}
        />
      )
    }
    const { container } = render(<Controlled />)
    const { content } = parts(container)
    openRight(content)
    expect(parentOpen).toBe("right")

    act(() => setParentOpen(false))
    advance(FRAME)
    advance(FRAME)
    expect(tx(content)).toBeLessThan(-0.5)
    mouseDrag(content, -60, { steps: 6 })
    settle()
    expect(tx(content)).toBe(-W)
    //the close never landed, so no onClose; the parent hears the row is open
    expect(seen).toEqual(["open right", "open right"])
    expect(parentOpen).toBe("right")

    //and its next close still closes the row
    act(() => setParentOpen(false))
    settle()
    expect(tx(content)).toBe(0)
    expect(seen).toEqual(["open right", "open right", "close"])
  })

  it("in a Group, a row closed by its sibling and thrown back open closes that sibling", () => {
    const a$ = { open: vi.fn(), close: vi.fn() }
    const b$ = { open: vi.fn(), close: vi.fn() }
    const { container } = render(
      <Swipeable.Group>
        <Row label="a" onOpen={a$.open} onClose={a$.close} />
        <Row label="b" onOpen={b$.open} onClose={b$.close} />
      </Swipeable.Group>,
    )
    const a = parts(container, 0).content
    const b = parts(container, 1).content
    openRight(a)
    //by touch, so no pointerup lands outside a: only the Group closes it
    touchDrag(b, line(20, -40))
    advance(FRAME)
    advance(FRAME)
    expect(tx(a)).toBeLessThan(-0.5)
    touchDrag(a, line(12, -60))
    settle()
    expect(tx(a)).toBe(-W)
    expect(tx(b)).toBe(0)
    //a never closed, so it reports nothing new; b opened and was closed
    expect(a$.open).toHaveBeenCalledTimes(1)
    expect(a$.close).not.toHaveBeenCalled()
    expect(b$.open).toHaveBeenCalledTimes(1)
    expect(b$.close).toHaveBeenCalledTimes(1)
  })
})

/* ---- structure ----------------------------------------------------------- */

describe("Swipeable · slots and structure", () => {
  it("renders a tray only for the sides that have actions", () => {
    const { container } = render(<Row left={false} />)
    const p = parts(container)
    expect(p.leftPanel).toBeNull()
    expect(p.rightPanel).not.toBeNull()
    expect(p.rightFill?.getAttribute("aria-hidden")).toBe("true")
  })

  it("recognises a consumer's wrapper slot by displayName and ignores stray children", () => {
    function MyRight({ children }: { children: ReactNode }) {
      return <Swipeable.RightActions>{children}</Swipeable.RightActions>
    }
    MyRight.displayName = "Swipeable.RightActions"
    const { container, queryByText } = render(
      <Swipeable>
        <Swipeable.Content>row</Swipeable.Content>
        <MyRight>
          <button type="button">wrapped</button>
        </MyRight>
        <span>stray</span>
        {"text"}
      </Swipeable>,
    )
    const { rightPanel } = parts(container)
    expect(rightPanel?.textContent).toBe("wrapped")
    expect(queryByText("stray")).toBeNull()
  })

  it("colours the rubber-band fill from the action nearest the content", () => {
    const { container } = render(
      <Swipeable>
        <Swipeable.Content>row</Swipeable.Content>
        <Swipeable.RightActions>
          <div>
            <button
              type="button"
              style={{ backgroundColor: "rgb(200, 0, 0)" }}
            >
              near
            </button>
          </div>
          <button
            type="button"
            style={{ backgroundColor: "rgb(0, 0, 200)" }}
          >
            far
          </button>
        </Swipeable.RightActions>
        <Swipeable.LeftActions>
          <button type="button" style={{ backgroundColor: "transparent" }}>
            clear
          </button>
        </Swipeable.LeftActions>
      </Swipeable>,
    )
    const { rightFill, leftFill } = parts(container)
    expect(rightFill?.style.backgroundColor).toBe("rgb(200, 0, 0)")
    expect(leftFill?.style.backgroundColor).toBe("")
  })

  it("mirrors a rounded root onto clip-path so the sliding content cannot bleed past the corners", () => {
    const { container } = render(
      <>
        <Row style={{ borderRadius: "12px" }} />
        <Row style={{ borderRadius: "0px" }} />
      </>,
    )
    expect(parts(container, 0).root.style.clipPath).toBe(
      "inset(0 round 12px 12px 12px 12px)",
    )
    expect(parts(container, 1).root.style.clipPath).toBe("")
  })

  it("isSwipeableGestureTarget finds a row from anything inside it", () => {
    const { container, getByText } = render(
      <>
        <Row />
        <p>outside</p>
      </>,
    )
    expect(isSwipeableGestureTarget(getByText("row"))).toBe(true)
    expect(isSwipeableGestureTarget(parts(container).root)).toBe(true)
    expect(isSwipeableGestureTarget(getByText("outside"))).toBe(false)
    expect(isSwipeableGestureTarget(null)).toBe(false)
    expect(isSwipeableGestureTarget(window)).toBe(false)
  })

  it("useSwipeable outside a row is a loud error", () => {
    function Stray() {
      useSwipeable()
      return null
    }
    vi.spyOn(console, "error").mockImplementation(() => undefined)
    expect(() => render(<Stray />)).toThrow(/within <Swipeable>/)
  })
})

/* ---- unmount ------------------------------------------------------------- */

describe("Swipeable · unmount", () => {
  it("unmounting mid-spring cancels the frame loop", () => {
    const { container, unmount } = render(<Row />)
    const { content } = parts(container)
    slowDrag(content, -30)
    advance(FRAME)
    expect(vi.getTimerCount()).toBeGreaterThan(0)
    unmount()
    expect(vi.getTimerCount()).toBe(0)
  })

  it("unmounting mid-drag frees the pointer for every other gesture", () => {
    const { container, unmount } = render(<Row />)
    const { content } = parts(container)
    touchDrag(content, line(10, -20), { release: false })
    expect(gestureController.getCaptured()).not.toBeNull()
    unmount()
    expect(gestureController.getCaptured()).toBeNull()
  })

  it("an unmounted row no longer answers the document-wide dismissers", () => {
    const onClose = vi.fn()
    const { container, unmount } = render(
      <>
        <Row onClose={onClose} />
        <input data-testid="text" />
      </>,
    )
    slowDrag(parts(container).content, -40)
    settle()
    const input = container.querySelector(
      "[data-testid=text]",
    ) as HTMLElement
    const orphan = input.cloneNode() as HTMLElement
    unmount()
    document.body.append(orphan)
    act(() => {
      orphan.focus()
      window.dispatchEvent(new Event("pointerup"))
    })
    settle()
    expect(onClose).not.toHaveBeenCalled()
    orphan.remove()
  })
})

/* ---- a parked tray ------------------------------------------------------- */

describe("Swipeable · a parked tray is out of reach", () => {
  //A closed row parks its trays off-screen with a transform, which hides them
  //from the eye and from nothing else: a Tab walked into the buttons and a screen
  //reader read them out. `inert` is what removes a subtree from both. happy-dom
  //has no tab order to walk, so the attribute is the contract pinned here, and
  //playground/e2e/swipeable-tray.spec.ts walks the real one in Chromium.
  function openRight(content: HTMLElement) {
    slowDrag(content, -40)
    settle()
    expect(tx(content)).toBe(-W)
  }

  it("a closed row's trays are inert, from the server's HTML on", () => {
    //before hydration there is no engine to park anything, so the markup has to
    //arrive parked
    expect(renderToString(<Row />).match(/ inert=""/g)).toHaveLength(2)

    const { container } = render(<Row />)
    const { leftPanel, rightPanel } = parts(container)
    expect(leftPanel?.inert).toBe(true)
    expect(rightPanel?.inert).toBe(true)
  })

  it("the tray a drag is revealing is reachable before the finger lifts, and only that one", () => {
    const { container } = render(<Row />)
    const { content, leftPanel, rightPanel } = parts(container)
    mouseDrag(content, -40, { release: false })
    expect(rightPanel?.inert).toBe(false)
    expect(leftPanel?.inert).toBe(true)

    act(() => {
      fireEvent.pointerUp(content, { pointerId: 1, pointerType: "mouse" })
    })
    settle()
    expect(tx(content)).toBe(-W)
    expect(rightPanel?.inert).toBe(false)
    expect(leftPanel?.inert).toBe(true)
  })

  it("a row opened through its open prop exposes the tray it opened", () => {
    const { container } = render(<Row open="left" />)
    const { leftPanel, rightPanel } = parts(container)
    settle()
    expect(leftPanel?.inert).toBe(false)
    expect(rightPanel?.inert).toBe(true)
  })

  it("the tray goes inert the moment the row starts to close, not when the spring lands", () => {
    const ref = createRef<SwipeableHandle>()
    const { container } = render(<Row ref={ref} />)
    const { content, rightPanel } = parts(container)
    openRight(content)

    act(() => ref.current?.close())
    advance(FRAME)
    //still sliding out
    expect(tx(content)).toBeLessThan(0)
    expect(rightPanel?.inert).toBe(true)
    settle()
    expect(rightPanel?.inert).toBe(true)
  })

  it("a drag that snaps back, or drags an open row shut, leaves the tray inert", () => {
    const { container } = render(<Row />)
    const { content, rightPanel } = parts(container)
    slowDrag(content, -20)
    expect(rightPanel?.inert).toBe(true)
    settle()

    openRight(content)
    slowDrag(content, 24) //-80 → -56, past the close line
    expect(rightPanel?.inert).toBe(true)
  })

  it("focus inside the tray when the row closes moves to the row's content", () => {
    const ref = createRef<SwipeableHandle>()
    const { container, getByText } = render(<Row ref={ref} />)
    const { content, rightPanel } = parts(container)
    openRight(content)

    const del = getByText("delete row")
    act(() => del.focus())
    expect(document.activeElement).toBe(del)

    //Enter on the focused action: a click, which closes the row
    act(() => {
      fireEvent.click(del)
    })
    expect(document.activeElement).toBe(content)
    expect(rightPanel?.inert).toBe(true)
    //focusable for that hand-off only — it never joins the tab order
    expect(content.getAttribute("tabindex")).toBe("-1")

    const elsewhere = document.createElement("button")
    document.body.append(elsewhere)
    act(() => elsewhere.focus())
    expect(content.hasAttribute("tabindex")).toBe(false)
    elsewhere.remove()
  })

  it("a close while focus is outside the tray leaves focus where it is", () => {
    const { container, getByText, getByTestId } = render(
      <>
        <Row />
        <input data-testid="text" />
      </>,
    )
    const { content, rightPanel } = parts(container)
    openRight(content)
    act(() => getByText("delete row").focus())

    //focusing a text field closes open rows (the keyboard is coming); that
    //close must not take the focus back from the field that caused it
    const field = getByTestId("text")
    act(() => field.focus())
    expect(rightPanel?.inert).toBe(true)
    expect(document.activeElement).toBe(field)
  })

  it("a drag that crosses zero hands the reveal from one tray to the other", () => {
    const { container } = render(<Row />)
    const { content, leftPanel, rightPanel } = parts(container)
    openRight(content)
    mouseDrag(content, 140, { release: false }) //-80 → +60, inside the left tray
    expect(tx(content)).toBe(60)
    expect(leftPanel?.inert).toBe(false)
    expect(rightPanel?.inert).toBe(true)
  })

  //grabbing a row mid-close stops its spring. The close used to stay latched
  //(closingRef still set), so the release's own close was a no-op: the row
  //stuck where the finger left it, onClose never fired, every later close()
  //did nothing — and with the tray inert, the sliver left in view was a dead one
  it("a row grabbed while it closes follows the finger, then closes for real, and closes again later", () => {
    const onClose = vi.fn()
    const ref = createRef<SwipeableHandle>()
    const { container } = render(<Row ref={ref} onClose={onClose} />)
    const { content, rightPanel } = parts(container)
    openRight(content)

    act(() => ref.current?.close())
    advance(FRAME)
    advance(FRAME)
    mouseDrag(content, 60, { release: false })
    //what the finger is holding in view is live
    expect(tx(content)).toBeLessThan(-0.5)
    expect(rightPanel?.inert).toBe(false)

    act(() => {
      fireEvent.pointerUp(content, { pointerId: 1, pointerType: "mouse" })
    })
    settle()
    expect(tx(content)).toBe(0)
    expect(rightPanel?.inert).toBe(true)
    expect(onClose).toHaveBeenCalledTimes(1)

    openRight(content)
    expect(rightPanel?.inert).toBe(false)
    act(() => ref.current?.close())
    settle()
    expect(tx(content)).toBe(0)
    expect(rightPanel?.inert).toBe(true)
    expect(onClose).toHaveBeenCalledTimes(2)
  })
})
