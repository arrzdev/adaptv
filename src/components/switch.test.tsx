import { cleanup, fireEvent, render } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { Switch } from "#adaptv/components/switch"

/**
 * The switch toggles on gesture release, not on the DOM click, and swallows the
 * click its own press leaves behind. The one click it must NOT swallow is the
 * one an OUTER label forwards: the settings-row idiom (`FieldGroup.Row
 * render={<label />}` around a switch) produces a click on the input with no
 * press on the track at all.
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

describe("Switch — who owns the click", () => {
  it("toggles once on a tap of the track, and swallows the trailing click", () => {
    const onCheckedChange = vi.fn()
    const { container, getByRole } = render(
      <Switch aria-label="Dark mode" onCheckedChange={onCheckedChange} />,
    )
    const track = container.querySelector<HTMLElement>(
      "[data-adaptv='switch']",
    ) as HTMLElement
    press(track)
    //the browser's click after the release, targeted at the input the label
    //owns
    fireEvent.click(getByRole("switch"))
    expect(onCheckedChange).toHaveBeenCalledTimes(1)
    expect(onCheckedChange).toHaveBeenCalledWith(true)
  })

  it("toggles on the click an outer label forwards, which no press produced", () => {
    const onCheckedChange = vi.fn()
    const { getByRole } = render(
      // biome-ignore lint/a11y/noLabelWithoutControl: Switch renders the input the linter cannot see
      <label>
        Dark mode
        <Switch onCheckedChange={onCheckedChange} />
      </label>,
    )
    //what the browser does when the outer label's text is clicked: a click on
    //the first labelable descendant, the switch's input
    fireEvent.click(getByRole("switch"))
    expect(onCheckedChange).toHaveBeenCalledTimes(1)
    expect(onCheckedChange).toHaveBeenCalledWith(true)
    //the DOM agrees with the state: the click was not cancelled, so the
    //browser's own toggle stands and matches what React committed
    expect((getByRole("switch") as HTMLInputElement).checked).toBe(true)
    expect(getByRole("switch").getAttribute("aria-checked")).toBe("true")
  })

  it("ignores the forwarded click while disabled", () => {
    const onCheckedChange = vi.fn()
    const { getByRole } = render(
      // biome-ignore lint/a11y/noLabelWithoutControl: Switch renders the input the linter cannot see
      <label>
        Dark mode
        <Switch disabled onCheckedChange={onCheckedChange} />
      </label>,
    )
    fireEvent.click(getByRole("switch"))
    expect(onCheckedChange).not.toHaveBeenCalled()
  })
})
