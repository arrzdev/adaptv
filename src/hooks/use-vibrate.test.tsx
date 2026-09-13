import {
  fireEvent,
  render,
  renderHook,
  screen,
} from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { haptics } from "#adaptv/capabilities/haptics"
import { useVibrate } from "#adaptv/hooks/use-vibrate"

vi.mock("#adaptv/capabilities/haptics", () => ({
  haptics: {
    impact: vi.fn(),
    notify: vi.fn(),
    selection: vi.fn(),
    isSupported: vi.fn(() => true),
  },
}))

afterEach(() => {
  vi.clearAllMocks()
})

describe("useVibrate", () => {
  it("maps every semantic alias onto the right haptics primitive", () => {
    const { result } = renderHook(() => useVibrate())
    const v = result.current

    const cases: Array<[() => void, keyof typeof haptics, unknown[]]> = [
      [v.vibrateOk, "impact", ["light"]],
      [v.vibrateCancel, "impact", ["light"]],
      [v.vibrateImpact, "impact", ["medium"]],
      [v.vibrateSelection, "selection", []],
      [v.vibrateSuccess, "notify", ["success"]],
      [v.vibrateWarning, "notify", ["warning"]],
      [v.vibrateError, "notify", ["error"]],
    ]
    for (const [call, primitive, args] of cases) {
      vi.clearAllMocks()
      call()
      expect(haptics[primitive]).toHaveBeenCalledTimes(1)
      expect(haptics[primitive]).toHaveBeenCalledWith(...args)
    }

    vi.mocked(haptics.isSupported).mockReturnValueOnce(false)
    expect(v.canVibrate()).toBe(false)
  })

  it("buzzes once per tap: on touchend for touch, on click for a mouse", () => {
    const onPress = vi.fn()
    function Button() {
      const { hapticPointerHandlers } = useVibrate()
      return (
        <button
          type="button"
          {...hapticPointerHandlers(onPress, "success")}
        >
          press
        </button>
      )
    }
    render(<Button />)
    const button = screen.getByRole("button")

    //a touch tap delivers touchend AND a click carrying pointerType "touch" — the
    //click must not fire a second pulse, but must still run the handler
    fireEvent.touchEnd(button)
    fireEvent(
      button,
      new PointerEvent("click", { bubbles: true, pointerType: "touch" }),
    )
    expect(haptics.notify).toHaveBeenCalledTimes(1)
    expect(haptics.notify).toHaveBeenCalledWith("success")
    expect(onPress).toHaveBeenCalledTimes(1)

    vi.clearAllMocks()
    fireEvent(
      button,
      new PointerEvent("click", { bubbles: true, pointerType: "mouse" }),
    )
    expect(haptics.notify).toHaveBeenCalledTimes(1)
    expect(onPress).toHaveBeenCalledTimes(1)
  })
})
