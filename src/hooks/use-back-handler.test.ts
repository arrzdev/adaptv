import { renderHook } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  BackPriority,
  resetBackChain,
  runBackChain,
} from "#adaptv/capabilities/back-chain"
import { useBackHandler } from "#adaptv/hooks/use-back-handler"

afterEach(() => {
  resetBackChain()
})

describe("useBackHandler", () => {
  it("intercepts the press while mounted, and only while mounted", () => {
    const handler = vi.fn(() => true)
    const { unmount } = renderHook(() => useBackHandler(handler))

    expect(runBackChain()).toBe(true)
    expect(handler).toHaveBeenCalledTimes(1)

    unmount()
    expect(runBackChain()).toBe(false)
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it("defers to the next handler when it returns false", () => {
    const overlay = vi.fn(() => false)
    const floor = vi.fn(() => true)
    renderHook(() => {
      useBackHandler(overlay, BackPriority.Overlay)
      useBackHandler(floor, BackPriority.RouterBack)
    })

    expect(runBackChain()).toBe(true)
    expect(overlay).toHaveBeenCalledTimes(1)
    expect(floor).toHaveBeenCalledTimes(1)
  })

  it("runs the highest band first, whatever order the components mounted in", () => {
    const affordance = vi.fn(() => true)
    const overlay = vi.fn(() => true)
    renderHook(() => useBackHandler(affordance, BackPriority.Affordance))
    renderHook(() => useBackHandler(overlay, BackPriority.Overlay))

    expect(runBackChain()).toBe(true)
    expect(overlay).toHaveBeenCalledTimes(1)
    expect(affordance).not.toHaveBeenCalled()
  })

  it("calls the LATEST handler without re-registering it", () => {
    //the property the ref exists for. Re-registering on identity change would move
    //the entry to the newest slot in its band — so of two stacked overlays, a
    //re-render of the BOTTOM one would silently make it close first.
    const bottom = vi.fn(() => true)
    const bottomRerendered = vi.fn(() => true)
    const top = vi.fn(() => true)

    const { rerender } = renderHook(
      ({ handler }: { handler: () => boolean }) =>
        useBackHandler(handler, BackPriority.Overlay),
      { initialProps: { handler: bottom } },
    )
    renderHook(() => useBackHandler(top, BackPriority.Overlay))

    rerender({ handler: bottomRerendered })
    expect(runBackChain()).toBe(true)
    //the top overlay is still the one that closes
    expect(top).toHaveBeenCalledTimes(1)
    expect(bottom).not.toHaveBeenCalled()
    expect(bottomRerendered).not.toHaveBeenCalled()

    //…and when it is the bottom one's turn, the NEW closure runs, not the stale one
    top.mockReturnValue(false)
    expect(runBackChain()).toBe(true)
    expect(bottomRerendered).toHaveBeenCalledTimes(1)
    expect(bottom).not.toHaveBeenCalled()
  })

  it("defaults to the transient band", () => {
    const transient = vi.fn(() => true)
    const overlay = vi.fn(() => true)
    renderHook(() => useBackHandler(transient))
    renderHook(() => useBackHandler(overlay, BackPriority.Overlay))

    expect(runBackChain()).toBe(true)
    expect(overlay).toHaveBeenCalledTimes(1)
    expect(transient).not.toHaveBeenCalled()
  })
})
