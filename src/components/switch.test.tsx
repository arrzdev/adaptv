import { readFileSync } from "node:fs"
import { resolve } from "node:path"
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

/*
 * Styling: the default look is a layered rule keyed on `data-adaptv` + `data-part`
 * (styles/switch.css), the lock is inline style, and the `className` attribute is
 * the consumer's alone (docs/decisions/styling.md §2). Real cascade resolution is the
 * browser precedence suite's; this pins the mechanism.
 */
describe("Switch — styling tiers", () => {
  const css = readFileSync(
    resolve(__dirname, "../styles/switch.css"),
    "utf8",
  ).replace(/\/\*[\s\S]*?\*\//g, "")

  function parts(container: HTMLElement) {
    const q = (part: string) =>
      container.querySelector<HTMLElement>(
        //the root carries `switch`; each sub-part its own `switch-<part>` scope
        `[data-adaptv='switch${part === "root" ? "" : `-${part}`}'][data-part='${part}']`,
      ) as HTMLElement
    return { root: q("root"), thumb: q("thumb"), input: q("input") }
  }

  it("emits no class of its own on any part", () => {
    const { container } = render(<Switch aria-label="Dark mode" />)
    const { root, thumb, input } = parts(container)
    for (const el of [root, thumb, input]) {
      expect(el).not.toBeNull()
      expect(el.hasAttribute("class")).toBe(false)
    }
    //stamped once: `[data-adaptv="switch"]` names the root and nothing inside it
    expect(
      container.querySelectorAll('[data-adaptv="switch"]'),
    ).toHaveLength(1)
  })

  it("passes the consumer's className through untouched", () => {
    const { container } = render(
      <Switch aria-label="Dark mode" className="bg-brand-600">
        <Switch.Thumb className="bg-white" />
      </Switch>,
    )
    const { root, thumb } = parts(container)
    expect(root.className).toBe("bg-brand-600")
    expect(thumb.className).toBe("bg-white")
  })

  it("locks position, size and the touch pass-through inline, over the consumer's style", () => {
    const { container } = render(
      <Switch
        aria-label="Dark mode"
        style={{
          position: "static",
          touchAction: "none",
          width: "10rem",
          color: "red",
        }}
      />,
    )
    const { root } = parts(container)
    expect(root.style.position).toBe("relative")
    expect(root.style.touchAction).toBe("pan-x pan-y pinch-zoom")
    expect(root.style.width).not.toBe("10rem")
    expect(root.style.color).toBe("red")
    expect(root.style.userSelect).toBe("")
  })

  it("adds user-select: none when disabled, keeping the touch pass-through", () => {
    const { container } = render(
      <Switch aria-label="Dark mode" disabled />,
    )
    const { root } = parts(container)
    expect(root.hasAttribute("data-disabled")).toBe(true)
    expect(root.style.touchAction).toBe("pan-x pan-y pinch-zoom")
    expect(root.style.userSelect).toBe("none")
  })

  it("locks the thumb's placement inline, beside its travel transform", () => {
    const { container } = render(
      <Switch aria-label="Dark mode" defaultChecked />,
    )
    const { thumb } = parts(container)
    expect(thumb.style.position).toBe("absolute")
    expect(thumb.style.top).toBe("50%")
    expect(thumb.style.translate).toBe("0 -50%")
    expect(thumb.style.pointerEvents).toBe("none")
    expect(thumb.style.flexShrink).toBe("0")
    expect(thumb.style.transform).toMatch(/^translateX\(.+rem\)$/)
  })

  it("puts the defaults in zero-specificity layered rules, with no border width", () => {
    expect(css).toMatch(/@layer adaptv\.components\s*\{/)
    expect(css).toContain(
      ':where([data-adaptv="switch"][data-part="root"])',
    )
    expect(css).toContain(
      ':where([data-adaptv="switch-thumb"][data-part="thumb"])',
    )
    expect(css).not.toContain("!important")
    //⚠︎ a pre-allocated border shrinks the track's content box (button.tsx)
    expect(css).not.toMatch(/border(-width)?\s*:/)
  })
})
