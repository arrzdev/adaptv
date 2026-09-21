import { act, fireEvent, render } from "@testing-library/react"
import type { ReactNode } from "react"
import { useState } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  resetBackChain,
  runBackChain,
} from "#adaptv/capabilities/back-chain"
import { gestureController } from "#adaptv/capabilities/gesture-controller"
import { Select, useSelect } from "#adaptv/components/select"
import { compileAdaptvStyles } from "#adaptv/styles/compile.test-helper"

/*
 * Select — the menu-on-every-target picker. Every quirk the header of select.tsx
 * claims to own is pinned here: the hidden native `<select>` that carries the form
 * value and takes autofill but is never the thing the user touches, the keyboard
 * contract on the trigger and in the list, typeahead, the dismissal paths (outside
 * press, Escape, the back chain), the ARIA wiring, and the presence-attribute
 * spelling (`data-select-open`, never `data-state`).
 */

afterEach(() => {
  resetBackChain()
  vi.useRealTimers()
})

type Fixture = {
  value?: string
  defaultValue?: string
  onValueChange?: (value: string) => void
  disabled?: boolean
  required?: boolean
  placeholder?: string
  name?: string
  disableAvocado?: boolean
}

/** Apple / Avocado / Banana, with Avocado optionally disabled. */
function Fruit({ disableAvocado = false, ...props }: Fixture) {
  return (
    <Select aria-label="Fruit" placeholder="Pick a fruit" {...props}>
      <Select.Trigger />
      <Select.Content>
        <Select.Option value="apple">Apple</Select.Option>
        <Select.Option value="avocado" disabled={disableAvocado}>
          Avocado
        </Select.Option>
        <Select.Option value="banana">Banana</Select.Option>
      </Select.Content>
    </Select>
  )
}

function mount(props: Fixture = {}) {
  const utils = render(<Fruit {...props} />)
  const { container } = utils
  const q = <T extends Element>(selector: string) =>
    container.querySelector<T>(selector)
  const root = () => {
    const el = q<HTMLDivElement>('[data-adaptv="select"]')
    if (!el) throw new Error("no root")
    return el
  }
  const trigger = () => {
    const el = q<HTMLButtonElement>('[data-adaptv="select-trigger"]')
    if (!el) throw new Error("no trigger")
    return el
  }
  const native = () => {
    const el = q<HTMLSelectElement>("select")
    if (!el) throw new Error("no native select")
    return el
  }
  const listbox = () => q<HTMLDivElement>('[data-adaptv="select-content"]')
  const option = (value: string) =>
    q<HTMLDivElement>(
      `[data-adaptv="select-option"][data-value="${value}"]`,
    )
  const highlighted = () =>
    q<HTMLDivElement>("[data-highlighted]")?.getAttribute("data-value") ??
    null
  const openWith = (key: string) => {
    fireEvent.keyDown(trigger(), { key })
    const el = listbox()
    if (!el) throw new Error(`"${key}" did not open the list`)
    return el
  }
  const press = (key: string) => {
    const el = listbox()
    if (!el) throw new Error("the list is not open")
    fireEvent.keyDown(el, { key })
  }
  return {
    ...utils,
    root,
    trigger,
    native,
    listbox,
    option,
    highlighted,
    openWith,
    press,
  }
}

