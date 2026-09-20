import { act, fireEvent, render } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  PullToRefresh,
  usePullToRefresh,
} from "#adaptv/components/pull-to-refresh"

/*
 * `usePullToRefresh()` is the public reactive surface — a wrapper reads it to
 * colour a header or hide a toolbar while the user pulls. Every one of its four
 * fields is a function of the gesture PHASE, which changes a handful of times per
 * gesture; the pull OFFSET changes on every pointer frame. A context value that
 * is rebuilt on every provider render hands the offset's churn to every consumer:
 * ~60 renders a second for values that did not move.
 */

function stubMatchMedia() {
  vi.stubGlobal(
    "matchMedia",
    (query: string) =>
      ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }) as unknown as MediaQueryList,
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

function pointer(x: number, y: number) {
  //`isPrimary` must be explicit: synthetic PointerEvents default it to FALSE
  return { clientX: x, clientY: y, pointerId: 1, isPrimary: true }
}

describe("usePullToRefresh", () => {
  it("re-renders its consumers when the phase changes, not per pointer frame", () => {
    stubMatchMedia()
    const renders = { count: 0 }
    const seen: string[] = []
    function Probe() {
      renders.count++
      const { isPulling } = usePullToRefresh()
      seen.push(isPulling ? "pulling" : "idle")
      return <i data-pulling={String(isPulling)} />
    }
    const { container } = render(
      <PullToRefresh onRefresh={async () => {}}>
        <Probe />
      </PullToRefresh>,
    )
    const root = container.querySelector('[data-adaptv="pull-to-refresh"]')
    if (!(root instanceof HTMLElement)) throw new Error("no gesture root")

    const mountRenders = renders.count
    act(() => {
      fireEvent.pointerDown(root, pointer(0, 0))
    })
    //a vertical pull: one frame past the axis slop, then thirty more frames
    //of offset only — the phase settles to `pulling` on the first and stays
    const FRAMES = 30
    for (let i = 1; i <= FRAMES; i++) {
      //one `act` per frame: each pointer event is its own commit, as it is
      //in a browser, where the events arrive a frame apart
      act(() => {
        fireEvent.pointerMove(root, pointer(0, 20 + i * 4))
      })
    }
    expect(
      container.querySelector("i")?.getAttribute("data-pulling"),
    ).toBe("true")
    //one render for idle → pulling; the offset frames are not the consumer's
    expect(renders.count - mountRenders).toBe(1)
    expect(seen.at(-1)).toBe("pulling")
  })
})
/* ---- one finger owns the pull -------------------------------------------- */

