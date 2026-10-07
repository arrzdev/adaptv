import { fireEvent, render, screen } from "@testing-library/react"
import type { KeyboardEvent } from "react"
import { act, createRef, useState } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { InputHandle } from "#adaptv/components/input"
import { Input, useInput } from "#adaptv/components/input"

/*
 * Input's behaviour past its class strings (style-precedence.test.tsx owns those):
 * the slot contract, the focus-keeping mousedown handlers, the submit key and the
 * imperative handle.
 */

const restores: Array<() => void> = []

afterEach(() => {
  for (const restore of restores.splice(0)) restore()
  vi.restoreAllMocks()
})

//`isTouchDevice()` is `"ontouchstart" in window || navigator.maxTouchPoints > 0`;
//happy-dom answers false to both, so a touch device is the stubbed case
function stubTouchDevice(): void {
  const prev = Object.getOwnPropertyDescriptor(navigator, "maxTouchPoints")
  Object.defineProperty(navigator, "maxTouchPoints", {
    value: 5,
    configurable: true,
  })
  restores.push(() => {
    if (prev) Object.defineProperty(navigator, "maxTouchPoints", prev)
    else
      delete (navigator as unknown as Record<string, unknown>)
        .maxTouchPoints
  })
}

//React reports a render-phase throw on console.error before rethrowing it
function silenceRenderErrors(): void {
  vi.spyOn(console, "error").mockImplementation(() => undefined)
}

function field(): HTMLInputElement {
  const el = document.querySelector("input")
  if (!el) throw new Error("no <input> rendered")
  return el
}

describe("useInput", () => {
  it("throws outside an <Input>, naming the provider it needs", () => {
    silenceRenderErrors()
    function Probe() {
      useInput()
      return null
    }
    expect(() => render(<Probe />)).toThrow(
      "useInput must be used within <Input>.",
    )
  })

  it("a slot rendered outside an <Input> throws the same way", () => {
    silenceRenderErrors()
    expect(() => render(<Input.Leading>x</Input.Leading>)).toThrow(
      "useInput must be used within <Input>.",
    )
  })

  it("reports grouped and disabled state to slot sub-parts", () => {
    const seen: Array<ReturnType<typeof useInput>> = []
    function Probe() {
      seen.push(useInput())
      return <span>probe</span>
    }
    render(
      <Input disabled>
        <Input.Leading>
          <Probe />
        </Input.Leading>
      </Input>,
    )
    expect(seen.at(-1)).toEqual({ isGrouped: true, isDisabled: true })
  })
})

describe("Input — bare vs grouped", () => {
  it("with no children the <input> is the root and carries the identity", () => {
    const { container } = render(<Input aria-label="q" />)
    expect(container.firstElementChild?.tagName).toBe("INPUT")
    expect(field().getAttribute("data-adaptv")).toBe("input")
    expect(field().getAttribute("data-part")).toBe("root")
    //native inline-block width: ~20 characters unless the consumer sizes it
    expect(field().getAttribute("size")).toBe("20")
  })

  it("`null` and `false` children do not switch to the grouped layout", () => {
    const { container } = render(
      <Input aria-label="q">
        {null}
        {false}
      </Input>,
    )
    expect(container.firstElementChild?.tagName).toBe("INPUT")
  })

  it("a slot child wraps the field in a <label> that owns the identity and points at the field", () => {
    const { container } = render(
      <Input id="q">
        <Input.Leading>icon</Input.Leading>
      </Input>,
    )
    const label = container.firstElementChild as HTMLLabelElement
    expect(label.tagName).toBe("LABEL")
    expect(label.getAttribute("data-adaptv")).toBe("input")
    expect(label.getAttribute("data-part")).toBe("root")
    expect(label.htmlFor).toBe("q")
    expect(field().id).toBe("q")
    //stamped once: `[data-adaptv="input"]` must not match two nested elements
    expect(field().hasAttribute("data-adaptv")).toBe(false)
    expect(
      container.querySelectorAll('[data-adaptv="input"]'),
    ).toHaveLength(1)
    expect(field().getAttribute("data-part")).toBe("field")
    //grouped, the field gives way to the slots rather than claiming 20 characters
    expect(field().hasAttribute("size")).toBe(false)
  })

  it("grouped, `placeholder:` and `caret:` tokens reach the <input> and the rest stay on the shell", () => {
    const { container } = render(
      <Input className="px-3 placeholder:text-red-500 caret:text-blue-500">
        <Input.Leading>icon</Input.Leading>
      </Input>,
    )
    const label = container.firstElementChild as HTMLElement
    expect(label.classList.contains("px-3")).toBe(true)
    expect(label.classList.contains("placeholder:text-red-500")).toBe(
      false,
    )
    expect(field().classList.contains("placeholder:text-red-500")).toBe(
      true,
    )
    expect(field().classList.contains("caret:text-blue-500")).toBe(true)
    expect(field().classList.contains("px-3")).toBe(false)
  })
})

