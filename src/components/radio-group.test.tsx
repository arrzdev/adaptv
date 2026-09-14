import { act, fireEvent, render } from "@testing-library/react"
import { createRef, useState } from "react"
import { describe, expect, it, vi } from "vitest"
import type {
  RadioGroupHandle,
  RadioGroupItemHandle,
} from "#adaptv/components/radio-group"
import { RadioGroup } from "#adaptv/components/radio-group"

/**
 * RadioGroup — native radios, one per item, laid over the item.
 *
 * Two facts make it a primitive rather than markup (component-gaps, #158):
 *
 * - a radio group is keyed on `name` within one document or form, so a component
 *   that defaulted to a literal name would make every mounted instance ONE group,
 *   each selection clearing the others — hence the per-instance default name;
 * - a clipped `sr-only` input gives the radio a speck-sized accessibility frame on
 *   iOS Safari, so the input lies over the whole item (PR #132's Switch and
 *   Checkbox fix, mirrored).
 *
 * Real layout, arrow keys and Tab are measured in `playground/e2e/radio-group.spec.ts`
 * on chromium and webkit; happy-dom computes no layout and has no radio keyboard
 * behaviour, so this file pins the contract that produces them and the selection
 * rules: one `onValueChange` per selection, whatever produced the click.
 */

function itemsOf(container: HTMLElement): HTMLElement[] {
  const items = [
    ...container.querySelectorAll<HTMLElement>("[data-part='item']"),
  ]
  for (const label of items) {
    //happy-dom has no Pointer Capture API; the engine claims the pointer on the
    //element its handlers are bound to, which is the item's label
    label.setPointerCapture ??= () => {}
    label.releasePointerCapture ??= () => {}
  }
  return items
}

function radios(container: HTMLElement): HTMLInputElement[] {
  itemsOf(container)
  return [...container.querySelectorAll<HTMLInputElement>("input")]
}

/** A finger on the item: the events target the input laid over it. */
function tap(input: HTMLElement): void {
  const pointer = { pointerId: 1, button: 0, isPrimary: true }
  fireEvent.pointerDown(input, pointer)
  fireEvent.pointerUp(input, pointer)
  //the click the browser fires after the release carries a click count
  fireEvent.click(input, { detail: 1 })
}

/**
 * A form reset in the HTML algorithm's order: the cancelable `reset` event first,
 * then, unless it was cancelled, every radio back on its `defaultChecked`.
 * happy-dom's `form.reset()` resets the controls BEFORE the event and ignores a
 * cancel, so a prevented reset would move its DOM where no browser's moves.
 */
function resetInSpecOrder(form: HTMLFormElement): void {
  const proceed = form.dispatchEvent(
    new Event("reset", { bubbles: true, cancelable: true }),
  )
  if (!proceed) return
  for (const control of form.elements) {
    if (control instanceof HTMLInputElement) {
      control.checked = control.defaultChecked
    }
  }
}

/** Run the task the group's reset listener schedules, and what it renders. */
async function flushResetTask(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 10))
  })
}

/** Space on a focused radio: the browser clicks it on keyup, with detail 0. */
function pressSpace(input: HTMLElement): void {
  fireEvent.keyDown(input, { key: " " })
  fireEvent.keyUp(input, { key: " " })
  fireEvent.click(input, { detail: 0 })
}

function Plans({
  onValueChange,
  name,
  defaultValue,
}: {
  onValueChange?: (value: string | null) => void
  name?: string
  defaultValue?: string
}) {
  return (
    <RadioGroup
      aria-label="Plan"
      name={name}
      defaultValue={defaultValue}
      onValueChange={onValueChange}
    >
      <RadioGroup.Item value="monthly">Monthly</RadioGroup.Item>
      <RadioGroup.Item value="yearly">Yearly</RadioGroup.Item>
      <RadioGroup.Item value="lifetime">Lifetime</RadioGroup.Item>
    </RadioGroup>
  )
}

function ControlledPlans({
  onValueChange,
  frozen = false,
  initial = "monthly",
  defaultValue,
}: {
  onValueChange: (value: string | null) => void
  frozen?: boolean
  initial?: string | null
  defaultValue?: string
}) {
  const [plan, setPlan] = useState<string | null>(initial)
  return (
    <>
      <RadioGroup
        aria-label="Plan"
        value={plan}
        defaultValue={defaultValue}
        onValueChange={(next) => {
          onValueChange(next)
          if (!frozen) setPlan(next)
        }}
      >
        <RadioGroup.Item value="monthly">Monthly</RadioGroup.Item>
        <RadioGroup.Item value="yearly">Yearly</RadioGroup.Item>
      </RadioGroup>
      <output>{plan}</output>
    </>
  )
}

