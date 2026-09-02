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