describe("Input.Leading / Input.Trailing — content detection", () => {
  it.each([
    ["whitespace-only text", "   "],
    ["an empty string", ""],
    ["`false`", false],
    ["`null`", null],
  ])("renders nothing for %s", (_, content) => {
    const { container } = render(
      <Input>
        <Input.Leading>{content}</Input.Leading>
        <Input.Trailing>{content}</Input.Trailing>
      </Input>,
    )
    const label = container.firstElementChild as HTMLElement
    //the field is the label's only child: neither slot mounted a wrapper
    expect(label.children).toHaveLength(1)
    expect(label.firstElementChild?.tagName).toBe("INPUT")
  })

  it.each([
    ["a number, zero included", 0, "0"],
    ["text around whitespace", "  $ ", "$"],
  ])("renders a slot for %s", (_, content, text) => {
    const { container } = render(
      <Input>
        <Input.Leading>{content}</Input.Leading>
        <Input.Trailing>{content}</Input.Trailing>
      </Input>,
    )
    const label = container.firstElementChild as HTMLElement
    expect(label.children).toHaveLength(3)
    expect(label.children[1]?.textContent?.trim()).toBe(text)
    expect(label.children[2]?.textContent?.trim()).toBe(text)
  })

  it("an element child counts as content even when it renders nothing", () => {
    function Empty() {
      return null
    }
    const { container } = render(
      <Input>
        <Input.Trailing>
          <Empty />
        </Input.Trailing>
      </Input>,
    )
    expect(
      (container.firstElementChild as HTMLElement).children,
    ).toHaveLength(2)
  })

  it("orders leading before and trailing after the field whatever the JSX order", () => {
    const { container } = render(
      <Input>
        <Input.Trailing>t</Input.Trailing>
        <Input.Leading>l</Input.Leading>
      </Input>,
    )
    const [, trailing, leading] = Array.from(
      (container.firstElementChild as HTMLElement).children,
    ) as HTMLElement[]
    expect(leading?.getAttribute("data-part")).toBe("leading")
    expect(trailing?.getAttribute("data-part")).toBe("trailing")
    //each slot has its own scope, so `[data-adaptv="input"]` stays the one shell
    expect(leading?.getAttribute("data-adaptv")).toBe("input-leading")
    expect(trailing?.getAttribute("data-adaptv")).toBe("input-trailing")
    //the order IS the slot contract, so it is locked inline
    expect(leading?.style.order).toBe("1")
    expect(trailing?.style.order).toBe("3")
    expect(field().style.order).toBe("2")
  })

  it("hands a slot the consumer's class alone and locks order and shrink inline, above any class", () => {
    const { container } = render(
      <Input>
        <Input.Leading className="consumer-slot">l</Input.Leading>
      </Input>,
    )
    const leading = (container.firstElementChild as HTMLElement)
      .children[1] as HTMLElement
    //the consumer's class lands untouched and alone…
    expect(leading.className).toBe("consumer-slot")
    //…and the slot contract is inline, where no class can reach it
    expect(leading.style.order).toBe("1")
    expect(leading.style.flexShrink).toBe("0")
    expect(leading.style.display).toBe("inline-flex")
  })
})

