import { renderHook } from "@testing-library/react"
import { act } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  useAppState,
  useOnPause,
  useOnResume,
} from "#adaptv/hooks/use-app-state"

/*
 * The web half of the accessor is what these exercise: `visibilitychange` on a
 * stubbed `document.visibilityState`. The native half is Capacitor's `resume` /
 * `pause`, covered where the accessor itself is tested — a hook test that stubbed
 * the plugin would only be asserting the mock.
 */

const restores: Array<() => void> = []

function setVisibility(state: "visible" | "hidden"): void {
  const prev = Object.getOwnPropertyDescriptor(document, "visibilityState")
  Object.defineProperty(document, "visibilityState", {
    value: state,
    configurable: true,
  })
  restores.push(() => {
    if (prev) Object.defineProperty(document, "visibilityState", prev)
  })
}

/** Move the page and let the accessor's listener run. */
function changeVisibility(state: "visible" | "hidden"): void {
  setVisibility(state)
  act(() => {
    document.dispatchEvent(new Event("visibilitychange"))
  })
}

afterEach(() => {
  for (const restore of restores.splice(0)) restore()
  vi.unstubAllGlobals()
  changeVisibility("visible")
})

describe("useAppState", () => {
  it("reports the foreground state, and tracks it", () => {
    vi.stubGlobal("Capacitor", undefined)
    setVisibility("visible")
    const { result } = renderHook(() => useAppState())
    expect(result.current).toBe("active")

    changeVisibility("hidden")
    expect(result.current).toBe("background")

    changeVisibility("visible")
    expect(result.current).toBe("active")
  })
})

describe("useOnResume / useOnPause", () => {
  it("fire on the edge, not on every event while already there", () => {
    //the reason this exists at all: a token refresh on resume must run once per
    //resume, not once per notification the OS happens to deliver
    vi.stubGlobal("Capacitor", undefined)
    setVisibility("visible")
    const onResume = vi.fn()
    const onPause = vi.fn()
    renderHook(() => {
      useOnResume(onResume)
      useOnPause(onPause)
    })

    changeVisibility("hidden")
    expect(onPause).toHaveBeenCalledTimes(1)
    changeVisibility("hidden")
    expect(onPause).toHaveBeenCalledTimes(1)

    changeVisibility("visible")
    expect(onResume).toHaveBeenCalledTimes(1)
  })

  it("calls the LATEST callback without re-subscribing", () => {
    //the callback is held in a ref precisely so an inline arrow — which every
    //caller writes — does not tear down and rebuild the subscription each render
    vi.stubGlobal("Capacitor", undefined)
    setVisibility("visible")
    const first = vi.fn()
    const second = vi.fn()
    const { rerender } = renderHook(
      ({ callback }: { callback: () => void }) => useOnPause(callback),
      { initialProps: { callback: first } },
    )

    rerender({ callback: second })
    changeVisibility("hidden")
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(1)
  })

  it("stops listening once the component unmounts", () => {
    vi.stubGlobal("Capacitor", undefined)
    setVisibility("visible")
    const onPause = vi.fn()
    const { unmount } = renderHook(() => useOnPause(onPause))

    unmount()
    changeVisibility("hidden")
    expect(onPause).not.toHaveBeenCalled()
  })
})
