import { act, cleanup, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  __resetKeyboardHeightCacheForTests,
  recordKeyboardHeight,
} from "#adaptv/capabilities/keyboard-height-cache"
import {
  isSuppressibleKeyboardShrink,
  useKeyboard,
  willOpenVirtualKeyboard,
} from "#adaptv/hooks/use-keyboard"

//A controllable stand-in for the Capacitor keyboard bridge: `enabled` picks which branch of the
//observer runs (off by default, so the web suites below are untouched) and `emit` plays the OS's
//will-show/will-hide reports. Hoisted so the mock factory can close over it.
const nativeBridge = vi.hoisted(() => {
  const listeners = new Set<
    (info: { isOpen: boolean; height: number }) => void
  >()
  return {
    enabled: false,
    listeners,
    emit(info: { isOpen: boolean; height: number }) {
      for (const listener of [...listeners]) listener(info)
    },
  }
})

vi.mock("#adaptv/capabilities/keyboard", () => ({
  hasNativeKeyboard: () => nativeBridge.enabled,
  initNativeKeyboard: () => {},
  subscribeNativeKeyboard: (
    cb: (info: { isOpen: boolean; height: number }) => void,
  ) => {
    nativeBridge.listeners.add(cb)
    return () => nativeBridge.listeners.delete(cb)
  },
}))

const INNER_HEIGHT = 800
const DEBOUNCE_MS = 50
const DISMISS_CONFIRM_MS = 150
const HEIGHT_CONFIRM_MS = 120
const PREDICT_CONFIRM_MS = 400

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
    __resetKeyboardHeightCacheForTests()
    localStorage.clear()
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

  /* ---------------------------------------------------------------------------
   * predictive path (predictFromCache) — the lift starts on the focus frame,
   * before visualViewport reports, then the real measurement confirms/corrects
   * ------------------------------------------------------------------------- */
  describe("prediction", () => {
    it("seeds the height from the cache the moment a field is focused", () => {
      recordKeyboardHeight(input, 340) //a prior open of this field shape

      const { result } = renderHook(() =>
        useKeyboard({ predictFromCache: true }),
      )
      focusInput() //no viewport change yet — the keyboard has not begun to slide

      expect(result.current).toEqual({ isOpen: true, height: 340 })
    })

    it("does not predict without a cache hit (cold start falls back to reactive)", () => {
      const { result } = renderHook(() =>
        useKeyboard({ predictFromCache: true }),
      )
      focusInput()
      expect(result.current).toEqual({ isOpen: false, height: 0 })

      //the reactive path still works underneath the (absent) prediction
      openKeyboard(340)
      expect(result.current).toEqual({ isOpen: true, height: 340 })
    })

    it("does not predict for a read-only field", () => {
      input.readOnly = true
      recordKeyboardHeight(input, 340)

      const { result } = renderHook(() =>
        useKeyboard({ predictFromCache: true }),
      )
      focusInput()

      expect(result.current).toEqual({ isOpen: false, height: 0 })
    })

    it("corrects a low guess upward the instant the real height arrives", () => {
      recordKeyboardHeight(input, 320)
      const { result } = renderHook(() =>
        useKeyboard({ predictFromCache: true }),
      )

      focusInput()
      expect(result.current.height).toBe(320) //predicted

      setKeyboardHeight(380) //real keyboard, taller than the guess
      advance(DEBOUNCE_MS + 10) //grow commits immediately, no stability wait

      expect(result.current).toEqual({ isOpen: true, height: 380 })
    })

    it("corrects a high guess downward once the real height holds", () => {
      recordKeyboardHeight(input, 380)
      const { result } = renderHook(() =>
        useKeyboard({ predictFromCache: true }),
      )

      focusInput()
      expect(result.current.height).toBe(380) //predicted

      setKeyboardHeight(340) //real keyboard, shorter than the guess
      advance(DEBOUNCE_MS + 10)
      expect(result.current.height).toBe(380) //still inside the stability window

      advance(HEIGHT_CONFIRM_MS + 10)
      expect(result.current).toEqual({ isOpen: true, height: 340 })
    })

    it("retracts a prediction that no keyboard ever confirms", () => {
      recordKeyboardHeight(input, 340)
      const { result } = renderHook(() =>
        useKeyboard({ predictFromCache: true }),
      )

      focusInput() //seeds open, but this is a hardware keyboard — nothing slides in
      expect(result.current.isOpen).toBe(true)

      advance(PREDICT_CONFIRM_MS + 20)
      expect(result.current).toEqual({ isOpen: false, height: 0 })
    })

    it("does not retract when the keyboard confirmed mid-window", () => {
      recordKeyboardHeight(input, 340)
      const { result } = renderHook(() =>
        useKeyboard({ predictFromCache: true }),
      )

      focusInput()
      setKeyboardHeight(340) //keyboard actually slid in, matching the guess
      advance(DEBOUNCE_MS + 10)
      advance(PREDICT_CONFIRM_MS + 20) //past the retract window — must stay open

      expect(result.current).toEqual({ isOpen: true, height: 340 })
    })

    it("learns the height on a real open so the next focus can predict it", () => {
      const { result } = renderHook(() =>
        useKeyboard({ predictFromCache: true }),
      )

      //first open is reactive (cold cache) and records the measured height
      openKeyboard(360)
      expect(result.current).toEqual({ isOpen: true, height: 360 })
      blurInput()
      advance(20)
      expect(result.current.isOpen).toBe(false)

      //second focus now has a warm cache — it seeds before any viewport change
      focusInput()
      expect(result.current).toEqual({ isOpen: true, height: 360 })
    })
  })
})