describe("one finger owns the pull", () => {
  //a thumb steadying the phone, a knuckle, a second finger resting on the
  //screen: every one starts a touch of its own while the pull is under way.
  //The pull belongs to the finger that started it — the others neither
  //restart it from their own position nor release it when they lift

  type Finger = { id: number; x: number; y: number }
  //the component reads the touch lists off the event and nothing else, so a
  //plain cancelable Event carrying them is a faithful stand-in
  function fingersEvent(type: string, touches: Finger[], changed: Finger[]) {
    const event = new Event(type, { bubbles: true, cancelable: true })
    const list = (fingers: Finger[]) =>
      fingers.map((f) => ({ identifier: f.id, clientX: f.x, clientY: f.y }))
    Object.defineProperty(event, "touches", { value: list(touches) })
    Object.defineProperty(event, "changedTouches", { value: list(changed) })
    return event
  }

  function pullRow() {
    stubMatchMedia()
    const onRefresh = vi.fn(async () => {})
    const phase = { current: "idle" }
    function Probe() {
      const pull = usePullToRefresh()
      phase.current = pull.isPulling
        ? "pulling"
        : pull.isRefreshing
          ? "refreshing"
          : pull.isClosing
            ? "closing"
            : "idle"
      return null
    }
    const { container } = render(
      <PullToRefresh onRefresh={onRefresh}>
        <Probe />
      </PullToRefresh>,
    )
    const root = container.querySelector('[data-adaptv="pull-to-refresh"]')
    if (!(root instanceof HTMLElement)) throw new Error("no gesture root")
    return { root, phase, onRefresh }
  }

  const f1 = (y: number): Finger => ({ id: 0, x: 0, y })
  const f2: Finger = { id: 1, x: 100, y: 300 }

  it("a cancel naming another finger changes nothing; one naming the pulling finger ends the pull (touch)", () => {
    const { root, phase, onRefresh } = pullRow()
    act(() => {
      root.dispatchEvent(fingersEvent("touchstart", [f1(0)], [f1(0)]))
    })
    for (let y = 12; y <= 40; y += 4) {
      act(() => {
        root.dispatchEvent(fingersEvent("touchmove", [f1(y)], [f1(y)]))
      })
    }
    expect(phase.current).toBe("pulling")
    //the browser cancels the thumb: the pulling finger is still down
    act(() => {
      root.dispatchEvent(fingersEvent("touchcancel", [f1(40)], [f2]))
    })
    expect(phase.current).toBe("pulling")
    //the whole touch taken away: the pulling finger is among the cancelled
    act(() => {
      root.dispatchEvent(fingersEvent("touchcancel", [], [f1(40), f2]))
    })
    expect(phase.current).not.toBe("pulling")
    expect(onRefresh).not.toHaveBeenCalled()
  })

  it("a second finger landing and lifting mid-pull neither restarts nor releases it (touch)", () => {
    const { root, phase, onRefresh } = pullRow()
    act(() => {
      root.dispatchEvent(fingersEvent("touchstart", [f1(0)], [f1(0)]))
    })
    for (let y = 12; y <= 60; y += 4) {
      act(() => {
        root.dispatchEvent(fingersEvent("touchmove", [f1(y)], [f1(y)]))
      })
    }
    expect(phase.current).toBe("pulling")

    act(() => {
      root.dispatchEvent(fingersEvent("touchstart", [f1(60), f2], [f2]))
    })
    for (let y = 64; y <= 120; y += 4) {
      act(() => {
        root.dispatchEvent(fingersEvent("touchmove", [f1(y), f2], [f1(y)]))
      })
    }
    act(() => {
      root.dispatchEvent(fingersEvent("touchend", [f1(120)], [f2]))
    })
    expect(phase.current).toBe("pulling")
    expect(onRefresh).not.toHaveBeenCalled()

    //the first finger lifts past the threshold: its pull, its refresh
    act(() => {
      root.dispatchEvent(fingersEvent("touchend", [], [f1(120)]))
    })
    expect(phase.current).toBe("refreshing")
    expect(onRefresh).toHaveBeenCalledTimes(1)
  })

  it("a second finger landing and lifting mid-pull neither restarts nor releases it (pointer)", () => {
    const { root, phase, onRefresh } = pullRow()
    const second = (x: number, y: number) => ({
      clientX: x,
      clientY: y,
      pointerId: 2,
      isPrimary: false,
    })
    act(() => {
      fireEvent.pointerDown(root, pointer(0, 0))
    })
    for (let y = 12; y <= 60; y += 4) {
      act(() => {
        fireEvent.pointerMove(root, pointer(0, y))
      })
    }
    expect(phase.current).toBe("pulling")

    act(() => {
      fireEvent.pointerDown(root, second(100, 300))
    })
    for (let y = 64; y <= 120; y += 4) {
      act(() => {
        fireEvent.pointerMove(root, pointer(0, y))
      })
    }
    act(() => {
      fireEvent.pointerUp(root, second(100, 300))
    })
    expect(phase.current).toBe("pulling")
    expect(onRefresh).not.toHaveBeenCalled()

    act(() => {
      fireEvent.pointerUp(root, pointer(0, 120))
    })
    expect(phase.current).toBe("refreshing")
    expect(onRefresh).toHaveBeenCalledTimes(1)
  })
})