describe("Input — styling tiers (docs/decisions/styling.md §2)", () => {
  it("bare, adaptv adds no class of its own and the consumer's lands untouched", () => {
    const { rerender } = render(<Input aria-label="q" />)
    expect(field().hasAttribute("class")).toBe(false)
    rerender(<Input aria-label="q" className="w-full px-3" />)
    expect(field().className).toBe("w-full px-3")
  })

  it("grouped, the chromeless set is locked inline over a consumer style", () => {
    render(
      <Input
        aria-label="q"
        style={{ order: 7, padding: "9px", letterSpacing: "1px" }}
      >
        <Input.Leading>l</Input.Leading>
      </Input>,
    )
    const style = field().style
    expect(style.order).toBe("2")
    expect(style.padding).toMatch(/^0(px)?$/)
    expect(style.borderStyle).toBe("none")
    expect(style.backgroundColor).toBe("transparent")
    expect(style.color).toBe("inherit")
    expect(style.minWidth).toMatch(/^0(px)?$/)
    //a property adaptv does not lock is the consumer's
    expect(style.letterSpacing).toBe("1px")
  })

  it("bare, the field carries no lock while enabled, so a consumer style is the whole style", () => {
    render(<Input aria-label="q" style={{ padding: "9px" }} />)
    expect(field().style.padding).toBe("9px")
    expect(field().style.touchAction).toBe("")
  })

  it("disabled, the field and its shell lock user-select and the touch pass-through", () => {
    const { container } = render(
      <Input aria-label="q" disabled style={{ userSelect: "text" }}>
        <Input.Leading>l</Input.Leading>
      </Input>,
    )
    const label = container.firstElementChild as HTMLElement
    for (const el of [label, field()]) {
      expect(el.style.userSelect).toBe("none")
      expect(el.style.touchAction).toBe("pan-x pan-y pinch-zoom")
    }
    //the shell's disabled cursor (input.css) keys on this
    expect(label.hasAttribute("data-disabled")).toBe(true)
  })
})

describe("Input slots — a press on addon content keeps the field focused", () => {
  //`fireEvent` returns false when a handler called preventDefault, which is the
  //whole mechanism: a cancelled mousedown does not move focus off the field
  it.each([
    ["Leading", Input.Leading],
    ["Trailing", Input.Trailing],
  ])("%s: an interactive control does not steal focus", (_, Slot) => {
    render(
      <Input aria-label="q">
        <Slot>
          <button type="button" data-testid="control">
            clear
          </button>
        </Slot>
      </Input>,
    )
    const button = screen.getByTestId("control")
    expect(fireEvent.mouseDown(button)).toBe(false)
  })

  it.each([
    ["Leading", Input.Leading],
    ["Trailing", Input.Trailing],
  ])(
    "%s: the interactive ancestor counts, not just the node pressed",
    (_, Slot) => {
      render(
        <Input aria-label="q">
          <Slot>
            <a href="#x">
              <span data-testid="glyph">x</span>
            </a>
          </Slot>
        </Input>,
      )
      expect(fireEvent.mouseDown(screen.getByTestId("glyph"))).toBe(false)
    },
  )

  it.each([
    ["Leading", Input.Leading],
    ["Trailing", Input.Trailing],
  ])(
    "%s: a static icon leaves the press alone while the field is not focused",
    (_, Slot) => {
      render(
        <Input aria-label="q">
          <Slot>
            <span data-testid="icon">i</span>
          </Slot>
        </Input>,
      )
      //not focused, so the group has no focus to keep either — the default runs and
      //the <label> forwards the click to the field
      expect(fireEvent.mouseDown(screen.getByTestId("icon"))).toBe(true)
    },
  )
})