describe("Select — value and placeholder", () => {
  it("shows the placeholder, and says so, while nothing is selected", () => {
    const s = mount()
    const value = s.trigger().querySelector('[data-adaptv="select-value"]')
    expect(value?.textContent).toBe("Pick a fruit")
    expect(value?.hasAttribute("data-placeholder")).toBe(true)
    expect(s.trigger().hasAttribute("data-placeholder")).toBe(true)
    expect(s.root().hasAttribute("data-placeholder")).toBe(true)
    expect(s.native().value).toBe("")
  })

  it("shows the selected option's label for a defaultValue, and mirrors it natively", () => {
    const s = mount({ defaultValue: "banana", name: "fruit" })
    expect(s.trigger().textContent).toBe("Banana")
    expect(s.root().hasAttribute("data-placeholder")).toBe(false)
    expect(s.native().value).toBe("banana")
    expect(s.native().name).toBe("fruit")
    //every registered option is a real <option>, after the placeholder one
    expect([...s.native().options].map((o) => o.value)).toEqual([
      "",
      "apple",
      "avocado",
      "banana",
    ])
  })

  it("lets a Select.Value placeholder beat the root's", () => {
    const { container } = render(
      <Select placeholder="root">
        <Select.Trigger>
          <Select.Value placeholder="local" />
        </Select.Trigger>
        <Select.Content>
          <Select.Option value="a">A</Select.Option>
        </Select.Content>
      </Select>,
    )
    expect(
      container.querySelector('[data-adaptv="select-value"]')?.textContent,
    ).toBe("local")
  })

  it("the controlled value wins over a click-pick until the parent agrees", () => {
    const onValueChange = vi.fn()
    const s = mount({ value: "apple", onValueChange })
    fireEvent.click(s.trigger())
    fireEvent.click(s.option("banana") as Element)
    expect(onValueChange).toHaveBeenCalledWith("banana")
    //the parent did not update, so nothing changed
    expect(s.trigger().textContent).toBe("Apple")
    expect(s.native().value).toBe("apple")
  })

  it("follows a controlled parent that does update", () => {
    function Parent() {
      const [v, setV] = useState("apple")
      return <Fruit value={v} onValueChange={setV} />
    }
    const { container } = render(<Parent />)
    const trigger = container.querySelector(
      '[data-adaptv="select-trigger"]',
    ) as HTMLButtonElement
    fireEvent.click(trigger)
    fireEvent.click(
      container.querySelector('[data-value="banana"]') as Element,
    )
    expect(trigger.textContent).toBe("Banana")
    expect(container.querySelector("select")?.value).toBe("banana")
  })

  it("an uncontrolled click-pick updates the native select and fires once", () => {
    const onValueChange = vi.fn()
    const s = mount({ onValueChange })
    fireEvent.click(s.trigger())
    expect(s.listbox()).not.toBeNull()
    fireEvent.click(s.option("banana") as Element)
    expect(onValueChange).toHaveBeenCalledTimes(1)
    expect(onValueChange).toHaveBeenCalledWith("banana")
    expect(s.native().value).toBe("banana")
    expect(s.trigger().textContent).toBe("Banana")
    //the pick closed the list
    expect(s.listbox()).toBeNull()
    expect(s.root().hasAttribute("data-select-open")).toBe(false)
  })

  it("picking the already-selected value again does not fire", () => {
    const onValueChange = vi.fn()
    const s = mount({ defaultValue: "banana", onValueChange })
    fireEvent.click(s.trigger())
    fireEvent.click(s.option("banana") as Element)
    expect(onValueChange).not.toHaveBeenCalled()
    expect(s.listbox()).toBeNull()
  })

  it("browser autofill on the hidden native select updates the value", () => {
    //the only thing that reaches the native onChange: the user never focuses it
    const onValueChange = vi.fn()
    const s = mount({ onValueChange })
    fireEvent.change(s.native(), { target: { value: "avocado" } })
    expect(onValueChange).toHaveBeenCalledTimes(1)
    expect(onValueChange).toHaveBeenCalledWith("avocado")
    expect(s.trigger().textContent).toBe("Avocado")
    expect(s.root().hasAttribute("data-placeholder")).toBe(false)
  })

  it("a disabled option cannot be picked by pointer", () => {
    const onValueChange = vi.fn()
    const s = mount({ onValueChange, disableAvocado: true })
    fireEvent.click(s.trigger())
    const avocado = s.option("avocado") as HTMLElement
    expect(avocado.hasAttribute("data-disabled")).toBe(true)
    expect(avocado.getAttribute("aria-disabled")).toBe("true")
    fireEvent.click(avocado)
    expect(onValueChange).not.toHaveBeenCalled()
    expect(s.listbox()).not.toBeNull()
  })
})

describe("Select — the native select is for the form, never for the finger", () => {
  it("is mounted but hidden from focus order and assistive tech", () => {
    const s = mount({ required: true })
    const native = s.native()
    expect(native.tabIndex).toBe(-1)
    expect(native.getAttribute("aria-hidden")).toBe("true")
    expect(native.required).toBe(true)
    expect(s.root().hasAttribute("data-required")).toBe(true)
  })

  it("opening the list never focuses the native select", () => {
    const s = mount()
    fireEvent.click(s.trigger())
    expect(document.activeElement).not.toBe(s.native())
    expect(document.activeElement).toBe(s.listbox())
  })
})

