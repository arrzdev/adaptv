import { renderHook } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { useClickFix } from "#adaptv/hooks/use-click-fix"
import {
  POINTER_PRESS_OUTSET_PX,
  TOUCH_PRESS_OUTSET_PX,
} from "#adaptv/hooks/use-gesture-engine"

/*
 * The hook takes React's synthetic pointer events, and the four fields it reads
 * are the whole contract — building a real SyntheticEvent would test React, not
 * this. The cast is the honest way to say "only these four matter".
 */
function pointer(
  init: Partial<{
    pointerId: number
    pointerType: string
    clientX: number
    clientY: number
  }> = {},
): React.PointerEvent<HTMLElement> {
  return {
    pointerId: 1,
    pointerType: "touch",
    clientX: 0,
    clientY: 0,
    ...init,
  } as React.PointerEvent<HTMLElement>
}

describe("useClickFix", () => {
  it("calls back on a release that did not travel", () => {
    const onClick = vi.fn()
    const { result } = renderHook(() => useClickFix(onClick))

    result.current.onPointerDown(pointer({ clientX: 100, clientY: 100 }))
    result.current.onPointerUp(pointer({ clientX: 100, clientY: 100 }))

    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it("swallows a release that travelled past the budget — the scroll case", () => {
    const onClick = vi.fn()
    const { result } = renderHook(() => useClickFix(onClick))

    result.current.onPointerDown(pointer({ clientX: 100, clientY: 100 }))
    result.current.onPointerUp(
      pointer({ clientX: 100, clientY: 100 + TOUCH_PRESS_OUTSET_PX + 1 }),
    )

    expect(onClick).not.toHaveBeenCalled()
  })

  /*
   * The whole reason this hook is not the one it replaces. That one used a flat
   * 10px, and a fingertip drifts far more than that on a real release — so a
   * legitimate tap was dropped and the surface read as dead.
   */
  it("allows the drift a real fingertip has, which a flat 10px would reject", () => {
    const onClick = vi.fn()
    const { result } = renderHook(() => useClickFix(onClick))

    result.current.onPointerDown(pointer({ clientX: 100, clientY: 100 }))
    result.current.onPointerUp(pointer({ clientX: 112, clientY: 108 }))

    expect(TOUCH_PRESS_OUTSET_PX).toBeGreaterThan(10)
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it("holds a mouse to the tighter budget than a finger", () => {
    const onClick = vi.fn()
    const { result } = renderHook(() => useClickFix(onClick))

    const travelled = POINTER_PRESS_OUTSET_PX + 1
    result.current.onPointerDown(
      pointer({ pointerType: "mouse", clientX: 0, clientY: 0 }),
    )
    result.current.onPointerUp(
      pointer({ pointerType: "mouse", clientX: travelled, clientY: 0 }),
    )

    //the same travel is a tap for a finger, so this is the budget and not luck
    expect(travelled).toBeLessThan(TOUCH_PRESS_OUTSET_PX)
    expect(onClick).not.toHaveBeenCalled()
  })

  it("measures per axis, matching the engine's rectangular press region", () => {
    const onClick = vi.fn()
    const { result } = renderHook(() => useClickFix(onClick))

    //inside the square on both axes, but outside a circle of the same radius
    const near = TOUCH_PRESS_OUTSET_PX - 1
    result.current.onPointerDown(pointer({ clientX: 0, clientY: 0 }))
    result.current.onPointerUp(pointer({ clientX: near, clientY: near }))

    expect(Math.hypot(near, near)).toBeGreaterThan(TOUCH_PRESS_OUTSET_PX)
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it("honours a pinned budget over the pointer-adaptive one", () => {
    const onClick = vi.fn()
    const { result } = renderHook(() =>
      useClickFix(onClick, { maxTravel: 2 }),
    )

    result.current.onPointerDown(pointer({ clientX: 0, clientY: 0 }))
    result.current.onPointerUp(pointer({ clientX: 5, clientY: 0 }))

    expect(onClick).not.toHaveBeenCalled()
  })

  /*
   * A canvas is pinch-zoomable, so two live pointers is the ordinary case here.
   * With one shared anchor the second finger's `pointerdown` overwrites the
   * first's origin, and the first finger's release is then measured from the
   * wrong point — a tap fires after a two-finger scroll.
   */
  it("keeps two fingers apart instead of measuring one against the other", () => {
    const onClick = vi.fn()
    const { result } = renderHook(() => useClickFix(onClick))

    result.current.onPointerDown(
      pointer({ pointerId: 1, clientX: 0, clientY: 0 }),
    )
    result.current.onPointerDown(
      pointer({ pointerId: 2, clientX: 300, clientY: 300 }),
    )
    //finger 1 dragged the full way to finger 2's origin: not a tap
    result.current.onPointerUp(
      pointer({ pointerId: 1, clientX: 300, clientY: 300 }),
    )

    expect(onClick).not.toHaveBeenCalled()
  })

  it("does not read a release as a tap after the pointer was cancelled", () => {
    const onClick = vi.fn()
    const { result } = renderHook(() => useClickFix(onClick))

    result.current.onPointerDown(pointer({ clientX: 50, clientY: 50 }))
    result.current.onPointerCancel(pointer({ clientX: 50, clientY: 50 }))
    result.current.onPointerUp(pointer({ clientX: 50, clientY: 50 }))

    expect(onClick).not.toHaveBeenCalled()
  })

  it("ignores a release whose press started somewhere else", () => {
    const onClick = vi.fn()
    const { result } = renderHook(() => useClickFix(onClick))

    result.current.onPointerUp(pointer({ clientX: 0, clientY: 0 }))

    expect(onClick).not.toHaveBeenCalled()
  })

  /*
   * A canvas re-renders per frame. Handlers that changed identity every render
   * would rebind three listeners a frame — so the bag is stable, and the
   * callback is reached through a ref rather than a dependency.
   */
  it("keeps handler identity stable while still calling the latest callback", () => {
    const first = vi.fn()
    const second = vi.fn()
    const { result, rerender } = renderHook(({ cb }) => useClickFix(cb), {
      initialProps: { cb: first },
    })
    const before = result.current.onPointerUp

    rerender({ cb: second })

    expect(result.current.onPointerUp).toBe(before)

    result.current.onPointerDown(pointer({ clientX: 0, clientY: 0 }))
    result.current.onPointerUp(pointer({ clientX: 0, clientY: 0 }))

    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(1)
  })
})