describe("RadioGroup — structure", () => {
  it("is a named radiogroup of native radios, each named by its item's content", () => {
    const { getByRole, getAllByRole } = render(<Plans />)
    const group = getByRole("radiogroup", { name: "Plan" })
    expect(group.getAttribute("data-adaptv")).toBe("radio-group")
    expect(group.getAttribute("aria-orientation")).toBe("vertical")
    const all = getAllByRole("radio")
    expect(all).toHaveLength(3)
    expect(getByRole("radio", { name: "Yearly" })).toBe(all[1])
    for (const radio of all) {
      expect(radio.getAttribute("type")).toBe("radio")
      expect(radio.closest("[role='radiogroup']")).toBe(group)
    }
  })

  it("stamps the item identity and its state as presence attributes", () => {
    const { container } = render(
      <RadioGroup defaultValue="b">
        <RadioGroup.Item value="a">a</RadioGroup.Item>
        <RadioGroup.Item value="b">b</RadioGroup.Item>
        <RadioGroup.Item value="c" disabled>
          c
        </RadioGroup.Item>
      </RadioGroup>,
    )
    const [a, b, c] = itemsOf(container)
    for (const item of [a, b, c]) {
      expect(item.tagName).toBe("LABEL")
      //the identity is the group's alone: the item is a part of it
      expect(item.hasAttribute("data-adaptv")).toBe(false)
    }
    const identified = container.querySelectorAll(
      "[data-adaptv='radio-group']",
    )
    expect(identified).toHaveLength(1)
    expect(identified[0].getAttribute("role")).toBe("radiogroup")
    expect(identified[0].getAttribute("data-part")).toBe("root")
    expect(a.hasAttribute("data-checked")).toBe(false)
    expect(b.getAttribute("data-checked")).toBe("")
    expect(c.getAttribute("data-disabled")).toBe("")
    expect(a.hasAttribute("data-disabled")).toBe(false)
  })

  it("places a default box before the content, and none when the content has its own", () => {
    const { container } = render(
      <RadioGroup>
        <RadioGroup.Item value="a">Alpha</RadioGroup.Item>
        <RadioGroup.Item value="b">
          Beta
          <RadioGroup.Box className="ms-auto" />
        </RadioGroup.Item>
      </RadioGroup>,
    )
    const [a, b] = itemsOf(container)
    expect(a.querySelectorAll("[data-part='box']")).toHaveLength(1)
    expect(a.firstElementChild?.getAttribute("data-part")).toBe("box")
    expect(b.querySelectorAll("[data-part='box']")).toHaveLength(1)
    expect(b.querySelector("[data-part='box']")?.className).toContain(
      "ms-auto",
    )
    //a box with no children still draws the mark
    expect(
      b.querySelector("[data-part='box'] [data-part='indicator']"),
    ).not.toBeNull()
  })

  it("finds a Tier 2 box wrapper by its displayName, and draws no default box beside it", () => {
    //the wrapper is a component of the consumer's, so its element type is never
    //RadioGroup.Box: only the displayName convention Checkbox uses identifies it
    function BrandBox() {
      return <RadioGroup.Box className="ring-1" />
    }
    BrandBox.displayName = "RadioGroup.Box"
    const { container } = render(
      <RadioGroup>
        <RadioGroup.Item value="a">
          <BrandBox />
          Alpha
        </RadioGroup.Item>
      </RadioGroup>,
    )
    const [item] = itemsOf(container)
    const boxes = item.querySelectorAll("[data-part='box']")
    expect(boxes, "the wrapper's box, and no default one").toHaveLength(1)
    expect(boxes[0].className).toContain("ring-1")
    expect(item.firstElementChild).toBe(boxes[0])
  })

  it("renders its controlled inputs without a React warning", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {})
    try {
      render(
        <RadioGroup value="a">
          <RadioGroup.Item value="a">a</RadioGroup.Item>
        </RadioGroup>,
      )
      expect(error).not.toHaveBeenCalled()
    } finally {
      error.mockRestore()
    }
  })
})

describe("RadioGroup — the accessible element is the hit area", () => {
  it("lays each radio input over its whole item, invisibly", () => {
    const { container } = render(<Plans />)
    const items = itemsOf(container)
    for (const item of items) {
      const input = item.querySelector("input")
      if (!input) throw new Error("an item with no input")
      const classes = input.className.split(/\s+/)
      //its containing block is the item: a direct child of the positioned label
      expect(input.parentElement).toBe(item)
      expect(item.className.split(/\s+/)).toContain("relative")
      //and it fills that box exactly — no inset, no margin, no clip
      for (const cls of [
        "absolute",
        "inset-0",
        "size-full",
        "m-0",
        "opacity-0",
        "appearance-none",
      ]) {
        expect(classes, `the input carries ${cls}`).toContain(cls)
      }
      expect(classes, "a 1px clipped box is not a frame").not.toContain(
        "sr-only",
      )
    }
  })

  it("paints the input over the positioned box by order, not by z-index", () => {
    const { container } = render(<Plans />)
    for (const item of itemsOf(container)) {
      const input = item.querySelector("input")
      expect(item.lastElementChild).toBe(input)
      expect(input?.className).not.toMatch(/(^|\s)z-/)
    }
  })

  it("keeps the mark from taking the pointer", () => {
    const { container } = render(<Plans defaultValue="monthly" />)
    const mark = container.querySelector("[data-part='indicator']")
    expect(mark?.getAttribute("class")).toContain("pointer-events-none")
    expect(mark?.getAttribute("aria-hidden")).toBe("true")
  })
})