describe("Input group — a press on the shell keeps an already-focused field", () => {
  function renderGroup() {
    render(
      <Input aria-label="q">
        <Input.Leading>
          <span data-testid="icon">i</span>
        </Input.Leading>
        <button type="button" data-testid="raw">
          raw
        </button>
      </Input>,
    )
    return {
      label: document.querySelector("label") as HTMLLabelElement,
      icon: screen.getByTestId("icon"),
      raw: screen.getByTestId("raw"),
    }
  }

  it("cancels a press on the shell or a static icon while the field has focus", () => {
    const { label, icon } = renderGroup()
    field().focus()
    expect(fireEvent.mouseDown(label)).toBe(false)
    expect(fireEvent.mouseDown(icon)).toBe(false)
  })

  it("does nothing while the field is not focused", () => {
    const { label } = renderGroup()
    expect(document.activeElement).not.toBe(field())
    expect(fireEvent.mouseDown(label)).toBe(true)
  })

  it("leaves the field and any interactive child of the group to their own default", () => {
    const { raw } = renderGroup()
    field().focus()
    //cancelling a press on the field itself would break caret placement
    expect(fireEvent.mouseDown(field())).toBe(true)
    expect(fireEvent.mouseDown(raw)).toBe(true)
  })
})

describe("Input — clear() is an edit React sees", () => {
  //`clear()` exists for a Tier 2 clear button, and that button is almost always on a
  //controlled field: if React's value tracker is told about "" before the `input`
  //event runs, `onChange` never fires and the field shows "" over stale state
  it("a controlled field's state follows the DOM to empty", () => {
    const ref = createRef<InputHandle>()
    function Search() {
      const [value, setValue] = useState("hello")
      return (
        <>
          <Input
            ref={ref}
            aria-label="q"
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
          <output data-testid="state">{value}</output>
        </>
      )
    }
    render(<Search />)

    act(() => ref.current?.clear())

    expect(field().value).toBe("")
    expect(screen.getByTestId("state").textContent).toBe("")
  })

  it("an uncontrolled field's onChange runs once, with the empty value", () => {
    const ref = createRef<InputHandle>()
    const onChange = vi.fn(
      (e: { target: HTMLInputElement }) => e.target.value,
    )
    render(
      <Input
        ref={ref}
        aria-label="q"
        defaultValue="hello"
        onChange={onChange}
      />,
    )

    act(() => ref.current?.clear())

    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange.mock.results[0]?.value).toBe("")
    expect(ref.current?.value).toBe("")
  })
})