describe("Select — disabled", () => {
  it("ignores clicks and keys, and spells data-disabled on root, trigger and native select", () => {
    const onValueChange = vi.fn()
    const s = mount({ disabled: true, onValueChange })
    expect(s.root().hasAttribute("data-disabled")).toBe(true)
    expect(s.trigger().hasAttribute("data-disabled")).toBe(true)
    expect(s.trigger().disabled).toBe(true)
    expect(s.native().hasAttribute("data-disabled")).toBe(true)
    expect(s.native().disabled).toBe(true)

    fireEvent.click(s.trigger())
    expect(s.listbox()).toBeNull()
    fireEvent.keyDown(s.trigger(), { key: "ArrowDown" })
    expect(s.listbox()).toBeNull()
    fireEvent.keyDown(s.trigger(), { key: "Enter" })
    expect(s.listbox()).toBeNull()
    expect(onValueChange).not.toHaveBeenCalled()
  })
})

describe("Select — disabled while open", () => {
  it("closes the list when disabled flips true underneath it, so no row is left to pick", () => {
    const onValueChange = vi.fn()
    const s = mount({ onValueChange })
    s.openWith("ArrowDown")
    expect(s.listbox()).not.toBeNull()
    const banana = s.option("banana")
    if (!banana) throw new Error("no banana")
    s.rerender(<Fruit disabled onValueChange={onValueChange} />)
    expect(s.listbox(), "a disabled Select has no open list").toBeNull()
    expect(s.trigger().getAttribute("aria-expanded")).toBe("false")
    //the row the finger was already over went with the list; a click that
    //still reaches it reaches nothing
    fireEvent.click(banana)
    expect(onValueChange).not.toHaveBeenCalled()
    expect(s.native().value).toBe("")
  })
})

describe("Select — the keyboard highlight is kept in view", () => {
  it("scrolls the row a key moved the highlight to into view, nearest edge", () => {
    const scrollIntoView = vi.spyOn(
      HTMLElement.prototype,
      "scrollIntoView",
    )
    try {
      const s = mount()
      s.openWith("ArrowDown")
      //opening brings the seeded row into view; that call is not the claim
      scrollIntoView.mockClear()
      s.press("ArrowDown")
      expect(s.highlighted()).toBe("avocado")
      expect(scrollIntoView).toHaveBeenCalledTimes(1)
      expect(scrollIntoView.mock.instances[0]).toBe(s.option("avocado"))
      expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest" })
      s.press("End")
      expect(scrollIntoView.mock.instances[1]).toBe(s.option("banana"))
      //typeahead moves the highlight the same way
      s.press("a")
      expect(s.highlighted()).toBe("apple")
      expect(scrollIntoView.mock.instances[2]).toBe(s.option("apple"))
    } finally {
      scrollIntoView.mockRestore()
    }
  })

  it("never scrolls for a pointer highlight: the row under the pointer must not move", () => {
    const scrollIntoView = vi.spyOn(
      HTMLElement.prototype,
      "scrollIntoView",
    )
    try {
      const s = mount()
      s.openWith("ArrowDown")
      scrollIntoView.mockClear()
      const banana = s.option("banana")
      if (!banana) throw new Error("no banana")
      fireEvent.pointerMove(banana)
      expect(s.highlighted()).toBe("banana")
      expect(scrollIntoView).not.toHaveBeenCalled()
    } finally {
      scrollIntoView.mockRestore()
    }
  })
})

describe("Select — keyboard on the trigger", () => {
  it("ArrowDown opens with the highlight on the selected option", () => {
    const s = mount({ defaultValue: "banana" })
    s.openWith("ArrowDown")
    expect(s.highlighted()).toBe("banana")
    expect(s.root().hasAttribute("data-select-open")).toBe(true)
  })

  it("ArrowUp opens too, and seeds the first enabled option when nothing is selected", () => {
    const s = mount()
    s.openWith("ArrowUp")
    expect(s.highlighted()).toBe("apple")
  })

  it("Enter and Space open the list, and prevent the button's own activation", () => {
    for (const key of ["Enter", " "]) {
      const s = mount()
      const event = new KeyboardEvent("keydown", {
        key,
        bubbles: true,
        cancelable: true,
      })
      fireEvent(s.trigger(), event)
      expect(event.defaultPrevented).toBe(true)
      expect(s.listbox()).not.toBeNull()
      s.unmount()
    }
  })

  it("a click toggles: open, then closed", () => {
    const s = mount()
    fireEvent.click(s.trigger())
    expect(s.listbox()).not.toBeNull()
    fireEvent.click(s.trigger())
    expect(s.listbox()).toBeNull()
  })
})

