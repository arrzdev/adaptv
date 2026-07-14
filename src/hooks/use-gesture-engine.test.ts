import { act, cleanup, renderHook } from "@testing-library/react"
import type { KeyboardEvent, MouseEvent, PointerEvent } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { useGestureEngine } from "#nativ/hooks/use-gesture-engine"

/* =============================================================================
 * SYNTHETIC EVENTS — the engine only reads these fields off the events it's
 * handed, so a plain object cast to the React type is enough to drive it.
 * ============================================================================= */

type DownOpts = {
  pointerType?: string
  clientX?: number
  clientY?: number
  isPrimary?: boolean
  button?: number
}

//the engine reads geometry off currentTarget, writes the data-pressed flag to it,
//and (when a long-press is wired) attaches a non-passive touchmove guard — so the
//mock element needs an attribute store and listener stubs
function makeTarget() {
  const attrs = new Map<string, string>()
  return {
    setPointerCapture: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    getBoundingClientRect: () => ({
      left: 0,
      top: 0,
      right: 100,
      bottom: 100,
      width: 100,
      height: 100,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }),
    setAttribute: (name: string, value: string) => {
      attrs.set(name, value)
    },
    removeAttribute: (name: string) => {
      attrs.delete(name)
    },
    hasAttribute: (name: string) => attrs.has(name),
  }
}

function pointerDown(
  opts: DownOpts = {},
  target: ReturnType<typeof makeTarget> = makeTarget(),
): PointerEvent {
  return {
    button: opts.button ?? 0,
    isPrimary: opts.isPrimary ?? true,
    pointerId: 1,
    pointerType: opts.pointerType ?? "touch",
    clientX: opts.clientX ?? 0,
    clientY: opts.clientY ?? 0,
    currentTarget: target,
  } as unknown as PointerEvent
}

function pointerAt(clientX: number, clientY: number): PointerEvent {
  return {
    isPrimary: true,
    pointerId: 1,
    clientX,
    clientY,
  } as unknown as PointerEvent
}

function keyEvent(key: string): KeyboardEvent {
  return { key, repeat: false } as unknown as KeyboardEvent
}

function mockClick() {
  const preventDefault = vi.fn()
  const stopPropagation = vi.fn()
  const event = {
    preventDefault,
    stopPropagation,
  } as unknown as MouseEvent
  return { event, preventDefault, stopPropagation }
}

afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
  cleanup()
})

/* =============================================================================
 * TESTS
 * ============================================================================= */

