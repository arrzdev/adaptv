import { readFileSync } from "node:fs"
import { resolve } from "node:path"
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

/*
 * Styling: the default look is a layered rule keyed on `data-adaptv` + `data-part`
 * (styles/checkbox.css), the lock is inline style, and the `className` attribute is
 * the consumer's alone (docs/decisions/styling.md §2). Real cascade resolution is the
 * browser precedence suite's; this pins the mechanism.
 */
describe("Checkbox — styling tiers", () => {
  const css = readFileSync(
    resolve(__dirname, "../styles/checkbox.css"),
    "utf8",
  ).replace(/\/\*[\s\S]*?\*\//g, "")

  function parts(container: HTMLElement) {
    const q = (part: string) =>
      container.querySelector<HTMLElement>(
        `[data-adaptv='checkbox'][data-part='${part}']`,
      ) as HTMLElement
    return {
      root: q("root"),
      box: q("box"),
      icon: q("icon"),
      input: q("input"),
    }
  }

  it("emits no class of its own on any part", () => {
    const { container } = render(<Checkbox aria-label="Agree" />)
    const { root, box, icon, input } = parts(container)
    for (const el of [root, box, icon, input]) {
      expect(el).not.toBeNull()
      expect(el.hasAttribute("class")).toBe(false)
    }
  })

  it("passes the consumer's className through untouched", () => {
    const { container } = render(
      <Checkbox aria-label="Agree" className="w-full flex">
        <Checkbox.Box className="rounded-md">
          <Checkbox.Icon className="text-white" />
        </Checkbox.Box>
      </Checkbox>,
    )
    const { root, box, icon } = parts(container)
    expect(root.className).toBe("w-full flex")
    expect(box.className).toBe("rounded-md")
    expect(icon.getAttribute("class")).toBe("text-white")
  })

  it("locks position and the touch pass-through inline, over the consumer's style", () => {
    const { container } = render(
      <Checkbox
        aria-label="Agree"
        style={{ position: "static", touchAction: "none", color: "red" }}
      />,
    )
    const { root } = parts(container)
    expect(root.style.position).toBe("relative")
    expect(root.style.touchAction).toBe("pan-x pan-y pinch-zoom")
    //an unlocked property is the consumer's
    expect(root.style.color).toBe("red")
    expect(root.style.userSelect).toBe("")
  })

  it("adds user-select: none when disabled, keeping the touch pass-through", () => {
    const { container } = render(<Checkbox aria-label="Agree" disabled />)
    const { root } = parts(container)
    expect(root.hasAttribute("data-disabled")).toBe(true)
    expect(root.style.touchAction).toBe("pan-x pan-y pinch-zoom")
    expect(root.style.userSelect).toBe("none")
  })

  it("locks the box's layout and the icon's pointer-events inline", () => {
    const { container } = render(
      <Checkbox aria-label="Agree">
        <Checkbox.Box style={{ position: "static", overflow: "visible" }}>
          <Checkbox.Icon />
        </Checkbox.Box>
      </Checkbox>,
    )
    const { box, icon } = parts(container)
    expect(box.style.position).toBe("relative")
    expect(box.style.display).toBe("flex")
    expect(box.style.overflow).toBe("hidden")
    expect(box.style.flexShrink).toBe("0")
    expect(box.style.width).toBe("2rem")
    expect(icon.style.pointerEvents).toBe("none")
  })

  it("puts the defaults in zero-specificity layered rules, with no border width", () => {
    expect(css).toMatch(/@layer adaptv\.components\s*\{/)
    expect(css).toContain(
      ':where([data-adaptv="checkbox"][data-part="root"])',
    )
    expect(css).toContain(
      ':where([data-adaptv="checkbox"][data-part="box"])',
    )
    expect(css).not.toContain("!important")
    //⚠︎ a pre-allocated border shrinks every checkbox's content box (button.tsx)
    expect(css).not.toMatch(/border(-width)?\s*:/)
  })
})