describe("RadioGroup — names", () => {
  it("gives every radio of one instance the same name, and two instances different ones", () => {
    const { container } = render(
      <>
        <Plans />
        <Plans />
      </>,
    )
    const all = radios(container)
    const first = new Set(all.slice(0, 3).map((r) => r.name))
    const second = new Set(all.slice(3).map((r) => r.name))
    expect(first.size).toBe(1)
    expect(second.size).toBe(1)
    const [a] = first
    const [b] = second
    expect(a).toBeTruthy()
    expect(b).toBeTruthy()
    expect(a).not.toBe(b)
  })

  it("two mounted instances with no name do not uncheck each other", () => {
    //A behavioural guard, not the literal-name catcher. In a browser a shared name
    //does show here: on a commit React blanks a radio's name, sets `checked`, then
    //restores the name, and restoring the name of a checked radio unchecks every
    //other radio of that group (which is how the literal-name mutant fails "two
    //instances" in the e2e spec on both engines). happy-dom unchecks the group only
    //when `checked` is set, never when a name changes, so this test cannot catch
    //that mutant; the `required` test below does.
    const first = vi.fn()
    const second = vi.fn()
    const { container } = render(
      <>
        <Plans defaultValue="monthly" onValueChange={first} />
        <Plans defaultValue="monthly" onValueChange={second} />
      </>,
    )
    const all = radios(container)
    expect(all[0].checked).toBe(true)
    expect(all[3].checked).toBe(true)

    tap(all[4])
    expect(second).toHaveBeenCalledTimes(1)
    expect(second).toHaveBeenLastCalledWith("yearly")
    expect(all[4].checked, "the second group selected yearly").toBe(true)
    expect(all[0].checked, "the first group kept monthly").toBe(true)
    expect(first).not.toHaveBeenCalled()

    tap(all[2])
    expect(all[2].checked, "the first group selected lifetime").toBe(true)
    expect(all[4].checked, "the second group kept yearly").toBe(true)
    expect(all.filter((r) => r.checked)).toHaveLength(2)
  })

  it("a selection in one unnamed group does not satisfy another group's `required`", () => {
    //The unit catcher for a shared default name. happy-dom does not uncheck a group
    //when React restores a radio's name (see the test above), but validity is keyed
    //on the name in happy-dom as in the spec: under one literal name a choice in the
    //first group would let the second submit with nothing chosen.
    const { container } = render(
      <form>
        <RadioGroup aria-label="Size" required>
          <RadioGroup.Item value="small">Small</RadioGroup.Item>
          <RadioGroup.Item value="large">Large</RadioGroup.Item>
        </RadioGroup>
        <RadioGroup aria-label="Colour" required>
          <RadioGroup.Item value="red">Red</RadioGroup.Item>
          <RadioGroup.Item value="blue">Blue</RadioGroup.Item>
        </RadioGroup>
      </form>,
    )
    const form = container.querySelector("form") as HTMLFormElement
    const [small, , red] = radios(container)

    tap(small)
    expect(small.checked).toBe(true)
    expect(
      red.validity.valueMissing,
      "the second group still has nothing chosen",
    ).toBe(true)
    expect(form.checkValidity()).toBe(false)

    tap(red)
    expect(red.validity.valueMissing).toBe(false)
    expect(small.checked, "the first group kept its choice").toBe(true)
    expect(form.checkValidity()).toBe(true)
  })

  it("keeps an explicit name on every radio", () => {
    const { container } = render(<Plans name="plan" />)
    expect(radios(container).map((r) => r.name)).toEqual([
      "plan",
      "plan",
      "plan",
    ])
  })
})

