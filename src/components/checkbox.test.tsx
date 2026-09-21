import { cleanup, fireEvent, render } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { Checkbox } from "#adaptv/components/checkbox"

/**
 * The checkbox toggles on gesture release, not on the DOM click, and swallows
 * the click its own press leaves behind. The one click it must NOT swallow is
 * the one an OUTER label forwards: the settings-row idiom (`FieldGroup.Row
 * render={<label />}` around a checkbox) produces a click on the input with no
 * press on the checkbox's own label at all. The Switch has had this contract
 * since its settings-row test; the Checkbox is the same control with a square.
 */

afterEach(() => {
  cleanup()
})

function press(el: HTMLElement): void {
  //happy-dom has no Pointer Capture API; the engine claims the pointer on press
  el.setPointerCapture ??= () => {}
  el.releasePointerCapture ??= () => {}
  const pointer = { pointerId: 1, button: 0, isPrimary: true }
  fireEvent.pointerDown(el, pointer)
  fireEvent.pointerUp(el, pointer)
}

describe("Checkbox — who owns the click", () => {
  it("toggles once on a tap of its label, and swallows the trailing click", () => {
    const onCheckedChange = vi.fn()
    const { container, getByRole } = render(
      <Checkbox aria-label="Agree" onCheckedChange={onCheckedChange} />,
    )
    const label = container.querySelector<HTMLElement>(
      "[data-adaptv='checkbox']",
    ) as HTMLElement
    press(label)
    //the browser's click after the release, targeted at the input the label
    //owns
    fireEvent.click(getByRole("checkbox"))
    expect(onCheckedChange).toHaveBeenCalledTimes(1)
    expect(onCheckedChange).toHaveBeenCalledWith(true)
  })

  it("toggles on the click an outer label forwards, which no press produced", () => {
    const onCheckedChange = vi.fn()
    const { getByRole } = render(
      // biome-ignore lint/a11y/noLabelWithoutControl: Checkbox renders the input the linter cannot see
      <label>
        Agree
        <Checkbox onCheckedChange={onCheckedChange} />
      </label>,
    )
    //what the browser does when the outer label's text is clicked: a click on
    //the first labelable descendant, the checkbox's input
    fireEvent.click(getByRole("checkbox"))
    expect(onCheckedChange).toHaveBeenCalledTimes(1)
    expect(onCheckedChange).toHaveBeenCalledWith(true)
    //the DOM agrees with the state: the click was not cancelled, so the
    //browser's own toggle stands and matches what React committed
    expect((getByRole("checkbox") as HTMLInputElement).checked).toBe(true)
  })

  it("resolves indeterminate to checked on the forwarded click, like on a tap", () => {
    const onCheckedChange = vi.fn()
    const { getByRole } = render(
      // biome-ignore lint/a11y/noLabelWithoutControl: Checkbox renders the input the linter cannot see
      <label>
        Agree
        <Checkbox indeterminate onCheckedChange={onCheckedChange} />
      </label>,
    )
    fireEvent.click(getByRole("checkbox"))
    expect(onCheckedChange).toHaveBeenCalledTimes(1)
    expect(onCheckedChange).toHaveBeenCalledWith(true)
  })

  it("ignores the forwarded click while disabled", () => {
    const onCheckedChange = vi.fn()
    const { getByRole } = render(
      // biome-ignore lint/a11y/noLabelWithoutControl: Checkbox renders the input the linter cannot see
      <label>
        Agree
        <Checkbox disabled onCheckedChange={onCheckedChange} />
      </label>,
    )
    fireEvent.click(getByRole("checkbox"))
    expect(onCheckedChange).not.toHaveBeenCalled()
  })
})