describe("Select — keyboard in the list", () => {
  it("ArrowDown / ArrowUp skip a disabled option and do not wrap", () => {
    const s = mount({ disableAvocado: true })
    s.openWith("ArrowDown")
    expect(s.highlighted()).toBe("apple")
    s.press("ArrowDown")
    expect(s.highlighted()).toBe("banana")
    s.press("ArrowDown")
    //the end: no wrap back to apple
    expect(s.highlighted()).toBe("banana")
    s.press("ArrowUp")
    expect(s.highlighted()).toBe("apple")
    s.press("ArrowUp")
    expect(s.highlighted()).toBe("apple")
  })

  it("Home and End jump to the first and last enabled option", () => {
    const s = mount({ defaultValue: "avocado" })
    s.openWith("ArrowDown")
    expect(s.highlighted()).toBe("avocado")
    s.press("End")
    expect(s.highlighted()).toBe("banana")
    s.press("Home")
    expect(s.highlighted()).toBe("apple")
  })

  it("Enter picks the highlighted option, closes, and returns focus to the trigger", () => {
    const onValueChange = vi.fn()
    const s = mount({ onValueChange })
    s.openWith("ArrowDown")
    expect(document.activeElement).toBe(s.listbox())
    s.press("ArrowDown")
    s.press("Enter")
    expect(onValueChange).toHaveBeenCalledTimes(1)
    expect(onValueChange).toHaveBeenCalledWith("avocado")
    expect(s.listbox()).toBeNull()
    expect(document.activeElement).toBe(s.trigger())
  })

  it("Space picks like Enter", () => {
    const onValueChange = vi.fn()
    const s = mount({ onValueChange })
    s.openWith("ArrowDown")
    s.press(" ")
    expect(onValueChange).toHaveBeenCalledWith("apple")
    expect(s.listbox()).toBeNull()
  })

  it("Escape closes without changing the value and refocuses the trigger", () => {
    const onValueChange = vi.fn()
    const s = mount({ defaultValue: "apple", onValueChange })
    s.openWith("ArrowDown")
    s.press("ArrowDown")
    expect(s.highlighted()).toBe("avocado")
    s.press("Escape")
    expect(s.listbox()).toBeNull()
    expect(onValueChange).not.toHaveBeenCalled()
    expect(s.trigger().textContent).toBe("Apple")
    expect(document.activeElement).toBe(s.trigger())
  })

  it("Escape does not bubble past the list to whatever sits behind it", () => {
    const behind = vi.fn()
    const s = mount()
    s.openWith("ArrowDown")
    window.addEventListener("keydown", behind)
    try {
      s.press("Escape")
      expect(behind).not.toHaveBeenCalled()
    } finally {
      window.removeEventListener("keydown", behind)
    }
  })

  it("Tab closes and hands focus back to the trigger without swallowing the key", () => {
    const s = mount()
    s.openWith("ArrowDown")
    const event = new KeyboardEvent("keydown", {
      key: "Tab",
      bubbles: true,
      cancelable: true,
    })
    fireEvent(s.listbox() as Element, event)
    expect(event.defaultPrevented).toBe(false)
    expect(s.listbox()).toBeNull()
    expect(document.activeElement).toBe(s.trigger())
  })

  it("pointermove over an option highlights it", () => {
    const s = mount()
    fireEvent.click(s.trigger())
    expect(s.highlighted()).toBeNull()
    fireEvent.pointerMove(s.option("banana") as Element)
    expect(s.highlighted()).toBe("banana")
  })
})

