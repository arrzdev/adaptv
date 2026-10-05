import { fireEvent, render } from "@testing-library/react"
import { useState } from "react"
import { describe, expect, it, vi } from "vitest"
import { Switch } from "#adaptv/components/switch"

/**
 * The switch's accessible element and its hit area are ONE rectangle.
 *
 * The `<input role="switch">` is the only node assistive tech and automation
 * see, so its box is the frame VoiceOver draws, TalkBack highlights and every
 * tap aimed at "the switch" hits. It used to be `sr-only`, a clipped 1px box at
 * the track's left edge: on the iOS simulators the Settings row's switch read
 * as a frame under a point wide and a tap at its centre toggled nothing. Real
 * layout is measured in `playground/e2e/toggles.spec.ts`; happy-dom computes
 * none, so this file pins the inline-style contract that produces it, and that a press
 * which now LANDS on the input still toggles exactly once through the track's
 * gesture engine.
 */

function trackOf(container: HTMLElement): HTMLElement {
  const track = container.querySelector<HTMLElement>(
    "[data-adaptv='switch']",
  )
  if (!track) throw new Error("no switch track")
  //happy-dom has no Pointer Capture API; the engine claims the pointer on the
  //element its handlers are bound to, which is the track
  track.setPointerCapture ??= () => {}
  track.releasePointerCapture ??= () => {}
  return track
}

/** A finger on the switch's accessible frame: the events target the input. */
function tapInput(input: HTMLElement): void {
  const pointer = { pointerId: 1, button: 0, isPrimary: true }
  fireEvent.pointerDown(input, pointer)
  fireEvent.pointerUp(input, pointer)
  //the click the browser fires after the release
  fireEvent.click(input)
}

function pressSpace(input: HTMLElement): void {
  fireEvent.keyDown(input, { key: " " })
  fireEvent.keyUp(input, { key: " " })
  //a checkbox's own activation on Space keyup
  fireEvent.click(input)
}

function ControlledSwitch({
  onCheckedChange,
}: {
  onCheckedChange: (next: boolean) => void
}) {
  const [on, setOn] = useState(false)
  return (
    <Switch
      aria-label="Dark mode"
      checked={on}
      onCheckedChange={(next) => {
        onCheckedChange(next)
        setOn(next)
      }}
    />
  )
}

const MODES = [
  {
    mode: "controlled",
    mount: (spy: (next: boolean) => void) => (
      <ControlledSwitch onCheckedChange={spy} />
    ),
  },
  {
    mode: "uncontrolled",
    mount: (spy: (next: boolean) => void) => (
      <Switch aria-label="Dark mode" onCheckedChange={spy} />
    ),
  },
] as const

describe("Switch — the accessible element is the hit area", () => {
  it("lays the role=switch input over the whole track, invisibly", () => {
    const { container, getByRole } = render(
      <Switch aria-label="Dark mode" />,
    )
    const track = trackOf(container)
    const input = getByRole("switch")

    //its containing block is the track: a direct child of the positioned label
    expect(input.parentElement).toBe(track)
    expect(track.style.position).toBe("relative")
    //and it fills that box exactly — no inset, no margin, no clip — as inline
    //style, the one tier no consumer class can beat
    expect(input.style.position).toBe("absolute")
    expect(input.style.inset).toMatch(/^0(px)?$/)
    expect(input.style.width).toBe("100%")
    expect(input.style.height).toBe("100%")
    expect(input.style.margin).toMatch(/^0(px)?$/)
    expect(input.style.opacity).toBe("0")
    expect(input.style.appearance).toBe("none")
    expect(input.style.cursor).toBe("inherit")
    //a 1px clipped box is not a frame
    expect(input.style.clipPath).toBe("")
    expect(input.style.overflow).toBe("")
    //and the input carries no class of adaptv's at all
    expect(input.hasAttribute("class")).toBe(false)
  })

  it("keeps the input the only accessible element: the thumb stays hidden and passes pointers through", () => {
    const { container } = render(<Switch aria-label="Dark mode" />)
    const track = trackOf(container)
    const thumb = track.querySelector<HTMLElement>("[data-part='thumb']")
    expect(thumb?.getAttribute("aria-hidden")).toBe("true")
    expect(thumb?.style.pointerEvents).toBe("none")
  })

  it("renders its controlled input without React's read-only-field warning", () => {
    //`readOnly` is what tells React the missing `onChange` is deliberate; it
    //changes nothing a checkbox does
    const error = vi.spyOn(console, "error").mockImplementation(() => {})
    try {
      render(<Switch aria-label="Dark mode" checked={false} />)
      expect(error).not.toHaveBeenCalled()
    } finally {
      error.mockRestore()
    }
  })

  for (const { mode, mount } of MODES) {
    it(`toggles exactly once on a tap that lands on the input (${mode})`, () => {
      const spy = vi.fn()
      const { container, getByRole } = render(mount(spy))
      trackOf(container)
      const input = getByRole("switch") as HTMLInputElement

      tapInput(input)
      expect(spy).toHaveBeenCalledTimes(1)
      expect(spy).toHaveBeenLastCalledWith(true)
      expect(input.getAttribute("aria-checked")).toBe("true")
      expect(input.checked).toBe(true)

      tapInput(input)
      expect(spy).toHaveBeenCalledTimes(2)
      expect(spy).toHaveBeenLastCalledWith(false)
      expect(input.getAttribute("aria-checked")).toBe("false")
      expect(input.checked).toBe(false)
    })

    it(`toggles exactly once per Space press (${mode})`, () => {
      const spy = vi.fn()
      const { container, getByRole } = render(mount(spy))
      trackOf(container)
      const input = getByRole("switch") as HTMLInputElement

      input.focus()
      pressSpace(input)
      expect(spy).toHaveBeenCalledTimes(1)
      expect(input.checked).toBe(true)
      pressSpace(input)
      expect(spy).toHaveBeenCalledTimes(2)
      expect(input.checked).toBe(false)
    })

    it(`never toggles twice on a bare programmatic click, and the DOM agrees with aria-checked (${mode})`, () => {
      //what VoiceOver and TalkBack dispatch on activation: a click on the
      //element, with no pointer press before it
      const spy = vi.fn()
      const { container, getByRole } = render(mount(spy))
      trackOf(container)
      const input = getByRole("switch") as HTMLInputElement

      input.click()
      expect(spy.mock.calls.length).toBeLessThanOrEqual(1)
      expect(String(input.checked)).toBe(
        input.getAttribute("aria-checked"),
      )
    })
  }
})