describe("useGestureEngine", () => {
  it("fires onPressUp on a clean tap", () => {
    const onPressUp = vi.fn()
    const { result } = renderHook(() => useGestureEngine({ onPressUp }))

    act(() => result.current.onPointerDown(pointerDown()))
    act(() => result.current.onPointerUp(pointerAt(0, 0)))

    expect(onPressUp).toHaveBeenCalledTimes(1)
  })

  it("still fires the tap when a tap-only press is held past the long-press threshold", () => {
    //regression guard: a control with no long-press handler must activate on
    //release no matter how long it was held — never silently swallow the tap
    vi.useFakeTimers()
    const onPressUp = vi.fn()
    const { result } = renderHook(() => useGestureEngine({ onPressUp }))

    act(() => result.current.onPointerDown(pointerDown()))
    act(() => {
      vi.advanceTimersByTime(600)
    })
    act(() => result.current.onPointerUp(pointerAt(0, 0)))

    expect(onPressUp).toHaveBeenCalledTimes(1)
  })

  it("promotes a held press to a long-press only when a long-press handler is set", () => {
    vi.useFakeTimers()
    const onLongPressDown = vi.fn()
    const onLongPressUp = vi.fn()
    const onPressUp = vi.fn()
    const { result } = renderHook(() =>
      useGestureEngine({
        onLongPressDown,
        onLongPressUp,
        onPressUp,
        longPressThreshold: 250,
      }),
    )

    act(() => result.current.onPointerDown(pointerDown()))
    act(() => {
      vi.advanceTimersByTime(250)
    })
    expect(onLongPressDown).toHaveBeenCalledTimes(1)

    act(() => result.current.onPointerUp(pointerAt(0, 0)))
    expect(onLongPressUp).toHaveBeenCalledTimes(1)
    expect(onPressUp).not.toHaveBeenCalled()
  })

  it("activates via keyboard Enter", () => {
    const onPressUp = vi.fn()
    const { result } = renderHook(() => useGestureEngine({ onPressUp }))

    act(() => result.current.onKeyDown(keyEvent("Enter")))
    act(() => result.current.onKeyUp(keyEvent("Enter")))

    expect(onPressUp).toHaveBeenCalledTimes(1)
  })

  it("drops all interaction when disabled", () => {
    const onPressUp = vi.fn()
    const { result } = renderHook(() =>
      useGestureEngine({ onPressUp, disabled: true }),
    )

    act(() => result.current.onPointerDown(pointerDown()))
    act(() => result.current.onPointerUp(pointerAt(0, 0)))

    expect(onPressUp).not.toHaveBeenCalled()
  })

  it("cancels an in-flight press when disabled flips mid-gesture", () => {
    const onPressUp = vi.fn()
    const onStateChange = vi.fn()
    const { result, rerender } = renderHook(
      ({ disabled }) =>
        useGestureEngine({ onPressUp, onStateChange, disabled }),
      { initialProps: { disabled: false } },
    )

    act(() => result.current.onPointerDown(pointerDown()))
    act(() => rerender({ disabled: true }))

    expect(onStateChange).toHaveBeenCalledWith("cancelled")

    //a release after the disable is a no-op — no tap slips through
    act(() => result.current.onPointerUp(pointerAt(0, 0)))
    expect(onPressUp).not.toHaveBeenCalled()
  })

  describe("press region (reentrant)", () => {
    it("re-enters and still taps after the finger drags out and back in", () => {
      const onPressUp = vi.fn()
      const onStateChange = vi.fn()
      const { result } = renderHook(() =>
        useGestureEngine({ onPressUp, onStateChange }),
      )
      const target = makeTarget()

      act(() =>
        result.current.onPointerDown(
          pointerDown({ clientX: 50, clientY: 50 }, target),
        ),
      )
      expect(target.hasAttribute("data-pressed")).toBe(true)

      //drag well outside the frame — press disarms, visual drops
      act(() => result.current.onPointerMove(pointerAt(200, 200)))
      expect(onStateChange).toHaveBeenCalledWith("outside")
      expect(target.hasAttribute("data-pressed")).toBe(false)

      //slide back in — press re-arms, visual returns
      act(() => result.current.onPointerMove(pointerAt(50, 50)))
      expect(target.hasAttribute("data-pressed")).toBe(true)

      act(() => result.current.onPointerUp(pointerAt(50, 50)))
      expect(onPressUp).toHaveBeenCalledTimes(1)
    })

    it("does not tap when released outside the region", () => {
      const onPressUp = vi.fn()
      const { result } = renderHook(() => useGestureEngine({ onPressUp }))

      act(() =>
        result.current.onPointerDown(
          pointerDown({ clientX: 50, clientY: 50 }),
        ),
      )
      act(() => result.current.onPointerMove(pointerAt(200, 200)))
      act(() => result.current.onPointerUp(pointerAt(200, 200)))

      expect(onPressUp).not.toHaveBeenCalled()
    })

    it("keeps a touch press just past the frame within the roomier touch margin", () => {
      const onPressUp = vi.fn()
      const { result } = renderHook(() => useGestureEngine({ onPressUp }))

      act(() =>
        result.current.onPointerDown(
          pointerDown({ pointerType: "touch", clientX: 50, clientY: 50 }),
        ),
      )
      //108 is outside the 0–100 frame but within the touch outset (12px)
      act(() => result.current.onPointerMove(pointerAt(108, 50)))
      act(() => result.current.onPointerUp(pointerAt(108, 50)))

      expect(onPressUp).toHaveBeenCalledTimes(1)
    })

    it("drops the same press for a mouse, whose margin is tighter", () => {
      const onPressUp = vi.fn()
      const { result } = renderHook(() => useGestureEngine({ onPressUp }))

      act(() =>
        result.current.onPointerDown(
          pointerDown({ pointerType: "mouse", clientX: 50, clientY: 50 }),
        ),
      )
      //108 exceeds the mouse outset (6px) past the frame
      act(() => result.current.onPointerMove(pointerAt(108, 50)))
      act(() => result.current.onPointerUp(pointerAt(108, 50)))

      expect(onPressUp).not.toHaveBeenCalled()
    })
  })

  describe("two tracks (tap vs long-press)", () => {
    it("fails the long-press past its travel budget but still fires the tap", () => {
      vi.useFakeTimers()
      const onLongPressDown = vi.fn()
      const onLongPressUp = vi.fn()
      const onPressUp = vi.fn()
      const { result } = renderHook(() =>
        useGestureEngine({
          onLongPressDown,
          onLongPressUp,
          onPressUp,
          longPressThreshold: 250,
        }),
      )

      act(() =>
        result.current.onPointerDown(
          pointerDown({ clientX: 50, clientY: 50 }),
        ),
      )
      //15px from the anchor — past the 10px long-press budget, but still on the
      //element, so the tap track stays armed (two independent tracks)
      act(() => result.current.onPointerMove(pointerAt(50, 65)))
      act(() => {
        vi.advanceTimersByTime(250)
      })
      expect(onLongPressDown).not.toHaveBeenCalled()

      act(() => result.current.onPointerUp(pointerAt(50, 65)))
      expect(onPressUp).toHaveBeenCalledTimes(1)
      expect(onLongPressUp).not.toHaveBeenCalled()
    })

    it("forwards drag moves to onLongPressMove after the long-press fires", () => {
      vi.useFakeTimers()
      const onLongPressDown = vi.fn()
      const onLongPressMove = vi.fn()
      const { result } = renderHook(() =>
        useGestureEngine({
          onLongPressDown,
          onLongPressMove,
          longPressThreshold: 250,
        }),
      )

      act(() =>
        result.current.onPointerDown(
          pointerDown({ clientX: 50, clientY: 50 }),
        ),
      )
      act(() => {
        vi.advanceTimersByTime(250)
      })
      expect(onLongPressDown).toHaveBeenCalledTimes(1)

      act(() => result.current.onPointerMove(pointerAt(50, 80)))
      expect(onLongPressMove).toHaveBeenCalledTimes(1)
    })
  })

  describe("cancellation", () => {
    it("reports a distinct cancelled state and fires no tap on pointercancel", () => {
      const onPressUp = vi.fn()
      const onStateChange = vi.fn()
      const { result } = renderHook(() =>
        useGestureEngine({ onPressUp, onStateChange }),
      )

      act(() => result.current.onPointerDown(pointerDown()))
      act(() => result.current.onPointerCancel(pointerAt(0, 0)))

      expect(onPressUp).not.toHaveBeenCalled()
      expect(onStateChange).toHaveBeenCalledWith("cancelled")
    })

    it("treats an unexpected capture loss mid-press as a cancel", () => {
      const onPressUp = vi.fn()
      const onStateChange = vi.fn()
      const { result } = renderHook(() =>
        useGestureEngine({ onPressUp, onStateChange }),
      )

      act(() => result.current.onPointerDown(pointerDown()))
      act(() => result.current.onLostPointerCapture(pointerAt(0, 0)))

      expect(onStateChange).toHaveBeenCalledWith("cancelled")
      expect(onPressUp).not.toHaveBeenCalled()
    })

    it("ignores a capture loss that follows a normal release", () => {
      const onStateChange = vi.fn()
      const { result } = renderHook(() =>
        useGestureEngine({ onStateChange }),
      )

      act(() => result.current.onPointerDown(pointerDown()))
      act(() => result.current.onPointerUp(pointerAt(0, 0)))
      onStateChange.mockClear()
      act(() => result.current.onLostPointerCapture(pointerAt(0, 0)))

      expect(onStateChange).not.toHaveBeenCalled()
    })
  })

  describe("trailing click suppression", () => {
    it("swallows the trailing click after releasing outside the region", () => {
      const { result } = renderHook(() =>
        useGestureEngine({ onPressUp: vi.fn() }),
      )

      act(() =>
        result.current.onPointerDown(
          pointerDown({ clientX: 50, clientY: 50 }),
        ),
      )
      act(() => result.current.onPointerMove(pointerAt(200, 200)))
      act(() => result.current.onPointerUp(pointerAt(200, 200)))
      const click = mockClick()
      act(() => result.current.onClickCapture(click.event))

      expect(click.preventDefault).toHaveBeenCalled()
      expect(click.stopPropagation).toHaveBeenCalled()
    })

    it("does not swallow in capture phase after a clean tap", () => {
      const { result } = renderHook(() =>
        useGestureEngine({ onPressUp: vi.fn() }),
      )

      act(() => result.current.onPointerDown(pointerDown()))
      act(() => result.current.onPointerUp(pointerAt(0, 0)))
      const click = mockClick()
      act(() => result.current.onClickCapture(click.event))

      expect(click.preventDefault).not.toHaveBeenCalled()
    })
  })

  describe("press visual flag (data-pressed)", () => {
    it("sets data-pressed while held inside and clears it on drag out", () => {
      const { result } = renderHook(() =>
        useGestureEngine({ onPressUp: vi.fn() }),
      )
      const target = makeTarget()

      act(() =>
        result.current.onPointerDown(
          pointerDown({ clientX: 50, clientY: 50 }, target),
        ),
      )
      expect(target.hasAttribute("data-pressed")).toBe(true)

      act(() => result.current.onPointerMove(pointerAt(200, 200)))
      expect(target.hasAttribute("data-pressed")).toBe(false)
    })

    it("leaves no data-pressed flag after a clean tap", () => {
      const { result } = renderHook(() =>
        useGestureEngine({ onPressUp: vi.fn() }),
      )
      const target = makeTarget()

      act(() =>
        result.current.onPointerDown(
          pointerDown({ clientX: 50, clientY: 50 }, target),
        ),
      )
      act(() => result.current.onPointerUp(pointerAt(50, 50)))

      expect(target.hasAttribute("data-pressed")).toBe(false)
    })

    it("never sets data-pressed for keyboard activation", () => {
      const { result } = renderHook(() =>
        useGestureEngine({ onPressUp: vi.fn() }),
      )
      const target = makeTarget()

      //keyboard path carries no element; assert it never writes the flag even
      //when one is handed in via a stray currentTarget
      act(() =>
        result.current.onKeyDown({
          key: "Enter",
          repeat: false,
          currentTarget: target,
        } as unknown as KeyboardEvent),
      )
      expect(target.hasAttribute("data-pressed")).toBe(false)
    })
  })
})
