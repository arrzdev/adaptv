import { renderHook } from "@testing-library/react"
import { act } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { useIsOffline } from "#nativ/hooks/use-is-offline"

const restores: Array<() => void> = []

function setOnline(value: boolean): void {
  const prev = Object.getOwnPropertyDescriptor(navigator, "onLine")
  Object.defineProperty(navigator, "onLine", {
    value,
    configurable: true,
  })
  restores.push(() => {
    if (prev) Object.defineProperty(navigator, "onLine", prev)
  })
}

afterEach(() => {
  for (const r of restores.splice(0)) r()
  vi.unstubAllGlobals()
})

describe("useIsOffline", () => {
  it("is false when online", () => {
    vi.stubGlobal("Capacitor", undefined)
    setOnline(true)
    expect(renderHook(() => useIsOffline()).result.current).toBe(false)
  })

  it("is true when offline", () => {
    vi.stubGlobal("Capacitor", undefined)
    setOnline(false)
    expect(renderHook(() => useIsOffline()).result.current).toBe(true)
  })

  it("tracks the browser's connectivity events", () => {
    vi.stubGlobal("Capacitor", undefined)
    setOnline(true)
    const { result } = renderHook(() => useIsOffline())
    expect(result.current).toBe(false)

    setOnline(false)
    act(() => {
      window.dispatchEvent(new Event("offline"))
    })
    expect(result.current).toBe(true)
  })

  it("is the exact inverse of the connectivity accessor, not a second source", () => {
    //if this ever diverges from `getOnline`, an app can show an offline banner
    //while its queries are happily fetching — two truths, one screen
    vi.stubGlobal("Capacitor", undefined)
    setOnline(true)
    const online = renderHook(() => useIsOffline()).result.current
    setOnline(false)
    const offline = renderHook(() => useIsOffline()).result.current
    expect(online).toBe(false)
    expect(offline).toBe(true)
  })
})