/*
 * The native keyboard's height is treated as exact — except iOS toggles a ~45px password AutoFill
 * accessory bar on and off while the field stays focused. A small shrink is HELD, not committed, so
 * the sheet doesn't bounce; a grow, a large shrink or a dismiss all commit. Numbers are the
 * device-measured 346 (keyboard + bar) / 301 (bar hidden), threshold 60.
 */
describe("isSuppressibleKeyboardShrink", () => {
  const THRESHOLD = 60

  it("holds the ~45px accessory-bar shrink (346 → 301) while open", () => {
    expect(
      isSuppressibleKeyboardShrink(
        true,
        346,
        { isOpen: true, height: 301 },
        THRESHOLD,
      ),
    ).toBe(true)
  })

  it("commits a GROW — the bar re-appearing lifts the sheet", () => {
    expect(
      isSuppressibleKeyboardShrink(
        true,
        301,
        { isOpen: true, height: 346 },
        THRESHOLD,
      ),
    ).toBe(false)
  })

  it("commits a LARGE shrink — a genuinely shorter keyboard, not the bar", () => {
    expect(
      isSuppressibleKeyboardShrink(
        true,
        346,
        { isOpen: true, height: 200 },
        THRESHOLD,
      ),
    ).toBe(false)
  })

  it("commits a dismiss (height 0) even though it is a shrink", () => {
    expect(
      isSuppressibleKeyboardShrink(
        true,
        346,
        { isOpen: false, height: 0 },
        THRESHOLD,
      ),
    ).toBe(false)
  })

  it("never holds when the keyboard was not already open (the raise)", () => {
    expect(
      isSuppressibleKeyboardShrink(
        false,
        0,
        { isOpen: true, height: 301 },
        THRESHOLD,
      ),
    ).toBe(false)
  })
})

/* =============================================================================
 * useKeyboard — the NATIVE path
 *
 * The bridge reports an exact height, but it reports it in STEPS: `keyboardWillShow` carries the
 * bare keyboard and, on a login form, iOS follows it ~250ms later with the ~45px AutoFill bar as a
 * second, taller report. Untreated that is two lifts — the sheet lands, then steps again. Seeding
 * the settled height from the learned cache on the focus frame collapses both into one motion.
 * Numbers are the device-measured 346 (keyboard + bar) / 301 (bar hidden).
 * ============================================================================= */

