import { act, renderHook } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { useLayoutViewportShrink } from "#adaptv/hooks/use-layout-viewport-shrink"

const restHeight = window.innerHeight

function setInnerHeight(height: number) {
  Object.defineProperty(window, "innerHeight", {
    configurable: true,
    value: height,
  })
  window.dispatchEvent(new Event("resize"))
}

afterEach(() => {
  setInnerHeight(restHeight)
})

describe("useLayoutViewportShrink", () => {
  it("reads 0 while inactive, whatever the viewport's height", () => {
    setInnerHeight(587)
    const { result } = renderHook(() => useLayoutViewportShrink(false))
    expect(result.current).toBe(0)
  })

  it("follows a resize that lands after activation, and never goes negative", () => {
    setInnerHeight(923)
    const { result, rerender } = renderHook(
      ({ active }) => useLayoutViewportShrink(active),
      { initialProps: { active: false } },
    )
    rerender({ active: true })
    expect(result.current).toBe(0)

    act(() => setInnerHeight(587))
    expect(result.current).toBe(336)

    act(() => setInnerHeight(1000))
    expect(result.current).toBe(0)
  })

  it("re-reads the rest height while inactive so a rotation is not a keyboard", () => {
    setInnerHeight(923)
    const { result, rerender } = renderHook(
      ({ active }) => useLayoutViewportShrink(active),
      { initialProps: { active: false } },
    )
    act(() => setInnerHeight(402))
    rerender({ active: true })
    expect(result.current).toBe(0)
  })
})
