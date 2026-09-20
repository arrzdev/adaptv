import { act, fireEvent, render } from "@testing-library/react"
import type { ReactNode } from "react"
import { Activity, useState } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
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

afterEach(() => {
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

const wait = (ms: number) =>
  act(() => new Promise<void>((resolve) => setTimeout(resolve, ms)))

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