describe("RadioGroup — selection", () => {
  it("uncontrolled: defaultValue checks its item and a tap moves the selection", () => {
    const spy = vi.fn()
    const { container } = render(
      <Plans defaultValue="yearly" onValueChange={spy} />,
    )
    const [monthly, yearly, lifetime] = radios(container)
    expect(yearly.checked).toBe(true)

    tap(lifetime)
    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy).toHaveBeenLastCalledWith("lifetime")
    expect(lifetime.checked).toBe(true)
    expect(yearly.checked).toBe(false)
    expect(monthly.checked).toBe(false)
  })

  it("uncontrolled with no default selects nothing", () => {
    const { container } = render(<Plans />)
    expect(radios(container).some((r) => r.checked)).toBe(false)
  })

  it("controlled: the owner's value is what is checked", () => {
    const spy = vi.fn()
    const { container, getByText } = render(
      <ControlledPlans onValueChange={spy} />,
    )
    const [monthly, yearly] = radios(container)
    expect(monthly.checked).toBe(true)

    tap(yearly)
    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy).toHaveBeenLastCalledWith("yearly")
    expect(yearly.checked).toBe(true)
    expect(monthly.checked).toBe(false)
    expect(getByText("yearly")).toBeTruthy()
  })

  it("controlled: an owner that refuses keeps its value checked in the DOM", () => {
    const spy = vi.fn()
    const { container } = render(
      <ControlledPlans onValueChange={spy} frozen />,
    )
    const [monthly, yearly] = radios(container)

    tap(yearly)
    expect(spy).toHaveBeenCalledTimes(1)
    expect(monthly.checked, "the refused selection is rolled back").toBe(
      true,
    )
    expect(yearly.checked).toBe(false)

    //every attempt is reported, once each
    tap(yearly)
    expect(spy).toHaveBeenCalledTimes(2)
    expect(monthly.checked).toBe(true)
  })

  it("controlled: value={null} selects nothing, and a new value from the owner moves the check", () => {
    const { container, rerender } = render(
      <RadioGroup value={null}>
        <RadioGroup.Item value="a">a</RadioGroup.Item>
        <RadioGroup.Item value="b">b</RadioGroup.Item>
      </RadioGroup>,
    )
    const [a, b] = radios(container)
    expect(a.checked || b.checked).toBe(false)
    rerender(
      <RadioGroup value="b">
        <RadioGroup.Item value="a">a</RadioGroup.Item>
        <RadioGroup.Item value="b">b</RadioGroup.Item>
      </RadioGroup>,
    )
    expect(b.checked).toBe(true)
  })
})

