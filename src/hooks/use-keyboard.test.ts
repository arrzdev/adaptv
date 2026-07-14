import { act, cleanup, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  useKeyboard,
  willOpenVirtualKeyboard,
} from "#nativ/hooks/use-keyboard"

const INNER_HEIGHT = 800
const DEBOUNCE_MS = 50
const DISMISS_CONFIRM_MS = 150
const HEIGHT_CONFIRM_MS = 120

/* =============================================================================
 * willOpenVirtualKeyboard
 * ============================================================================= */

describe("willOpenVirtualKeyboard", () => {
  it("matches text inputs and textareas", () => {
    expect(willOpenVirtualKeyboard(document.createElement("input"))).toBe(
      true,
    )
    expect(
      willOpenVirtualKeyboard(document.createElement("textarea")),
    ).toBe(true)
  })

  it("rejects non-text inputs and plain elements", () => {
    const checkbox = document.createElement("input")
    checkbox.type = "checkbox"
    expect(willOpenVirtualKeyboard(checkbox)).toBe(false)
    expect(willOpenVirtualKeyboard(document.createElement("div"))).toBe(
      false,
    )
  })
})

/* =============================================================================
 * useKeyboard — observer state machine against a mocked visualViewport
 * ============================================================================= */

type ViewportMock = {
  height: number
  offsetTop: number
  addEventListener: (type: string, listener: EventListener) => void
  removeEventListener: (type: string, listener: EventListener) => void
}

describe("useKeyboard", () => {
  let input: HTMLInputElement
  let viewport: ViewportMock
  let resizeListeners: EventListener[]

  function fireResize() {
    for (const listener of resizeListeners) {
      listener(new Event("resize"))
    }
  }

  /** Shrink/restore the mocked viewport as an iOS keyboard would, firing `resize`. */
  function setKeyboardHeight(height: number) {
    viewport.height = INNER_HEIGHT - height
    act(() => {
      fireResize()
    })
  }

  function focusInput() {
    act(() => {
      input.focus()
      input.dispatchEvent(new FocusEvent("focusin", { bubbles: true }))
    })
  }

  function blurInput() {
    act(() => {
      input.blur()
      input.dispatchEvent(new FocusEvent("focusout", { bubbles: true }))
    })
  }

  function advance(ms: number) {
    act(() => {
      vi.advanceTimersByTime(ms)
    })
  }

  /** Focus + shrink + settle the debounce: the canonical "keyboard opened" sequence. */
  function openKeyboard(height: number) {
    focusInput()
    setKeyboardHeight(height)
    advance(DEBOUNCE_MS + 10)
  }

  beforeEach(() => {
    vi.useFakeTimers({
      toFake: [
        "setTimeout",
        "clearTimeout",
        "requestAnimationFrame",
        "cancelAnimationFrame",
      ],
    })

    resizeListeners = []
    viewport = {
      height: INNER_HEIGHT,
      offsetTop: 0,
      addEventListener: (type, listener) => {
        if (type === "resize") resizeListeners.push(listener)
      },
      removeEventListener: (type, listener) => {
        if (type === "resize") {
          resizeListeners = resizeListeners.filter((l) => l !== listener)
        }
      },
    }

    Object.defineProperty(window, "innerHeight", {
      value: INNER_HEIGHT,
      configurable: true,
      writable: true,
    })
    Object.defineProperty(window, "visualViewport", {
      value: viewport,
      configurable: true,
      writable: true,
    })

    input = document.createElement("input")
    input.type = "text"
    document.body.appendChild(input)
  })

  afterEach(() => {
    cleanup()
    input.remove()
    vi.useRealTimers()
    Object.defineProperty(window, "visualViewport", {
      value: undefined,
      configurable: true,
      writable: true,
    })
  })

  it("reports open with the live height once the viewport shrinks past the threshold", () => {
    const { result } = renderHook(() => useKeyboard())

    openKeyboard(340)

    expect(result.current).toEqual({ isOpen: true, height: 340 })
  })

  it("ignores sub-threshold viewport deltas (browser chrome, not a keyboard)", () => {
    const { result } = renderHook(() => useKeyboard())

    openKeyboard(50)

    expect(result.current).toEqual({ isOpen: false, height: 0 })
  })

  it("closes immediately when the field blurs", () => {
    const { result } = renderHook(() => useKeyboard())
    openKeyboard(340)

    blurInput()
    advance(20) //the focusout handler defers one animation frame

    expect(result.current.isOpen).toBe(false)
  })

  //iOS password autofill fills the fields and dismisses the keyboard WITHOUT blurring —
  //the observer must still report closed (via the dismiss confirmation)
  it("closes after the dismiss confirmation when the keyboard vanishes without a blur", () => {
    const { result } = renderHook(() => useKeyboard())
    openKeyboard(340)

    setKeyboardHeight(0)
    //the zero fast-path arms the confirmation on the resize event itself
    advance(DISMISS_CONFIRM_MS - 20)
    expect(result.current.isOpen).toBe(true) //still inside the window

    advance(40)
    expect(result.current).toEqual({ isOpen: false, height: 0 })
  })

  it("keeps the keyboard open when a zero read recovers within the dismiss window", () => {
    const { result } = renderHook(() => useKeyboard())
    openKeyboard(340)

    setKeyboardHeight(0)
    advance(60) //confirmation armed, not yet fired
    setKeyboardHeight(340) //transient zero recovered
    advance(DISMISS_CONFIRM_MS + 60)

    expect(result.current).toEqual({ isOpen: true, height: 340 })
  })

  //a raise's first read can catch the keyboard mid-slide (under-reported height); the
  //upward correction must not wait out the stability window
  it("commits a grown height immediately", () => {
    const { result } = renderHook(() => useKeyboard())
    openKeyboard(335)

    setKeyboardHeight(380)
    advance(DEBOUNCE_MS + 10) //only the resize debounce, no stability confirm

    expect(result.current).toEqual({ isOpen: true, height: 380 })
  })

  it("commits a dropped height only after it holds", () => {
    const { result } = renderHook(() => useKeyboard())
    openKeyboard(380)

    setKeyboardHeight(340)
    advance(DEBOUNCE_MS + 10)
    expect(result.current.height).toBe(380) //inside the stability window

    advance(HEIGHT_CONFIRM_MS + 10)
    expect(result.current).toEqual({ isOpen: true, height: 340 })
  })

  //device-measured iOS behavior: switching fields emits transient dips (380 → 335 → 380
  //within ~85ms) that must not re-aim consumers twice per switch
  it("ignores a transient dip that returns to the committed height", () => {
    const { result } = renderHook(() => useKeyboard())
    openKeyboard(380)
    const seen: number[] = [result.current.height]

    setKeyboardHeight(335)
    advance(DEBOUNCE_MS + 10)
    seen.push(result.current.height)

    setKeyboardHeight(380) //dip recovers before the stability window elapses
    advance(HEIGHT_CONFIRM_MS + DEBOUNCE_MS + 20)
    seen.push(result.current.height)

    //the committed height never left 380 — no dip, no bounce
    expect(seen).toEqual([380, 380, 380])
  })

  it("resets to closed when disabled", () => {
    const { result, rerender } = renderHook(
      ({ isEnabled }: { isEnabled: boolean }) =>
        useKeyboard({ isEnabled }),
      { initialProps: { isEnabled: true } },
    )
    openKeyboard(340)
    expect(result.current.isOpen).toBe(true)

    rerender({ isEnabled: false })

    expect(result.current).toEqual({ isOpen: false, height: 0 })
  })
})
