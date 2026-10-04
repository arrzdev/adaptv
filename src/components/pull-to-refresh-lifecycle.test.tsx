import { act, fireEvent, render } from "@testing-library/react"
import type { ReactNode } from "react"
import { Activity, useState } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  PullToRefresh,
  usePullToRefresh,
} from "#adaptv/components/pull-to-refresh"

/*
 * A refresh ends. Whatever the app's `onRefresh` does — resolve, reject — and
 * whatever the app does to the tree meanwhile — hide it in an `<Activity>` —
 * the row goes back to idle, so the next pull can start. A rejection is the
 * app's error: it is reported once, the way a throwing event listener's is,
 * and it is never turned into a second, unhandled promise of adaptv's own.
 */

//the hold, the close and motion's frame loop all read the clock, so they run on
//the fake one: a wait is virtual instead of real
beforeEach(() => {
  vi.useFakeTimers({
    toFake: [
      "setTimeout",
      "clearTimeout",
      "setInterval",
      "clearInterval",
      "Date",
      "requestAnimationFrame",
      "cancelAnimationFrame",
      "performance",
    ],
  })
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

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

function pointer(x: number, y: number) {
  //`isPrimary` must be explicit: synthetic PointerEvents default it to FALSE
  return { clientX: x, clientY: y, pointerId: 1, isPrimary: true }
}

//one 16ms frame at a time: motion captured happy-dom's own rAF, a real
//`setImmediate`, at import, so each step lets that frame run before the next
const wait = (ms: number) =>
  act(async () => {
    for (let t = 0; t < ms; t += 16) {
      await vi.advanceTimersByTimeAsync(Math.min(16, ms - t))
      await new Promise((resolve) => setImmediate(resolve))
    }
  })

type Phase = "idle" | "pulling" | "refreshing" | "closing"

function mountInActivity(refresh: ReactNode) {
  const handle = { setMode: (_mode: "visible" | "hidden") => {} }
  function Host() {
    const [mode, setMode] = useState<"visible" | "hidden">("visible")
    handle.setMode = setMode
    return <Activity mode={mode}>{refresh}</Activity>
  }
  const view = render(<Host />)
  return { ...view, handle }
}

function phaseProbe() {
  const phase = { current: "" as Phase | "" }
  function Phase() {
    const pull = usePullToRefresh()
    phase.current = pull.isPulling
      ? "pulling"
      : pull.isRefreshing
        ? "refreshing"
        : pull.isClosing
          ? "closing"
          : "idle"
    return <p>content</p>
  }
  return { phase, Phase }
}

function pullPastThreshold(container: HTMLElement) {
  const root = container.querySelector('[data-adaptv="pull-to-refresh"]')
  if (!(root instanceof HTMLElement)) throw new Error("no gesture root")
  act(() => {
    fireEvent.pointerDown(root, pointer(0, 0))
  })
  for (let y = 12; y <= 120; y += 4) {
    act(() => {
      fireEvent.pointerMove(root, pointer(0, y))
    })
  }
  act(() => {
    fireEvent.pointerUp(root, pointer(0, 120))
  })
}

async function until(
  phase: { current: string },
  wanted: Phase,
  timeoutMs = 2000,
) {
  for (let t = 0; t < timeoutMs && phase.current !== wanted; t += 20)
    await wait(20)
  return phase.current
}

describe("a refresh that settles before `stuckMinMs`", () => {
  it("holds the refreshing row for the rest of the minimum, then closes", async () => {
    stubMatchMedia()
    const { phase, Phase } = phaseProbe()
    const { container } = render(
      <PullToRefresh onRefresh={async () => {}} stuckMinMs={400}>
        <Phase />
      </PullToRefresh>,
    )
    pullPastThreshold(container)
    expect(await until(phase, "refreshing")).toBe("refreshing")
    //one frame, so the settled refresh's hold is armed before the clock runs:
    //a state update made inside a `wait` commits when that wait ends
    await wait(16)
    //the refresh settled at once; the row stays put until the minimum has run
    await wait(300)
    expect(phase.current).toBe("refreshing")
    await wait(150)
    expect(phase.current).not.toBe("refreshing")
    expect(await until(phase, "idle")).toBe("idle")
  })
})

describe("a refresh hidden by an app `<Activity>`", () => {
  it("still closes after the minimum stuck time when shown again", async () => {
    stubMatchMedia()
    const { phase, Phase } = phaseProbe()
    const { container, handle } = mountInActivity(
      <PullToRefresh onRefresh={async () => {}} stuckMinMs={400}>
        <Phase />
      </PullToRefresh>,
    )
    pullPastThreshold(container)
    expect(await until(phase, "refreshing")).toBe("refreshing")
    //the premise: the refresh already settled and the row is holding its snap
    await wait(60)
    expect(phase.current).toBe("refreshing")

    act(() => handle.setMode("hidden"))
    await wait(100)
    act(() => handle.setMode("visible"))
    //shown with time left on the hold: it is still held, not closed early
    expect(phase.current).toBe("refreshing")
    expect(await until(phase, "idle")).toBe("idle")
  })

  it("closes when the refresh settled while it was hidden", async () => {
    stubMatchMedia()
    const { phase, Phase } = phaseProbe()
    let settle = () => {}
    const { container, handle } = mountInActivity(
      <PullToRefresh
        onRefresh={() =>
          new Promise<void>((resolve) => {
            settle = resolve
          })
        }
        stuckMinMs={100}
      >
        <Phase />
      </PullToRefresh>,
    )
    pullPastThreshold(container)
    expect(await until(phase, "refreshing")).toBe("refreshing")

    act(() => handle.setMode("hidden"))
    await wait(20)
    await act(async () => settle())
    await wait(200)
    act(() => handle.setMode("visible"))
    expect(await until(phase, "idle")).toBe("idle")
  })
})

describe("a rejecting onRefresh", () => {
  function listenForUnhandled() {
    const unhandled: unknown[] = []
    const onUnhandled = (reason: unknown) => {
      unhandled.push(reason)
    }
    process.on("unhandledRejection", onUnhandled)
    return {
      unhandled,
      stop: () => process.off("unhandledRejection", onUnhandled),
    }
  }

  const cases = [
    {
      name: "an Error",
      stuckMinMs: 0,
      failure: new Error("refresh failed"),
    },
    {
      name: "an Error",
      stuckMinMs: 150,
      failure: new Error("refresh failed"),
    },
    //a bare `reject()`, as cancellation code writes it
    { name: "no reason", stuckMinMs: 0, failure: undefined },
  ]
  for (const { name, stuckMinMs, failure } of cases) {
    it(`closes, reports ${name} once and leaves no unhandled rejection (stuckMinMs ${stuckMinMs})`, async () => {
      stubMatchMedia()
      const reported: unknown[] = []
      vi.stubGlobal("reportError", (error: unknown) => {
        reported.push(error)
      })
      const listener = listenForUnhandled()
      try {
        const { phase, Phase } = phaseProbe()
        const { container } = render(
          <PullToRefresh
            onRefresh={() => Promise.reject(failure)}
            stuckMinMs={stuckMinMs}
          >
            <Phase />
          </PullToRefresh>,
        )
        pullPastThreshold(container)
        expect(await until(phase, "idle")).toBe("idle")
        //a few more turns, so an unhandled rejection has been noticed
        await wait(50)
        expect(listener.unhandled).toEqual([])
        expect(reported).toEqual([failure])
      } finally {
        listener.stop()
      }
    })
  }

  it("logs the error to the console where there is no reportError", async () => {
    stubMatchMedia()
    vi.stubGlobal("reportError", undefined)
    const logged = vi.spyOn(console, "error").mockImplementation(() => {})
    const failure = new Error("refresh failed")
    const listener = listenForUnhandled()
    try {
      const { phase, Phase } = phaseProbe()
      const { container } = render(
        <PullToRefresh
          onRefresh={() => Promise.reject(failure)}
          stuckMinMs={0}
        >
          <Phase />
        </PullToRefresh>,
      )
      pullPastThreshold(container)
      expect(await until(phase, "idle")).toBe("idle")
      await wait(50)
      expect(listener.unhandled).toEqual([])
      expect(logged.mock.calls).toEqual([[failure]])
    } finally {
      logged.mockRestore()
      listener.stop()
    }
  })

  it("lets the next pull refresh again after a rejection", async () => {
    stubMatchMedia()
    vi.stubGlobal("reportError", () => {})
    const listener = listenForUnhandled()
    try {
      const { phase, Phase } = phaseProbe()
      const calls = { count: 0 }
      const { container } = render(
        <PullToRefresh
          onRefresh={() => {
            calls.count++
            return calls.count === 1
              ? Promise.reject(new Error("first fails"))
              : Promise.resolve()
          }}
          stuckMinMs={0}
        >
          <Phase />
        </PullToRefresh>,
      )
      pullPastThreshold(container)
      expect(await until(phase, "idle")).toBe("idle")
      pullPastThreshold(container)
      expect(await until(phase, "refreshing")).toBe("refreshing")
      expect(await until(phase, "idle")).toBe("idle")
      expect(calls.count).toBe(2)
    } finally {
      listener.stop()
    }
  })
})

describe("a row whose app turns `enabled` off mid-gesture", () => {
  //`enabled={false}` refuses new pulls. It must not strand the row: a refresh
  //under way still settles, and whatever is showing still closes to idle.

  function toggledRow(
    onRefresh: () => Promise<unknown>,
    stuckMinMs: number,
  ) {
    const { phase, Phase } = phaseProbe()
    const handle = { setEnabled: (_enabled: boolean) => {} }
    function Host() {
      const [enabled, setEnabled] = useState(true)
      handle.setEnabled = setEnabled
      return (
        <PullToRefresh
          enabled={enabled}
          onRefresh={onRefresh}
          stuckMinMs={stuckMinMs}
        >
          <Phase />
        </PullToRefresh>
      )
    }
    const view = render(<Host />)
    const root = view.container.querySelector(
      '[data-adaptv="pull-to-refresh"]',
    )
    if (!(root instanceof HTMLElement)) throw new Error("no gesture root")
    return { ...view, root, phase, handle }
  }

  function pullTo(root: HTMLElement, to: number, release: boolean) {
    act(() => {
      fireEvent.pointerDown(root, pointer(0, 0))
    })
    for (let y = 12; y <= to; y += 4) {
      act(() => {
        fireEvent.pointerMove(root, pointer(0, y))
      })
    }
    if (release)
      act(() => {
        fireEvent.pointerUp(root, pointer(0, to))
      })
  }

  it("lets a refresh under way settle and close to idle", async () => {
    stubMatchMedia()
    let settle = () => {}
    const onRefresh = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          settle = resolve
        }),
    )
    const { root, phase, handle } = toggledRow(onRefresh, 100)
    pullTo(root, 120, true)
    expect(await until(phase, "refreshing")).toBe("refreshing")

    act(() => handle.setEnabled(false))
    //the refresh is the app's; turning pulls off does not cancel it
    expect(phase.current).toBe("refreshing")
    await act(async () => settle())
    expect(await until(phase, "idle")).toBe("idle")
    expect(onRefresh).toHaveBeenCalledTimes(1)
  })

  it("finishes a close that was already under way", async () => {
    stubMatchMedia()
    const { root, phase, handle } = toggledRow(async () => {}, 0)
    //released below the threshold, with the spinner showing: a release close
    pullTo(root, 50, true)
    expect(phase.current).toBe("closing")

    act(() => handle.setEnabled(false))
    expect(await until(phase, "idle")).toBe("idle")
  })

  it("closes a pull the finger is still holding, without refreshing", async () => {
    stubMatchMedia()
    const onRefresh = vi.fn(async () => {})
    const { root, phase, handle } = toggledRow(onRefresh, 0)
    pullTo(root, 120, false)
    expect(phase.current).toBe("pulling")

    act(() => handle.setEnabled(false))
    //the finger lifts after the row let go of it
    act(() => {
      fireEvent.pointerUp(root, pointer(0, 120))
    })
    expect(await until(phase, "idle")).toBe("idle")
    expect(onRefresh).not.toHaveBeenCalled()
  })

  it("refuses a press on a row still closing after it was turned off", async () => {
    stubMatchMedia()
    const onRefresh = vi.fn(async () => {})
    const { root, phase, handle } = toggledRow(onRefresh, 0)
    pullTo(root, 50, true)
    expect(phase.current).toBe("closing")

    act(() => handle.setEnabled(false))
    //the row is still drawn, handlers and all, while it closes: a press there
    //must neither cut the close short nor start a pull
    pullTo(root, 120, true)
    expect(phase.current).toBe("closing")
    expect(await until(phase, "idle")).toBe("idle")
    expect(onRefresh).not.toHaveBeenCalled()
  })

  it("forgets a press that had not moved yet when turned off", async () => {
    stubMatchMedia()
    const onRefresh = vi.fn(async () => {})
    const { container, root, phase, handle } = toggledRow(onRefresh, 0)
    act(() => {
      fireEvent.pointerDown(root, pointer(0, 0))
    })
    act(() => handle.setEnabled(false))
    act(() => handle.setEnabled(true))
    //back on, a hover that was never pressed again must not pull or refresh
    const again = container.querySelector(
      '[data-adaptv="pull-to-refresh"]',
    )
    if (!(again instanceof HTMLElement)) throw new Error("no gesture root")
    for (let y = 12; y <= 120; y += 4) {
      act(() => {
        fireEvent.pointerMove(again, pointer(0, y))
      })
    }
    act(() => {
      fireEvent.pointerLeave(again, pointer(0, 120))
    })
    await wait(100)
    expect(phase.current).toBe("idle")
    expect(onRefresh).not.toHaveBeenCalled()
  })

  it("refuses new pulls while off, and pulls again once back on", async () => {
    stubMatchMedia()
    const onRefresh = vi.fn(async () => {})
    const { container, root, phase, handle } = toggledRow(onRefresh, 0)
    act(() => handle.setEnabled(false))
    pullTo(root, 120, true)
    await wait(100)
    expect(phase.current).toBe("idle")
    expect(onRefresh).not.toHaveBeenCalled()

    act(() => handle.setEnabled(true))
    pullPastThreshold(container)
    expect(await until(phase, "refreshing")).toBe("refreshing")
    expect(await until(phase, "idle")).toBe("idle")
    expect(onRefresh).toHaveBeenCalledTimes(1)
  })
})