describe("Input — onSubmitKey", () => {
  it("fires once on Enter, cancels the key and stops it bubbling, and still calls onKeyDown", () => {
    const onSubmitKey = vi.fn()
    const onKeyDown = vi.fn()
    const onParentKeyDown = vi.fn()
    render(
      // biome-ignore lint/a11y/noStaticElementInteractions: a bubbling probe, not a control
      <div onKeyDown={onParentKeyDown}>
        <Input
          aria-label="q"
          onSubmitKey={onSubmitKey}
          onKeyDown={onKeyDown}
        />
      </div>,
    )
    const notCancelled = fireEvent.keyDown(field(), { key: "Enter" })
    expect(onSubmitKey).toHaveBeenCalledTimes(1)
    expect(notCancelled).toBe(false)
    expect(onParentKeyDown).not.toHaveBeenCalled()
    expect(onKeyDown).toHaveBeenCalledTimes(1)
    expect((onKeyDown.mock.calls[0]?.[0] as KeyboardEvent).key).toBe(
      "Enter",
    )
  })

  it("Shift+Enter and other keys are not a submit", () => {
    const onSubmitKey = vi.fn()
    const onParentKeyDown = vi.fn()
    render(
      // biome-ignore lint/a11y/noStaticElementInteractions: a bubbling probe, not a control
      <div onKeyDown={onParentKeyDown}>
        <Input aria-label="q" onSubmitKey={onSubmitKey} />
      </div>,
    )
    expect(
      fireEvent.keyDown(field(), { key: "Enter", shiftKey: true }),
    ).toBe(true)
    expect(fireEvent.keyDown(field(), { key: "a" })).toBe(true)
    expect(onSubmitKey).not.toHaveBeenCalled()
    expect(onParentKeyDown).toHaveBeenCalledTimes(2)
  })

  it("is ignored on a touch device, where Enter belongs to the soft keyboard", () => {
    stubTouchDevice()
    const onSubmitKey = vi.fn()
    const onKeyDown = vi.fn()
    render(
      <Input
        aria-label="q"
        onSubmitKey={onSubmitKey}
        onKeyDown={onKeyDown}
      />,
    )
    expect(fireEvent.keyDown(field(), { key: "Enter" })).toBe(true)
    expect(onSubmitKey).not.toHaveBeenCalled()
    expect(onKeyDown).toHaveBeenCalledTimes(1)
  })

  it("a disabled field never submits, even while it still holds focus", () => {
    //WebKit moves focus off a field that turns disabled only at its next
    //rendering update, so an Enter inside that frame still reaches keydown
    const onSubmitKey = vi.fn()
    const onKeyDown = vi.fn()
    render(
      <Input
        aria-label="q"
        disabled
        onSubmitKey={onSubmitKey}
        onKeyDown={onKeyDown}
      />,
    )
    expect(fireEvent.keyDown(field(), { key: "Enter" })).toBe(true)
    expect(onSubmitKey).not.toHaveBeenCalled()
    expect(onKeyDown).toHaveBeenCalledTimes(1)
  })

  it("without onSubmitKey, Enter is left to the form", () => {
    render(<Input aria-label="q" />)
    expect(fireEvent.keyDown(field(), { key: "Enter" })).toBe(true)
  })
})

describe("Input — imperative handle", () => {
  it("reads the live value and disabled state from the DOM", () => {
    const ref = createRef<InputHandle>()
    const { rerender } = render(
      <Input ref={ref} aria-label="q" defaultValue="hi" />,
    )
    expect(ref.current?.value).toBe("hi")
    expect(ref.current?.disabled).toBe(false)

    fireEvent.change(field(), { target: { value: "typed" } })
    expect(ref.current?.value).toBe("typed")

    rerender(<Input ref={ref} aria-label="q" defaultValue="hi" disabled />)
    expect(ref.current?.disabled).toBe(true)
  })

  it("`grouped` follows the children across renders, not the first one", () => {
    const ref = createRef<InputHandle>()
    const { rerender } = render(<Input ref={ref} aria-label="q" />)
    expect(ref.current?.grouped).toBe(false)

    rerender(
      <Input ref={ref} aria-label="q">
        <Input.Leading>icon</Input.Leading>
      </Input>,
    )
    expect(ref.current?.grouped).toBe(true)

    rerender(<Input ref={ref} aria-label="q" />)
    expect(ref.current?.grouped).toBe(false)
  })

  it("focus() focuses the underlying <input>", () => {
    const ref = createRef<InputHandle>()
    render(
      <Input ref={ref} aria-label="q">
        <Input.Leading>icon</Input.Leading>
      </Input>,
    )
    ref.current?.focus()
    expect(document.activeElement).toBe(field())
  })

  it("clear() empties the field and dispatches bubbling native input and change", () => {
    const ref = createRef<InputHandle>()
    render(<Input ref={ref} aria-label="q" defaultValue="hello" />)
    const seen: string[] = []
    const onEvent = (e: Event) => {
      seen.push(
        `${e.type}:${e.bubbles}:${(e.target as HTMLInputElement).value}`,
      )
    }
    document.addEventListener("input", onEvent)
    document.addEventListener("change", onEvent)
    restores.push(() => {
      document.removeEventListener("input", onEvent)
      document.removeEventListener("change", onEvent)
    })

    ref.current?.clear()

    expect(field().value).toBe("")
    expect(ref.current?.value).toBe("")
    expect(seen).toEqual(["input:true:", "change:true:"])
  })
})
