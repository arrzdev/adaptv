import { renderHook } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { useScreenLifecycle } from "#adaptv/hooks/use-screen-lifecycle"

//D11 (docs/decisions/register.md) → docs/design/coordination.md §4: no DOM
//retention, so mount IS enter and unmount IS leave — and resume is neither.

describe("useScreenLifecycle", () => {
  it("enters once on mount and leaves once on unmount, never on a re-render", () => {
    const events: string[] = []
    const { rerender, unmount } = renderHook(
      ({ tick }: { tick: number }) =>
        //inline arrows, a fresh identity every render — the normal call site
        useScreenLifecycle({
          onEnter: () => events.push(`enter@${tick}`),
          onLeave: () => events.push(`leave@${tick}`),
        }),
      { initialProps: { tick: 0 } },
    )
    expect(events).toEqual(["enter@0"])

    rerender({ tick: 1 })
    rerender({ tick: 2 })
    expect(events).toEqual(["enter@0"])

    unmount()
    //the LATEST onLeave runs, so it sees the screen's final state, not its first
    expect(events).toEqual(["enter@0", "leave@2"])
  })

  it("does not fire on background or resume — that is useOnResume's event", () => {
    const onEnter = vi.fn()
    const onLeave = vi.fn()
    renderHook(() => useScreenLifecycle({ onEnter, onLeave }))
    expect(onEnter).toHaveBeenCalledTimes(1)

    for (const state of ["hidden", "visible"] as const) {
      Object.defineProperty(document, "visibilityState", {
        value: state,
        configurable: true,
      })
      document.dispatchEvent(new Event("visibilitychange"))
    }
    window.dispatchEvent(new Event("pageshow"))
    delete (document as unknown as Record<string, unknown>).visibilityState

    expect(onEnter).toHaveBeenCalledTimes(1)
    expect(onLeave).not.toHaveBeenCalled()
  })
})