describe("Select — typeahead", () => {
  it('"ba" reaches Banana over Apple and Avocado, and forgets after 500ms', () => {
    vi.useFakeTimers()
    const s = mount()
    s.openWith("ArrowDown")
    expect(s.highlighted()).toBe("apple")
    s.press("b")
    expect(s.highlighted()).toBe("banana")
    act(() => {
      vi.advanceTimersByTime(500)
    })
    s.press("Home")
    s.press("a")
    //"a" from apple moves to the NEXT match, avocado…
    expect(s.highlighted()).toBe("avocado")
    act(() => {
      vi.advanceTimersByTime(499)
    })
    s.press("v")
    //…and "av" within the window still reads as one word
    expect(s.highlighted()).toBe("avocado")
    act(() => {
      vi.advanceTimersByTime(500)
    })
    //the buffer is gone: "b" alone is a fresh search
    s.press("b")
    expect(s.highlighted()).toBe("banana")
  })

  it("skips a disabled match", () => {
    vi.useFakeTimers()
    const s = mount({ disableAvocado: true })
    s.openWith("ArrowDown")
    s.press("a")
    //apple is the highlight, avocado is disabled, so "a" wraps back to apple
    expect(s.highlighted()).toBe("apple")
    s.press("v")
    //"av" matches only the disabled option: the highlight stays put
    expect(s.highlighted()).toBe("apple")
  })

  it("is case-insensitive", () => {
    vi.useFakeTimers()
    const s = mount()
    s.openWith("ArrowDown")
    s.press("B")
    expect(s.highlighted()).toBe("banana")
  })
})

describe("Select — dismissal", () => {
  it("an outside pointerdown closes the list", () => {
    const s = mount()
    fireEvent.click(s.trigger())
    fireEvent.pointerDown(document.body)
    expect(s.listbox()).toBeNull()
  })

  it("a pointerdown inside the list does not", () => {
    const s = mount()
    fireEvent.click(s.trigger())
    fireEvent.pointerDown(s.option("apple") as Element)
    expect(s.listbox()).not.toBeNull()
  })

  it("an edge swipe closes the list through the back chain, not the outside press", () => {
    //The sequence the iOS simulator produced before the fix: the swipe's first
    //touch lands outside the list, `pointerdown` closed it, and by `touchend`
    //the back chain had nothing left to consume, so the swipe navigated. Touch
    //is now decided at `touchstart`, after the recogniser has claimed the
    //arbiter, and a claimed pointer is not a press.
    const s = mount()
    fireEvent.click(s.trigger())
    document.addEventListener(
      "touchstart",
      () => gestureController.requestCapture("edge-swipe", 400),
      { once: true },
    )
    fireEvent.pointerDown(document.body, { pointerType: "touch" })
    fireEvent.touchStart(document.body)
    expect(s.listbox()).not.toBeNull()
    //what the swipe's touchend does: run the chain, then let go of the pointer
    let consumed = false
    act(() => {
      consumed = runBackChain()
    })
    gestureController.release("edge-swipe")
    expect(consumed).toBe(true)
    expect(s.listbox()).toBeNull()
  })

  it("a plain touch outside the list closes it at touchstart", () => {
    const s = mount()
    fireEvent.click(s.trigger())
    fireEvent.pointerDown(document.body, { pointerType: "touch" })
    expect(s.listbox()).not.toBeNull()
    fireEvent.touchStart(document.body)
    expect(s.listbox()).toBeNull()
  })

  it("the back chain closes it while open, and defers while closed", () => {
    const s = mount()
    expect(runBackChain()).toBe(false)
    fireEvent.click(s.trigger())
    let consumed = false
    act(() => {
      consumed = runBackChain()
    })
    expect(consumed).toBe(true)
    expect(s.listbox()).toBeNull()
    expect(runBackChain()).toBe(false)
  })
})