describe("useKeyboard — native", () => {
  const SHRINK_HOLD_MS = 350
  let field: HTMLInputElement

  function focusField() {
    act(() => {
      field.focus()
      field.dispatchEvent(new FocusEvent("focusin", { bubbles: true }))
    })
  }

  function emit(info: { isOpen: boolean; height: number }) {
    act(() => {
      nativeBridge.emit(info)
    })
  }

  function advance(ms: number) {
    act(() => {
      vi.advanceTimersByTime(ms)
    })
  }

  function renderNative() {
    return renderHook(() =>
      useKeyboard({ isEnabled: true, predictFromCache: true }),
    )
  }

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
    nativeBridge.enabled = true
    nativeBridge.listeners.clear()
    Object.defineProperty(window, "innerWidth", {
      value: 390,
      configurable: true,
      writable: true,
    })
    //the sign-in surface's first field: [autocomplete=email], so it keys with the AutoFill bar
    field = document.createElement("input")
    field.type = "email"
    field.setAttribute("autocomplete", "email")
    document.body.appendChild(field)
  })

  afterEach(() => {
    cleanup()
    field.remove()
    nativeBridge.enabled = false
    nativeBridge.listeners.clear()
    vi.useRealTimers()
    __resetKeyboardHeightCacheForTests()
    localStorage.clear()
  })

  it("learns the settled height from the OS reports", () => {
    const { result, unmount } = renderNative()

    focusField()
    expect(result.current).toEqual({ isOpen: false, height: 0 }) //cold cache: no guess
    emit({ isOpen: true, height: 301 })
    emit({ isOpen: true, height: 346 }) //the AutoFill bar's second step
    expect(result.current).toEqual({ isOpen: true, height: 346 })

    //the learned height survives the drawer closing, so the NEXT open can predict it
    emit({ isOpen: false, height: 0 })
    unmount()

    const second = renderNative()
    second.result.current //settle the render
    act(() => {
      field.focus()
      field.dispatchEvent(new FocusEvent("focusin", { bubbles: true }))
    })
    expect(second.result.current).toEqual({ isOpen: true, height: 346 })
  })

  it("collapses the two-step raise into ONE committed height once warm", () => {
    recordKeyboardHeight(field, 346)
    const { result } = renderNative()

    //the lift starts on the focus frame, already aimed at the settled height
    focusField()
    expect(result.current).toEqual({ isOpen: true, height: 346 })

    //the bare keyboard arrives 45px SHORTER than the guess — held, not committed, so the sheet
    //never drops back down between the two steps
    emit({ isOpen: true, height: 301 })
    expect(result.current).toEqual({ isOpen: true, height: 346 })

    //the AutoFill step lands on the height already committed: nothing left to animate
    advance(250)
    emit({ isOpen: true, height: 346 })
    advance(SHRINK_HOLD_MS + 50)
    expect(result.current).toEqual({ isOpen: true, height: 346 })
  })

  it("retracts a prediction the OS never confirms (hardware keyboard)", () => {
    recordKeyboardHeight(field, 346)
    const { result } = renderNative()

    focusField()
    expect(result.current).toEqual({ isOpen: true, height: 346 })

    //no will-show ever arrives — a Magic Keyboard is attached, or the focus was programmatic
    advance(PREDICT_CONFIRM_MS + 20)
    expect(result.current).toEqual({ isOpen: false, height: 0 })
  })

  it("does not retract when a real report arrived but is being HELD", () => {
    recordKeyboardHeight(field, 346)
    const { result } = renderNative()

    focusField()
    //the bare keyboard is a small shrink against the guess, so it commits nothing yet — the
    //retract must still be cancelled, or it would close a keyboard that is genuinely on screen
    emit({ isOpen: true, height: 301 })
    advance(PREDICT_CONFIRM_MS + 20)
    expect(result.current.isOpen).toBe(true)
  })

  it("honours a prediction that was too tall — the bar genuinely did not appear", () => {
    recordKeyboardHeight(field, 346)
    const { result } = renderNative()

    focusField()
    emit({ isOpen: true, height: 301 })
    //held for a beat in case it is the bar flickering, then committed: never stuck too tall
    advance(SHRINK_HOLD_MS + 20)
    expect(result.current).toEqual({ isOpen: true, height: 301 })
  })

  it("commits a dismiss straight through", () => {
    recordKeyboardHeight(field, 346)
    const { result } = renderNative()

    focusField()
    emit({ isOpen: true, height: 346 })
    emit({ isOpen: false, height: 0 })
    expect(result.current).toEqual({ isOpen: false, height: 0 })
  })

  it("never predicts for a field that raises no keyboard", () => {
    const readOnly = document.createElement("input")
    readOnly.type = "email"
    readOnly.setAttribute("autocomplete", "email")
    readOnly.readOnly = true
    document.body.appendChild(readOnly)
    recordKeyboardHeight(field, 346)

    const { result } = renderNative()
    act(() => {
      readOnly.focus()
      readOnly.dispatchEvent(new FocusEvent("focusin", { bubbles: true }))
    })
    expect(result.current).toEqual({ isOpen: false, height: 0 })
    readOnly.remove()
  })
})
