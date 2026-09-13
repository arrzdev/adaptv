import { act, renderHook } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { ChromeTintOptions } from "#adaptv/capabilities/theme-color"
import {
  getChromeTint,
  restoreChromeTint,
  setChromeTint,
  subscribeChromeTintBase,
  transitionChromeTint,
} from "#adaptv/capabilities/theme-color"
import { useChromeTint } from "#adaptv/hooks/use-chrome-tint"

const store = vi.hoisted(() => ({
  base: null as string | null,
  listeners: new Set<() => void>(),
}))

const RESOLVED = vi.hoisted(() => ({
  finished: Promise.resolve(),
  stop: () => {},
}))

vi.mock("#adaptv/capabilities/theme-color", () => ({
  getChromeTint: vi.fn(() => "#101010"),
  getChromeTintBase: () => store.base,
  subscribeChromeTintBase: vi.fn((listener: () => void) => {
    store.listeners.add(listener)
    return () => {
      store.listeners.delete(listener)
    }
  }),
  setChromeTint: vi.fn(),
  transitionChromeTint: vi.fn(() => RESOLVED),
  restoreChromeTint: vi.fn(() => RESOLVED),
}))

function setBase(color: string | null): void {
  act(() => {
    store.base = color
    for (const listener of store.listeners) listener()
  })
}

afterEach(() => {
  store.base = null
  store.listeners.clear()
  vi.clearAllMocks()
})

describe("useChromeTint", () => {
  it("follows the base, and unsubscribes on unmount", () => {
    const { result, unmount } = renderHook(() => useChromeTint())
    expect(result.current.supported).toBe(false)
    expect(result.current.base).toBeNull()

    setBase("#ffffff")
    expect(result.current.supported).toBe(true)
    expect(result.current.base).toBe("#ffffff")

    //a theme flip is a new VALUE, so a component showing it re-renders
    setBase("#000000")
    expect(result.current.base).toBe("#000000")

    expect(subscribeChromeTintBase).toHaveBeenCalled()
    unmount()
    expect(store.listeners.size).toBe(0)
  })

  it("passes each call straight through to the capability", () => {
    const { result } = renderHook(() => useChromeTint())
    const options: ChromeTintOptions = {
      duration: 0.38,
      easing: [0.32, 0.72, 0, 1],
    }

    expect(result.current.transitionTo("#8f8f8e", options)).toBe(RESOLVED)
    expect(transitionChromeTint).toHaveBeenCalledWith("#8f8f8e", options)

    result.current.set("#222222")
    expect(setChromeTint).toHaveBeenCalledWith("#222222")

    expect(result.current.restore({ duration: 0.22 })).toBe(RESOLVED)
    expect(restoreChromeTint).toHaveBeenCalledWith({ duration: 0.22 })

    //a sample, not state — the capability's own reader, not a snapshot
    expect(result.current.read).toBe(getChromeTint)
  })

  it("puts the tint back instantly when unmounted while holding it, and only then", () => {
    const holding = renderHook(() => useChromeTint())
    holding.result.current.transitionTo("#8f8f8e")
    holding.unmount()
    expect(restoreChromeTint).toHaveBeenCalledWith({ duration: 0 })

    vi.mocked(restoreChromeTint).mockClear()
    const following = renderHook(() => useChromeTint())
    following.result.current.set("#8f8f8e")
    following.result.current.restore()
    vi.mocked(restoreChromeTint).mockClear()
    following.unmount()
    //it already gave the chrome back — a second restore would yank a tint
    //another component has since taken
    expect(restoreChromeTint).not.toHaveBeenCalled()

    const bystander = renderHook(() => useChromeTint())
    bystander.unmount()
    expect(restoreChromeTint).not.toHaveBeenCalled()
  })
})
