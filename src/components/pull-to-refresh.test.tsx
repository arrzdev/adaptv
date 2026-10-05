import { act, fireEvent, render } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { gestureController } from "#adaptv/capabilities/gesture-controller"
import {
  PullToRefresh,
  usePullToRefresh,
} from "#adaptv/components/pull-to-refresh"
import { Swipeable } from "#adaptv/components/swipeable"

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
  function fingersEvent(
    type: string,
    touches: Finger[],
    changed: Finger[],
  ) {
    const event = new Event(type, { bubbles: true, cancelable: true })
    const list = (fingers: Finger[]) =>
      fingers.map((f) => ({
        identifier: f.id,
        clientX: f.x,
        clientY: f.y,
      }))
    Object.defineProperty(event, "touches", { value: list(touches) })
    Object.defineProperty(event, "changedTouches", {
      value: list(changed),
    })
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

/* ---- a pull that starts on a swipeable row ------------------------------- */

describe("a pull that starts on a swipeable row", () => {
  //the screen this exists for is a mail list: pull-to-refresh over rows
  //that swipe. Every finger lands on a row, so a pull that refuses to start
  //there is a pull that never starts. The axis decides: a horizontal drag
  //is the row's and clears the pull, a vertical one is the pull's

  type Finger = { id: number; x: number; y: number }
  function fingersEvent(
    type: string,
    touches: Finger[],
    changed: Finger[],
  ) {
    const event = new Event(type, { bubbles: true, cancelable: true })
    const list = (fingers: Finger[]) =>
      fingers.map((f) => ({
        identifier: f.id,
        clientX: f.x,
        clientY: f.y,
      }))
    Object.defineProperty(event, "touches", { value: list(touches) })
    Object.defineProperty(event, "changedTouches", {
      value: list(changed),
    })
    return event
  }

  function mailList() {
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
        <Swipeable>
          <Swipeable.Content>
            <p>a message</p>
          </Swipeable.Content>
          <Swipeable.RightActions>
            <button type="button">delete</button>
          </Swipeable.RightActions>
        </Swipeable>
      </PullToRefresh>,
    )
    const content = container.querySelector("[data-swipeable-content] p")
    if (!(content instanceof HTMLElement))
      throw new Error("no row content")
    return { content, phase, onRefresh }
  }

  const f = (x: number, y: number): Finger => ({ id: 0, x, y })

  it("pulls (touch)", () => {
    const { content, phase, onRefresh } = mailList()
    act(() => {
      content.dispatchEvent(
        fingersEvent("touchstart", [f(0, 0)], [f(0, 0)]),
      )
    })
    for (let y = 12; y <= 120; y += 4) {
      act(() => {
        content.dispatchEvent(
          fingersEvent("touchmove", [f(0, y)], [f(0, y)]),
        )
      })
    }
    expect(phase.current).toBe("pulling")
    act(() => {
      content.dispatchEvent(fingersEvent("touchend", [], [f(0, 120)]))
    })
    expect(phase.current).toBe("refreshing")
    expect(onRefresh).toHaveBeenCalledTimes(1)
  })

  it("pulls (pointer)", () => {
    const { content, phase, onRefresh } = mailList()
    act(() => {
      fireEvent.pointerDown(content, pointer(0, 0))
    })
    for (let y = 12; y <= 120; y += 4) {
      act(() => {
        fireEvent.pointerMove(content, pointer(0, y))
      })
    }
    expect(phase.current).toBe("pulling")
    act(() => {
      fireEvent.pointerUp(content, pointer(0, 120))
    })
    expect(phase.current).toBe("refreshing")
    expect(onRefresh).toHaveBeenCalledTimes(1)
  })

  it("yields a horizontal drag to the row (touch)", () => {
    const { content, phase, onRefresh } = mailList()
    act(() => {
      content.dispatchEvent(
        fingersEvent("touchstart", [f(0, 0)], [f(0, 0)]),
      )
    })
    for (let x = -12; x >= -120; x -= 4) {
      act(() => {
        content.dispatchEvent(
          fingersEvent("touchmove", [f(x, 4)], [f(x, 4)]),
        )
      })
    }
    expect(phase.current).toBe("idle")
    //yielded means the row took it: the row holds the shared arbiter from
    //its lock to the lift (happy-dom measures no tray width, so the offset
    //is not the evidence here; the arbiter claim is)
    expect(gestureController.getCaptured()).not.toBeNull()
    act(() => {
      content.dispatchEvent(fingersEvent("touchend", [], [f(-120, 4)]))
    })
    expect(gestureController.getCaptured()).toBeNull()
    expect(phase.current).toBe("idle")
    expect(onRefresh).not.toHaveBeenCalled()
  })

  it("captures the pointer on its own root once the pull is vertical, never on the row it started in (pointer)", () => {
    //a capture at pointerdown steals the click from a button the press was
    //aimed at, and a capture on the child under the pointer is one the row
    //moves to its own content at its lock, which fires lostpointercapture at
    //that child and ends the row's mouse swipe the moment it locks
    const { content, phase } = mailList()
    const root = content.closest('[data-adaptv="pull-to-refresh"]')
    if (!(root instanceof HTMLElement)) throw new Error("no gesture root")
    const captures: EventTarget[] = []
    const releases: EventTarget[] = []
    const proto = HTMLElement.prototype as HTMLElement & {
      setPointerCapture?: (id: number) => void
      releasePointerCapture?: (id: number) => void
    }
    const had = {
      set: Object.getOwnPropertyDescriptor(proto, "setPointerCapture"),
      release: Object.getOwnPropertyDescriptor(
        proto,
        "releasePointerCapture",
      ),
    }
    proto.setPointerCapture = function (this: HTMLElement) {
      captures.push(this)
    }
    proto.releasePointerCapture = function (this: HTMLElement) {
      releases.push(this)
    }
    try {
      act(() => {
        fireEvent.pointerDown(content, pointer(0, 0))
      })
      expect(
        captures,
        "a press captures nothing: a click may follow",
      ).toEqual([])
      for (let y = 12; y <= 60; y += 4) {
        act(() => {
          fireEvent.pointerMove(content, pointer(0, y))
        })
      }
      expect(phase.current).toBe("pulling")
      expect(captures).toEqual([root])
      act(() => {
        fireEvent.pointerUp(content, pointer(0, 60))
      })
      expect(releases).toEqual([root])
    } finally {
      for (const [name, d] of [
        ["setPointerCapture", had.set],
        ["releasePointerCapture", had.release],
      ] as const) {
        if (d) Object.defineProperty(proto, name, d)
        else Reflect.deleteProperty(proto, name)
      }
    }
  })
})

