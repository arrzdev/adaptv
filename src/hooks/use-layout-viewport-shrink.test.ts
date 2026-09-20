import { act, renderHook } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { useLayoutViewportShrink } from "#adaptv/hooks/use-layout-viewport-shrink"

const restHeight = window.innerHeight
const restWidth = window.innerWidth

function setInnerHeight(height: number) {
  Object.defineProperty(window, "innerHeight", {
    configurable: true,
    value: height,
  })
  window.dispatchEvent(new Event("resize"))
}

function setInnerWidth(width: number) {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: width,
  })
}

/** A text field holding focus, the way one does from the tap until the keyboard is up. */
function focusTextField() {
  const field = document.createElement("input")
  document.body.append(field)
  field.focus()
  return field
}

afterEach(() => {
  document.body.replaceChildren()
  setInnerWidth(restWidth)
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

  it("does not take the keyboard's own raise as a rest height (Android Chrome: 783 → 1095 → 783)", () => {
    setInnerHeight(783)
    const { result, rerender } = renderHook(
      ({ active }) => useLayoutViewportShrink(active),
      { initialProps: { active: false } },
    )
    focusTextField()
    //Chrome reports rest PLUS the keyboard for a frame of the raise, before useKeyboard opens
    act(() => setInnerHeight(1095))
    rerender({ active: true })
    expect(result.current).toBe(0)

    //the viewport is back at rest with the keyboard still up: no shrink, the room is still owed
    act(() => setInnerHeight(783))
    expect(result.current).toBe(0)
  })

  it("still measures the Android WebView's shrink under focus — that resize lands after activation", () => {
    setInnerHeight(923)
    const { result, rerender } = renderHook(
      ({ active }) => useLayoutViewportShrink(active),
      { initialProps: { active: false } },
    )
    focusTextField()
    //the IME inset lands before the plugin reports open: still not a rest, still the shrink
    act(() => setInnerHeight(587))
    rerender({ active: true })
    expect(result.current).toBe(336)
  })

  it("takes the first sample even under focus, so a field that autofocuses on mount has a rest", () => {
    focusTextField()
    setInnerHeight(923)
    const { result, rerender } = renderHook(
      ({ active }) => useLayoutViewportShrink(active),
      { initialProps: { active: false } },
    )
    rerender({ active: true })
    act(() => setInnerHeight(587))
    expect(result.current).toBe(336)
  })

  it("takes a rotation under focus — a keyboard never changes the width", () => {
    setInnerWidth(412)
    setInnerHeight(923)
    const { result, rerender } = renderHook(
      ({ active }) => useLayoutViewportShrink(active),
      { initialProps: { active: false } },
    )
    focusTextField()
    act(() => {
      setInnerWidth(915)
      setInnerHeight(380)
    })
    rerender({ active: true })
    expect(result.current).toBe(0)
  })
})
