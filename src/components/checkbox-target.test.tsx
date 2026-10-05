import { fireEvent, render } from "@testing-library/react"
import { useState } from "react"
import { describe, expect, it, vi } from "vitest"
import { Checkbox } from "#adaptv/components/checkbox"

/**
 * The checkbox's accessible element and its hit area are ONE rectangle.
 *
 * The `<input type="checkbox">` is the only node assistive tech and automation
 * see, so its box is the frame VoiceOver draws, TalkBack highlights and every
 * tap aimed at "the checkbox" hits. It used to be `sr-only`, a clipped 1px box
 * in the middle of the painted square, the same defect the Switch had. Real layout is measured in `playground/e2e/toggles.spec.ts`;
 * happy-dom computes none, so this file pins the contract that produces it, and
 * that a press which now LANDS on the input still toggles exactly once through
 * the label's gesture engine.
 */

function labelOf(container: HTMLElement): HTMLElement {
  const label = container.querySelector<HTMLElement>(
    "[data-adaptv='checkbox'][data-part='root']",
  )
  if (!label) throw new Error("no checkbox label")
  //happy-dom has no Pointer Capture API; the engine claims the pointer on the
  //element its handlers are bound to, which is the label
  label.setPointerCapture ??= () => {}
  label.releasePointerCapture ??= () => {}
  return label
}

/** A finger on the checkbox's accessible frame: the events target the input. */
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

function ControlledCheckbox({
  onCheckedChange,
}: {
  onCheckedChange: (next: boolean) => void
}) {
  const [on, setOn] = useState(false)
  return (
    <Checkbox
      aria-label="Agree"
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
      <ControlledCheckbox onCheckedChange={spy} />
    ),
  },
  {
    mode: "uncontrolled",
    mount: (spy: (next: boolean) => void) => (
      <Checkbox aria-label="Agree" onCheckedChange={spy} />
    ),
  },
] as const

describe("Checkbox — the accessible element is the hit area", () => {
  it("lays the checkbox input over the whole label, invisibly", () => {
    const { container, getByRole } = render(
      <Checkbox aria-label="Agree" />,
    )
    const label = labelOf(container)
    const input = getByRole("checkbox")

    //its containing block is the label: a direct child of the positioned root
    expect(input.parentElement).toBe(label)
    expect(label.style.position).toBe("relative")
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

  it("paints the input over the positioned box by order, not by z-index", () => {
    const { container, getByRole } = render(
      <Checkbox aria-label="Agree" />,
    )
    const label = labelOf(container)
    const input = getByRole("checkbox")
    //the box is `relative`; an earlier sibling would sit under it and the box
    //would take the tap and the hit-test instead of the input
    expect(label.lastElementChild).toBe(input)
    expect(input.style.zIndex).toBe("")
  })

  it("keeps `position: relative` on the label when the consumer asks for `static`", () => {
    const { container } = render(
      <Checkbox
        aria-label="Agree"
        className="static"
        style={{ position: "static" }}
      />,
    )
    const label = labelOf(container)
    //the consumer's class passes through untouched; the inline lock outranks it
    //in the cascade, and outranks the consumer's own inline `position` here
    expect(label.className).toBe("static")
    expect(label.style.position).toBe("relative")
  })

  it("renders its controlled input without React's read-only-field warning", () => {
    //`readOnly` is what tells React the missing `onChange` is deliberate; it
    //changes nothing a checkbox does
    const error = vi.spyOn(console, "error").mockImplementation(() => {})
    try {
      render(<Checkbox aria-label="Agree" checked={false} />)
      expect(error).not.toHaveBeenCalled()
    } finally {
      error.mockRestore()
    }
  })

  for (const { mode, mount } of MODES) {
    it(`toggles exactly once on a tap that lands on the input (${mode})`, () => {
      const spy = vi.fn()
      const { container, getByRole } = render(mount(spy))
      labelOf(container)
      const input = getByRole("checkbox") as HTMLInputElement

      tapInput(input)
      expect(spy).toHaveBeenCalledTimes(1)
      expect(spy).toHaveBeenLastCalledWith(true)
      expect(input.checked).toBe(true)

      tapInput(input)
      expect(spy).toHaveBeenCalledTimes(2)
      expect(spy).toHaveBeenLastCalledWith(false)
      expect(input.checked).toBe(false)
    })

    it(`toggles exactly once per Space press (${mode})`, () => {
      const spy = vi.fn()
      const { container, getByRole } = render(mount(spy))
      labelOf(container)
      const input = getByRole("checkbox") as HTMLInputElement

      input.focus()
      pressSpace(input)
      expect(spy).toHaveBeenCalledTimes(1)
      expect(input.checked).toBe(true)
      pressSpace(input)
      expect(spy).toHaveBeenCalledTimes(2)
      expect(input.checked).toBe(false)
    })

    it(`never toggles twice on a bare programmatic click, and the DOM agrees with the state (${mode})`, () => {
      //what VoiceOver and TalkBack dispatch on activation: a click on the
      //element, with no pointer press before it
      const spy = vi.fn()
      const { container, getByRole } = render(mount(spy))
      labelOf(container)
      const input = getByRole("checkbox") as HTMLInputElement

      input.click()
      expect(spy.mock.calls.length).toBeLessThanOrEqual(1)
      expect(input.checked).toBe(spy.mock.calls.length === 1)
    })
  }

  it("resolves an indeterminate checkbox to CHECKED on a tap that lands on the input", () => {
    const spy = vi.fn()
    const { container, getByRole } = render(
      <Checkbox aria-label="Agree" indeterminate onCheckedChange={spy} />,
    )
    labelOf(container)
    tapInput(getByRole("checkbox"))
    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy).toHaveBeenCalledWith(true)
  })
})