describe("PullToRefresh — default rules in the layer, locks inline (styling.md §2)", () => {
  it("names its root, reaches its inner parts as children, and emits no class of its own", () => {
    const { container } = render(
      <PullToRefresh onRefresh={async () => {}}>
        <i data-testid="inside" />
      </PullToRefresh>,
    )
    const root = container.querySelector<HTMLElement>(
      '[data-adaptv="pull-to-refresh"]',
    )
    if (!root) throw new Error("no gesture root")
    expect(root.getAttribute("data-part")).toBe("root")
    expect(root.getAttribute("class") ?? "").toBe("")
    //one scope element: the consumer's content finds the gesture root with `closest()`
    expect(
      container.querySelectorAll('[data-adaptv="pull-to-refresh"]'),
    ).toHaveLength(1)
    const status = root.querySelector(':scope > [data-part="status"]')
    const content = root.querySelector(':scope > [data-part="content"]')
    expect(status?.getAttribute("aria-live")).toBe("polite")
    expect(status?.hasAttribute("class")).toBe(false)
    expect(content?.hasAttribute("class")).toBe(false)
    expect(content?.querySelector('[data-testid="inside"]')).not.toBeNull()
  })

  it("passes a consumer className through and holds the containing block inline", () => {
    for (const enabled of [true, false]) {
      const { container, unmount } = render(
        <PullToRefresh
          onRefresh={async () => {}}
          enabled={enabled}
          className="flex-1 static"
        >
          p
        </PullToRefresh>,
      )
      const root = container.firstElementChild as HTMLElement
      //only a live gesture root answers to `pull-to-refresh`; an idle row has its own
      expect(root.getAttribute("data-adaptv")).toBe(
        enabled ? "pull-to-refresh" : "pull-to-refresh-root",
      )
      expect(root.getAttribute("data-part")).toBe("root")
      expect(root.className).toBe("flex-1 static")
      //`static` cannot unseat it: the indicator is positioned against this box
      expect(root.style.position).toBe("relative")
      unmount()
    }
  })
})
