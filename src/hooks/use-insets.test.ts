import { act, renderHook } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { readSafeAreaInsets, useInsets } from "#adaptv/hooks/use-insets"

const SIDES = ["top", "right", "bottom", "left"] as const

function setInsets(
  values: Partial<Record<(typeof SIDES)[number], string>>,
) {
  for (const side of SIDES) {
    const value = values[side]
    if (value === undefined) {
      document.documentElement.style.removeProperty(
        `--adaptv-inset-${side}`,
      )
    } else {
      document.documentElement.style.setProperty(
        `--adaptv-inset-${side}`,
        value,
      )
    }
  }
}

afterEach(() => {
  setInsets({})
})

describe("readSafeAreaInsets", () => {
  it("returns zeros when the contract vars are absent", () => {
    expect(readSafeAreaInsets()).toEqual({
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
    })
  })

  //THE reason for the probe: what a custom property's computed value serialises to for a
  //`var()`/`env()` chain is engine-dependent, so `getPropertyValue` may hand back the
  //literal `var(...)` text and `parseFloat` it to NaN. Measured: happy-dom does exactly
  //that for the real contract chain, Chrome substitutes. Feeding the value to a real
  //property is the only read whose result is an absolute length by definition — which is
  //what this asserts, on the indirection this environment can resolve.
  it("resolves a var chain rather than reading the property back raw", () => {
    document.documentElement.style.setProperty(
      "--adaptv-inset-top",
      "var(--probe-source, 21px)",
    )
    expect(readSafeAreaInsets().top).toBe(21)
  })

  //Four longhands, not the `padding:` shorthand: a shorthand is ONE declaration, so a
  //single unresolvable var invalidates it and zeroes all four edges at once.
  it("keeps each edge independent when only some vars are defined", () => {
    setInsets({ bottom: "34px" })
    expect(readSafeAreaInsets()).toEqual({
      top: 0,
      right: 0,
      bottom: 34,
      left: 0,
    })
  })

  it("reads each edge from its own contract var", () => {
    setInsets({
      top: "47px",
      right: "3px",
      bottom: "34px",
      left: "5px",
    })
    expect(readSafeAreaInsets()).toEqual({
      top: 47,
      right: 3,
      bottom: 34,
      left: 5,
    })
  })

  it("leaves no probe behind", () => {
    const before = document.documentElement.childElementCount
    readSafeAreaInsets()
    expect(document.documentElement.childElementCount).toBe(before)
  })
})

describe("useInsets", () => {
  it("measures after mount", () => {
    setInsets({ top: "47px", bottom: "34px" })
    const { result } = renderHook(() => useInsets())
    expect(result.current).toEqual({
      top: 47,
      right: 0,
      bottom: 34,
      left: 0,
    })
  })

  it("re-measures on orientationchange", () => {
    setInsets({ top: "47px" })
    const { result } = renderHook(() => useInsets())
    expect(result.current.top).toBe(47)

    act(() => {
      setInsets({ top: "0px", left: "47px" })
      window.dispatchEvent(new Event("orientationchange"))
    })

    expect(result.current).toMatchObject({ top: 0, left: 47 })
  })

  //happy-dom ships no `visualViewport`, so what runs here is the `window` resize
  //fallback — the same handler, the other subscription branch. The visualViewport
  //branch exists so a browser does not get the event twice (window resize fires
  //alongside it); only one of the two is ever subscribed.
  it("re-measures on a viewport resize", () => {
    const target: EventTarget = window.visualViewport ?? window
    const { result } = renderHook(() => useInsets())
    act(() => {
      setInsets({ bottom: "34px" })
      target.dispatchEvent(new Event("resize"))
    })
    expect(result.current.bottom).toBe(34)
  })

  //Capacitor's SystemBars writes `--safe-area-inset-*` straight onto <html> with NO
  //event, so the observer is the only thing that catches the case the whole contract
  //exists for (Android WebView < 140, crbug/40699457).
  it("re-measures when the root's style attribute mutates with no event", async () => {
    const { result } = renderHook(() => useInsets())
    expect(result.current.bottom).toBe(0)

    await act(async () => {
      setInsets({ bottom: "24px" })
      //MutationObserver callbacks are delivered as a microtask
      await Promise.resolve()
    })

    expect(result.current.bottom).toBe(24)
  })

  //Identity, not render count: React may still re-render once before bailing out of a
  //state update that returns the same value, so the count is not a stable guarantee.
  //A stable object reference is — and it is what keeps this out of a consumer's
  //`useEffect` / `useMemo` dependency arrays as a re-run trigger.
  it("returns a stable object when the measurement is unchanged", () => {
    setInsets({ bottom: "34px" })
    const { result } = renderHook(() => useInsets())
    const first = result.current

    act(() => {
      window.dispatchEvent(new Event("orientationchange"))
    })

    expect(result.current).toBe(first)
    expect(result.current.bottom).toBe(34)
  })

  it("tears every subscription down on unmount", () => {
    const removeListener = vi.spyOn(window, "removeEventListener")
    const { unmount } = renderHook(() => useInsets())
    unmount()
    expect(removeListener).toHaveBeenCalledWith(
      "orientationchange",
      expect.any(Function),
    )
    removeListener.mockRestore()
  })
})