describe("Select — ARIA and attributes", () => {
  it("wires the combobox to the listbox, and marks the selected option", () => {
    const s = mount({ defaultValue: "banana" })
    const trigger = s.trigger()
    expect(trigger.getAttribute("role")).toBe("combobox")
    expect(trigger.getAttribute("aria-haspopup")).toBe("listbox")
    expect(trigger.getAttribute("aria-expanded")).toBe("false")
    expect(trigger.getAttribute("aria-label")).toBe("Fruit")
    fireEvent.click(trigger)
    expect(trigger.getAttribute("aria-expanded")).toBe("true")
    const listbox = s.listbox() as HTMLElement
    expect(listbox.getAttribute("role")).toBe("listbox")
    expect(listbox.id).toBe(trigger.getAttribute("aria-controls"))
    expect(listbox.tabIndex).toBe(-1)
    expect(s.option("banana")?.getAttribute("aria-selected")).toBe("true")
    expect(s.option("apple")?.getAttribute("aria-selected")).toBe("false")
    expect(s.option("banana")?.hasAttribute("data-selected")).toBe(true)
    expect(s.option("apple")?.hasAttribute("data-selected")).toBe(false)
    //the highlighted row is the active descendant
    expect(listbox.getAttribute("aria-activedescendant")).toBe(
      s.option("banana")?.id,
    )
  })

  it("the open content carries the resolved side and align", () => {
    const s = mount()
    fireEvent.click(s.trigger())
    const listbox = s.listbox() as HTMLElement
    expect(listbox.getAttribute("data-side")).toBe("bottom")
    expect(listbox.getAttribute("data-align")).toBe("start")
    expect(listbox.style.position).toBe("fixed")
  })

  it("spells presence attributes, and never data-state", () => {
    const s = mount({ defaultValue: "apple", disableAvocado: true })
    fireEvent.click(s.trigger())
    expect(s.root().getAttribute("data-select-open")).toBe("")
    expect(s.option("apple")?.getAttribute("data-selected")).toBe("")
    expect(s.option("apple")?.getAttribute("data-highlighted")).toBe("")
    expect(s.option("avocado")?.getAttribute("data-disabled")).toBe("")
    expect(s.container.querySelector("[data-state]")).toBeNull()
    fireEvent.pointerDown(document.body)
    expect(s.root().hasAttribute("data-select-open")).toBe(false)
  })

  it("every part answers to its own data-adaptv name", () => {
    const s = mount()
    fireEvent.click(s.trigger())
    for (const name of [
      "select",
      "select-trigger",
      "select-value",
      "select-content",
      "select-option",
    ]) {
      expect(
        s.container.querySelector(`[data-adaptv="${name}"]`),
        name,
      ).not.toBeNull()
    }
  })
})

describe("Select — useSelect", () => {
  it("throws outside a Select", () => {
    function Probe() {
      useSelect()
      return null
    }
    const spy = vi.spyOn(console, "error").mockImplementation(() => {})
    try {
      expect(() => render(<Probe />)).toThrow(
        "useSelect must be used within <Select>.",
      )
    } finally {
      spy.mockRestore()
    }
  })

  it("reads value, open and disabled inside", () => {
    const seen: Array<ReturnType<typeof useSelect>> = []
    function Probe({ children }: { children?: ReactNode }) {
      seen.push(useSelect())
      return <>{children}</>
    }
    const { container } = render(
      <Select defaultValue="a" disabled>
        <Probe />
        <Select.Trigger />
        <Select.Content>
          <Select.Option value="a">A</Select.Option>
        </Select.Content>
      </Select>,
    )
    expect(seen.at(-1)).toEqual({
      value: "a",
      open: false,
      disabled: true,
    })
    expect(
      container.querySelector('[data-adaptv="select"]'),
    ).not.toBeNull()
  })
})

describe("Select.Option — the press-target contract", () => {
  function optionEl(props: { className?: string; disabled?: boolean }) {
    const { container } = render(
      <Select>
        <Select.Trigger />
        <Select.Content>
          <Select.Option value="a" {...props}>
            A
          </Select.Option>
        </Select.Content>
      </Select>,
    )
    fireEvent.click(
      container.querySelector('[data-adaptv="select-trigger"]') as Element,
    )
    const el = container.querySelector<HTMLElement>(
      '[data-adaptv="select-option"]',
    )
    if (!el) throw new Error("Select.Option did not render")
    return el
  }
  const classList = (el: Element) =>
    el.className.split(/\s+/).filter(Boolean)

  it("carries the touch-action longhand the stylesheet emits, never touch-manipulation", async () => {
    const classes = classList(optionEl({}))
    expect(classes).toContain("touch-pan-x")
    expect(classes).toContain("touch-pan-y")
    expect(classes).toContain("touch-pinch-zoom")
    expect(classes).not.toContain("touch-manipulation")
    const css = await compileAdaptvStyles(classes)
    expect(css).toContain("touch-action:")
    expect(css).toContain("cursor: pointer")
  })

  it("keeps the touch pass-through when a className fights it, on a live and a disabled row", () => {
    for (const disabled of [false, true]) {
      const classes = classList(
        optionEl({ className: "touch-none touch-manipulation", disabled }),
      )
      expect(classes).toContain("touch-pan-x")
      expect(classes).not.toContain("touch-none")
      expect(classes).not.toContain("touch-manipulation")
    }
  })

  it("lets a consumer's cursor win", () => {
    const classes = classList(optionEl({ className: "cursor-wait" }))
    expect(classes).toContain("cursor-wait")
    expect(classes).not.toContain("cursor-pointer")
  })
})
