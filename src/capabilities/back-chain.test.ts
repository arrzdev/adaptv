import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  BackPriority,
  registerBackHandler,
  runBackChain,
} from "#adaptv/capabilities/back-chain"

const cleanups: Array<() => void> = []

function register(handler: () => boolean, priority: number): () => void {
  const off = registerBackHandler(handler, priority)
  cleanups.push(off)
  return off
}

beforeEach(() => {
  for (const off of cleanups.splice(0)) off()
})

describe("runBackChain — priority order", () => {
  it("runs handlers high priority first", () => {
    //an open drawer must close BEFORE the router navigates. A lone router.back()
    //cannot know the drawer is open, which is the whole reason for the chain.
    const order: string[] = []
    register(() => {
      order.push("low")
      return false
    }, BackPriority.RouterBack)
    register(() => {
      order.push("high")
      return false
    }, BackPriority.Overlay)

    runBackChain()
    expect(order).toEqual(["high", "low"])
  })

  it("stops at the first handler that claims the press", () => {
    const lower = vi.fn(() => true)
    register(lower, BackPriority.RouterBack)
    register(() => true, BackPriority.Overlay)

    expect(runBackChain()).toBe(true)
    expect(lower).not.toHaveBeenCalled()
  })

  it("defers past a handler that returns false", () => {
    const lower = vi.fn(() => true)
    register(lower, BackPriority.RouterBack)
    register(() => false, BackPriority.Overlay)

    runBackChain()
    expect(lower).toHaveBeenCalledOnce()
  })

  it("reports unhandled when nothing claims the press", () => {
    register(() => false, BackPriority.Overlay)
    expect(runBackChain()).toBe(false)
  })

  it("reports unhandled when the chain is empty", () => {
    expect(runBackChain()).toBe(false)
  })
})

describe("runBackChain — same priority", () => {
  it("runs the most recently registered first", () => {
    //two stacked drawers register at the same band; the TOP one — mounted last —
    //must close first, or back closes the drawer underneath
    const order: string[] = []
    register(() => {
      order.push("first")
      return false
    }, BackPriority.Overlay)
    register(() => {
      order.push("second")
      return false
    }, BackPriority.Overlay)

    runBackChain()
    expect(order).toEqual(["second", "first"])
  })
})

describe("registerBackHandler — lifecycle", () => {
  it("unregisters, so a closed overlay stops intercepting", () => {
    const handler = vi.fn(() => true)
    const off = register(handler, BackPriority.Overlay)
    off()

    runBackChain()
    expect(handler).not.toHaveBeenCalled()
  })

  it("is safe to unregister twice", () => {
    const off = register(() => true, BackPriority.Overlay)
    off()
    expect(() => off()).not.toThrow()
  })

  it("keeps running when a handler throws", () => {
    //a crashing overlay handler must not wedge the back button for the whole app
    const lower = vi.fn(() => true)
    register(lower, BackPriority.RouterBack)
    register(() => {
      throw new Error("boom")
    }, BackPriority.Overlay)

    expect(() => runBackChain()).not.toThrow()
    expect(lower).toHaveBeenCalledOnce()
  })

  it("does not let a handler registered mid-run affect this pass", () => {
    //otherwise a handler that opens a new overlay could be re-entered by the same
    //press, or the iteration could skip an entry
    const added = vi.fn(() => true)
    register(() => {
      register(added, BackPriority.Overlay)
      return false
    }, BackPriority.Overlay)

    runBackChain()
    expect(added).not.toHaveBeenCalled()
  })
})

describe("BackPriority bands", () => {
  it("orders overlays above transient UI above router back above exit", () => {
    expect(BackPriority.Overlay).toBeGreaterThan(BackPriority.Transient)
    expect(BackPriority.Transient).toBeGreaterThan(BackPriority.RouterBack)
    expect(BackPriority.RouterBack).toBeGreaterThan(BackPriority.ExitApp)
  })
})