describe("RadioGroup — one change per selection", () => {
  it("a tap fires onValueChange exactly once", () => {
    const spy = vi.fn()
    const { container } = render(<Plans onValueChange={spy} />)
    tap(radios(container)[1])
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it("a controlled tap the owner refuses still fires exactly once", () => {
    //the one ordering where a second activation path would show: the owner's
    //value never changes, so nothing de-duplicates a repeated report
    const spy = vi.fn()
    const { container } = render(
      <ControlledPlans onValueChange={spy} frozen />,
    )
    tap(radios(container)[1])
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it("Space on a focused radio fires exactly once", () => {
    const spy = vi.fn()
    const { container } = render(<Plans onValueChange={spy} />)
    const yearly = radios(container)[1]
    yearly.focus()
    pressSpace(yearly)
    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy).toHaveBeenLastCalledWith("yearly")
    expect(yearly.checked).toBe(true)
  })

  it("re-selecting the selected item fires nothing", () => {
    const spy = vi.fn()
    const { container } = render(
      <Plans defaultValue="monthly" onValueChange={spy} />,
    )
    const monthly = radios(container)[0]
    tap(monthly)
    pressSpace(monthly)
    expect(spy).not.toHaveBeenCalled()
    expect(monthly.checked).toBe(true)
  })

  it("a click no press produced selects: assistive tech, an outer label, the arrow keys", () => {
    //VoiceOver and TalkBack dispatch a click on the element, and the browser's own
    //arrow-key handling checks the next radio and clicks it — none has a press
    const spy = vi.fn()
    const { container } = render(<Plans onValueChange={spy} />)
    const lifetime = radios(container)[2]
    act(() => lifetime.click())
    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy).toHaveBeenLastCalledWith("lifetime")
    expect(lifetime.checked).toBe(true)
  })

  it("a press cancelled by a scroll does not swallow the next keyboard selection", () => {
    //a cancel arms the engine's veto for a trailing click that never comes; the
    //arrow key that later lands on this item must still select it
    const spy = vi.fn()
    const { container } = render(<Plans onValueChange={spy} />)
    const yearly = radios(container)[1]
    const pointer = { pointerId: 1, button: 0, isPrimary: true }
    fireEvent.pointerDown(yearly, pointer)
    fireEvent.pointerCancel(yearly, pointer)
    expect(spy).not.toHaveBeenCalled()

    fireEvent.click(yearly, { detail: 0 })
    expect(spy).toHaveBeenCalledTimes(1)
    expect(yearly.checked).toBe(true)
  })

  it("a press dragged off the item and released selects nothing", () => {
    const spy = vi.fn()
    const { container } = render(<Plans onValueChange={spy} />)
    const yearly = radios(container)[1]
    const pointer = { pointerId: 1, button: 0, isPrimary: true }
    fireEvent.pointerDown(yearly, { ...pointer, clientX: 0, clientY: 0 })
    fireEvent.pointerMove(yearly, {
      ...pointer,
      clientX: 500,
      clientY: 500,
    })
    fireEvent.pointerUp(yearly, { ...pointer, clientX: 500, clientY: 500 })
    //with the pointer captured, the browser still fires the click on the item
    fireEvent.click(yearly, { detail: 1 })
    expect(spy).not.toHaveBeenCalled()
    expect(yearly.checked).toBe(false)
  })
})

describe("RadioGroup — a press that fires no click", () => {
  it("a press dragged off with no click does not swallow a later click it did not produce", () => {
    //iOS fires no click after a touch dragged off the item, so the press's veto is
    //left armed. A later activation that carries a click count but no pointerdown
    //on the item (an assistive-tech activation, a forwarded label click) must select.
    let now = 10_000
    const clock = vi
      .spyOn(performance, "now")
      .mockImplementation(() => now)
    try {
      const spy = vi.fn()
      const { container } = render(<Plans onValueChange={spy} />)
      const yearly = radios(container)[1]
      const pointer = { pointerId: 1, button: 0, isPrimary: true }
      fireEvent.pointerDown(yearly, { ...pointer, clientX: 0, clientY: 0 })
      fireEvent.pointerMove(yearly, {
        ...pointer,
        clientX: 500,
        clientY: 500,
      })
      fireEvent.pointerUp(yearly, {
        ...pointer,
        clientX: 500,
        clientY: 500,
      })
      //no click follows the release
      now += 2_000
      fireEvent.click(yearly, { detail: 1 })
      expect(spy).toHaveBeenCalledTimes(1)
      expect(spy).toHaveBeenLastCalledWith("yearly")
      expect(yearly.checked).toBe(true)
    } finally {
      clock.mockRestore()
    }
  })

  it("the click iOS delivers 400 ms after a dragged-off release is still vetoed", () => {
    //iOS holds a tap's click for its double-tap wait, so the click a dragged-off
    //press produces can land hundreds of milliseconds after the release; the
    //window must still own it then, or that click selects the item left behind
    let now = 10_000
    const clock = vi
      .spyOn(performance, "now")
      .mockImplementation(() => now)
    try {
      const spy = vi.fn()
      const { container } = render(<Plans onValueChange={spy} />)
      const yearly = radios(container)[1]
      const pointer = { pointerId: 1, button: 0, isPrimary: true }
      fireEvent.pointerDown(yearly, { ...pointer, clientX: 0, clientY: 0 })
      fireEvent.pointerMove(yearly, {
        ...pointer,
        clientX: 500,
        clientY: 500,
      })
      fireEvent.pointerUp(yearly, {
        ...pointer,
        clientX: 500,
        clientY: 500,
      })
      now += 400
      fireEvent.click(yearly, { detail: 1 })
      expect(spy).not.toHaveBeenCalled()
      expect(yearly.checked).toBe(false)
    } finally {
      clock.mockRestore()
    }
  })
})

describe("RadioGroup — disabled", () => {
  it("a disabled item is disabled natively and never selects", () => {
    const spy = vi.fn()
    const { container } = render(
      <RadioGroup onValueChange={spy}>
        <RadioGroup.Item value="a">a</RadioGroup.Item>
        <RadioGroup.Item value="b" disabled>
          b
        </RadioGroup.Item>
      </RadioGroup>,
    )
    const [a, b] = radios(container)
    expect(a.disabled).toBe(false)
    expect(b.disabled).toBe(true)
    tap(b)
    act(() => b.click())
    expect(spy).not.toHaveBeenCalled()
    expect(b.checked).toBe(false)
  })

  it("a disabled group disables every item, and none selects", () => {
    const spy = vi.fn()
    const { container, getByRole } = render(
      <RadioGroup aria-label="g" disabled onValueChange={spy}>
        <RadioGroup.Item value="a">a</RadioGroup.Item>
        <RadioGroup.Item value="b">b</RadioGroup.Item>
      </RadioGroup>,
    )
    const group = getByRole("radiogroup")
    expect(group.getAttribute("aria-disabled")).toBe("true")
    expect(group.getAttribute("data-disabled")).toBe("")
    const all = radios(container)
    for (const radio of all) {
      expect(radio.disabled).toBe(true)
      tap(radio)
      act(() => radio.click())
    }
    expect(spy).not.toHaveBeenCalled()
    expect(all.some((r) => r.checked)).toBe(false)
    for (const item of itemsOf(container)) {
      expect(item.getAttribute("data-disabled")).toBe("")
    }
  })
})

describe("RadioGroup — forms", () => {
  it("required: every radio is required and the form is invalid until one is selected", () => {
    const { container } = render(
      <form>
        <RadioGroup aria-label="Plan" name="plan" required>
          <RadioGroup.Item value="monthly">Monthly</RadioGroup.Item>
          <RadioGroup.Item value="yearly">Yearly</RadioGroup.Item>
        </RadioGroup>
      </form>,
    )
    const form = container.querySelector("form") as HTMLFormElement
    const group = container.querySelector(
      "[role='radiogroup']",
    ) as HTMLElement
    expect(group.getAttribute("aria-required")).toBe("true")
    const all = radios(container)
    for (const radio of all) expect(radio.required).toBe(true)
    expect(form.checkValidity()).toBe(false)
    tap(all[1])
    expect(form.checkValidity()).toBe(true)
  })

  it("submits the selected value under the group's name", () => {
    const { container } = render(
      <form>
        <Plans name="plan" defaultValue="yearly" />
      </form>,
    )
    const form = container.querySelector("form") as HTMLFormElement
    expect(new FormData(form).getAll("plan")).toEqual(["yearly"])
    tap(radios(container)[2])
    expect(new FormData(form).getAll("plan")).toEqual(["lifetime"])
  })

  it("submits nothing for the group while nothing is selected, and nothing for a disabled group", () => {
    const { container } = render(
      <form>
        <Plans name="plan" />
        <RadioGroup name="off" defaultValue="x" disabled>
          <RadioGroup.Item value="x">x</RadioGroup.Item>
        </RadioGroup>
      </form>,
    )
    const form = container.querySelector("form") as HTMLFormElement
    const data = new FormData(form)
    expect(data.has("plan")).toBe(false)
    expect(data.has("off")).toBe(false)
  })

  it("a form reset puts an uncontrolled group back on its default, in the DOM and in state", async () => {
    const spy = vi.fn()
    const { container } = render(
      <form>
        <Plans name="plan" defaultValue="monthly" onValueChange={spy} />
      </form>,
    )
    const form = container.querySelector("form") as HTMLFormElement
    const [monthly, yearly] = radios(container)
    const [monthlyItem, yearlyItem] = itemsOf(container)
    tap(yearly)
    expect(spy).toHaveBeenCalledTimes(1)

    await act(async () => {
      form.reset()
      await new Promise((resolve) => setTimeout(resolve, 10))
    })
    expect(new FormData(form).getAll("plan")).toEqual(["monthly"])
    expect(monthly.checked).toBe(true)
    expect(yearly.checked).toBe(false)
    expect(
      monthlyItem.hasAttribute("data-checked"),
      "the paint follows",
    ).toBe(true)
    expect(yearlyItem.hasAttribute("data-checked")).toBe(false)
    //a reset is not a selection the user made
    expect(spy).toHaveBeenCalledTimes(1)

    //and the painted state is the real one: choosing yearly again is a change
    tap(yearly)
    expect(spy).toHaveBeenCalledTimes(2)
    expect(new FormData(form).getAll("plan")).toEqual(["yearly"])
    expect(yearlyItem.hasAttribute("data-checked")).toBe(true)
  })

  it("a reset of the form that `form` names follows it too, and restores a default set after mount", async () => {
    function Detached({ defaultValue }: { defaultValue: string }) {
      return (
        <>
          <form id="checkout" />
          <RadioGroup
            form="checkout"
            name="plan"
            defaultValue={defaultValue}
          >
            <RadioGroup.Item value="monthly">Monthly</RadioGroup.Item>
            <RadioGroup.Item value="yearly">Yearly</RadioGroup.Item>
            <RadioGroup.Item value="lifetime">Lifetime</RadioGroup.Item>
          </RadioGroup>
        </>
      )
    }
    const { container, rerender } = render(
      <Detached defaultValue="monthly" />,
    )
    const form = container.querySelector("form") as HTMLFormElement
    const [, yearly, lifetime] = radios(container)
    expect(yearly.form, "owned through the form attribute").toBe(form)
    expect(yearly.closest("form")).toBeNull()

    rerender(<Detached defaultValue="lifetime" />)
    tap(yearly)
    await act(async () => {
      form.reset()
      await new Promise((resolve) => setTimeout(resolve, 10))
    })
    expect(lifetime.checked).toBe(true)
    expect(yearly.checked).toBe(false)
    const items = itemsOf(container)
    expect(items[2].hasAttribute("data-checked")).toBe(true)
    expect(items[1].hasAttribute("data-checked")).toBe(false)
  })

  it("a render between an uncontrolled group's reset and its task does not bring the old choice back", async () => {
    //The group follows a reset a task after the event. A render in that gap (any
    //parent update) makes React write the OLD selection back into `checked`, so
    //a follow that read the DOM would keep the old choice; the reset value is
    //`defaultValue`, never the DOM.
    const ref = createRef<RadioGroupHandle>()
    let rerenderOwner = () => {}
    function Owner() {
      const [, setRenders] = useState(0)
      rerenderOwner = () => setRenders((n) => n + 1)
      return (
        <form>
          <RadioGroup ref={ref} name="plan" defaultValue="monthly">
            <RadioGroup.Item value="monthly">Monthly</RadioGroup.Item>
            <RadioGroup.Item value="yearly">Yearly</RadioGroup.Item>
          </RadioGroup>
        </form>
      )
    }
    const { container } = render(<Owner />)
    const form = container.querySelector("form") as HTMLFormElement
    const [monthly, yearly] = radios(container)
    const [monthlyItem, yearlyItem] = itemsOf(container)
    tap(yearly)
    expect(ref.current?.value).toBe("yearly")

    act(() => {
      form.reset()
      rerenderOwner()
    })
    expect(
      yearly.checked,
      "the render in the gap wrote the old choice back",
    ).toBe(true)

    await flushResetTask()
    expect(monthly.checked).toBe(true)
    expect(yearly.checked).toBe(false)
    expect(
      monthlyItem.hasAttribute("data-checked"),
      "the paint follows",
    ).toBe(true)
    expect(yearlyItem.hasAttribute("data-checked")).toBe(false)
    expect(ref.current?.value, "and so does the handle").toBe("monthly")
    expect(new FormData(form).getAll("plan")).toEqual(["monthly"])
  })

  it("an uncontrolled group with no defaultValue is left with no choice after a reset", async () => {
    const ref = createRef<RadioGroupHandle>()
    let rerenderOwner = () => {}
    function Owner() {
      const [, setRenders] = useState(0)
      rerenderOwner = () => setRenders((n) => n + 1)
      return (
        <form>
          <RadioGroup ref={ref} name="plan">
            <RadioGroup.Item value="monthly">Monthly</RadioGroup.Item>
            <RadioGroup.Item value="yearly">Yearly</RadioGroup.Item>
          </RadioGroup>
        </form>
      )
    }
    const { container } = render(<Owner />)
    const form = container.querySelector("form") as HTMLFormElement
    const all = radios(container)
    tap(all[1])
    act(() => {
      form.reset()
      rerenderOwner()
    })
    await flushResetTask()
    expect(all.some((r) => r.checked)).toBe(false)
    expect(
      itemsOf(container).some((item) => item.hasAttribute("data-checked")),
    ).toBe(false)
    expect(ref.current?.value).toBeNull()
    expect(new FormData(form).has("plan")).toBe(false)
  })

  it("a form reset reports defaultValue to a controlled owner once, and the owner decides", async () => {
    for (const frozen of [false, true]) {
      const spy = vi.fn()
      const { container, unmount } = render(
        <form>
          <ControlledPlans
            onValueChange={spy}
            frozen={frozen}
            initial="yearly"
            defaultValue="monthly"
          />
        </form>,
      )
      const form = container.querySelector("form") as HTMLFormElement
      const [monthly, yearly] = radios(container)
      const [monthlyItem, yearlyItem] = itemsOf(container)
      expect(yearly.checked).toBe(true)

      await act(async () => {
        form.reset()
      })
      await flushResetTask()
      expect(spy, frozen ? "ignored" : "accepted").toHaveBeenCalledTimes(1)
      expect(spy).toHaveBeenLastCalledWith("monthly")
      //(the fixture's <output> is itself a form control, which the reset blanks, so
      //the paint is read from the item)
      if (frozen) {
        expect(
          yearly.checked,
          "an owner that ignores it keeps its value",
        ).toBe(true)
        expect(monthly.checked).toBe(false)
        expect(yearlyItem.hasAttribute("data-checked")).toBe(true)
        expect(monthlyItem.hasAttribute("data-checked")).toBe(false)
      } else {
        expect(
          monthly.checked,
          "an owner that takes it moves the DOM",
        ).toBe(true)
        expect(yearly.checked).toBe(false)
        expect(monthlyItem.hasAttribute("data-checked")).toBe(true)
        expect(yearlyItem.hasAttribute("data-checked")).toBe(false)
      }
      unmount()
    }
  })

  it("a form reset reports null to a controlled owner with no defaultValue", async () => {
    const spy = vi.fn()
    const { container } = render(
      <form>
        <ControlledPlans onValueChange={spy} />
      </form>,
    )
    const form = container.querySelector("form") as HTMLFormElement
    const all = radios(container)
    tap(all[1])
    expect(spy).toHaveBeenLastCalledWith("yearly")
    await act(async () => {
      form.reset()
    })
    await flushResetTask()
    expect(spy).toHaveBeenCalledTimes(2)
    expect(spy).toHaveBeenLastCalledWith(null)
    expect(all.some((r) => r.checked)).toBe(false)
    expect(
      itemsOf(container).some((item) => item.hasAttribute("data-checked")),
    ).toBe(false)
  })

  it("a reset to the value a controlled group already holds reports nothing", async () => {
    const spy = vi.fn()
    const { container } = render(
      <form>
        <ControlledPlans onValueChange={spy} defaultValue="monthly" />
      </form>,
    )
    const form = container.querySelector("form") as HTMLFormElement
    await act(async () => {
      form.reset()
    })
    await flushResetTask()
    expect(spy).not.toHaveBeenCalled()
    expect(radios(container)[0].checked).toBe(true)
  })

  it("a reset a consumer's onReset prevents changes nothing, uncontrolled or controlled", async () => {
    const ref = createRef<RadioGroupHandle>()
    const uncontrolled = vi.fn()
    const controlled = vi.fn()
    const { container } = render(
      <>
        <form onReset={(e) => e.preventDefault()}>
          <RadioGroup
            ref={ref}
            name="plan"
            defaultValue="monthly"
            onValueChange={uncontrolled}
          >
            <RadioGroup.Item value="monthly">Monthly</RadioGroup.Item>
            <RadioGroup.Item value="yearly">Yearly</RadioGroup.Item>
          </RadioGroup>
        </form>
        <form onReset={(e) => e.preventDefault()}>
          <ControlledPlans onValueChange={controlled} />
        </form>
      </>,
    )
    const [first, second] = [...container.querySelectorAll("form")]
    const [, yearly, , controlledYearly] = radios(container)
    const items = itemsOf(container)
    tap(yearly)
    tap(controlledYearly)

    await act(async () => {
      resetInSpecOrder(first)
      resetInSpecOrder(second)
    })
    await flushResetTask()
    expect(yearly.checked).toBe(true)
    expect(items[1].hasAttribute("data-checked")).toBe(true)
    expect(ref.current?.value).toBe("yearly")
    expect(uncontrolled).toHaveBeenCalledTimes(1)
    expect(controlledYearly.checked).toBe(true)
    expect(items[3].hasAttribute("data-checked")).toBe(true)
    expect(controlled).toHaveBeenCalledTimes(1)
  })

  it("forwards `form` to every radio", () => {
    const { container } = render(
      <RadioGroup form="checkout">
        <RadioGroup.Item value="a">a</RadioGroup.Item>
      </RadioGroup>,
    )
    expect(radios(container)[0].getAttribute("form")).toBe("checkout")
  })
})

describe("RadioGroup — handles", () => {
  it("the group handle reads the value and focuses the selected radio, else the first enabled", () => {
    const ref = createRef<RadioGroupHandle>()
    const { container, rerender } = render(
      <RadioGroup ref={ref}>
        <RadioGroup.Item value="a" disabled>
          a
        </RadioGroup.Item>
        <RadioGroup.Item value="b">b</RadioGroup.Item>
        <RadioGroup.Item value="c">c</RadioGroup.Item>
      </RadioGroup>,
    )
    const [, b, c] = radios(container)
    expect(ref.current?.value).toBeNull()
    act(() => ref.current?.focus())
    expect(document.activeElement).toBe(b)

    rerender(
      <RadioGroup ref={ref} value="c">
        <RadioGroup.Item value="a" disabled>
          a
        </RadioGroup.Item>
        <RadioGroup.Item value="b">b</RadioGroup.Item>
        <RadioGroup.Item value="c">c</RadioGroup.Item>
      </RadioGroup>,
    )
    expect(ref.current?.value).toBe("c")
    act(() => ref.current?.focus())
    expect(document.activeElement).toBe(c)
  })

  it("the item handle reads checked and disabled and focuses its input", () => {
    const ref = createRef<RadioGroupItemHandle>()
    render(
      <RadioGroup defaultValue="a" disabled>
        <RadioGroup.Item ref={ref} value="a">
          a
        </RadioGroup.Item>
      </RadioGroup>,
    )
    expect(ref.current?.checked).toBe(true)
    expect(ref.current?.disabled).toBe(true)
    const enabled = createRef<RadioGroupItemHandle>()
    const { container: c2 } = render(
      <RadioGroup>
        <RadioGroup.Item ref={enabled} value="a">
          a
        </RadioGroup.Item>
      </RadioGroup>,
    )
    act(() => enabled.current?.focus())
    expect(document.activeElement).toBe(radios(c2)[0])
  })

  it("an item outside a RadioGroup throws a named error", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {})
    try {
      expect(() =>
        render(<RadioGroup.Item value="a">a</RadioGroup.Item>),
      ).toThrow(/RadioGroup.Item must be used within <RadioGroup>/)
    } finally {
      error.mockRestore()
    }
  })
})
