import { render } from "@testing-library/react"
import type { ReactElement } from "react"
import { describe, expect, it } from "vitest"
import {
  FieldGroup,
  getFieldItemPosition,
} from "#adaptv/components/field-group"

function firstEl(ui: ReactElement): HTMLElement {
  const { container } = render(ui)
  return container.firstElementChild as HTMLElement
}

/** Class-attribute membership by TOKEN, so `flex-col` never reads as `flex`. */
function hasClass(el: Element, token: string): boolean {
  return (el.getAttribute("class") ?? "").split(/\s+/).includes(token)
}

function part(root: Element, name: string): HTMLElement | null {
  return root.querySelector(`[data-part="${name}"]`)
}

describe("FieldGroup root", () => {
  it("renders a div that answers to the scope attribute", () => {
    const el = firstEl(<FieldGroup />)
    expect(el.tagName).toBe("DIV")
    expect(el.getAttribute("data-adaptv")).toBe("field-group")
    expect(el.getAttribute("data-part")).toBe("root")
    //adaptv adds no class of its own
    expect(el.hasAttribute("class")).toBe(false)
  })

  it("forwards div props and the consumer className", () => {
    const el = firstEl(<FieldGroup id="settings" className="gap-8" />)
    expect(el.id).toBe("settings")
    expect(hasClass(el, "gap-8")).toBe(true)
  })
})

describe("FieldGroup.Section", () => {
  it("renders a section with header, rows and footer in that order", () => {
    const el = firstEl(
      <FieldGroup.Section title="General" footer="Applies everywhere.">
        <FieldGroup.Row label="A" />
      </FieldGroup.Section>,
    )
    expect(el.tagName).toBe("SECTION")
    expect(el.getAttribute("data-part")).toBe("section")
    const parts = [...el.children].map((c) => c.getAttribute("data-part"))
    expect(parts).toEqual(["header", "rows", "footer"])
    expect(part(el, "header")?.textContent).toBe("General")
    expect(part(el, "footer")?.textContent).toBe("Applies everywhere.")
  })

  it("points aria-labelledby at the generated header id when a title exists", () => {
    const el = firstEl(<FieldGroup.Section title="General" />)
    const header = part(el, "header")
    expect(header?.id).not.toBe("")
    expect(el.getAttribute("aria-labelledby")).toBe(header?.id)
  })

  it("points aria-labelledby at a Header slot's id, keeping the consumer's own", () => {
    const el = firstEl(
      <FieldGroup.Section>
        <FieldGroup.Header id="general-heading">General</FieldGroup.Header>
      </FieldGroup.Section>,
    )
    expect(part(el, "header")?.id).toBe("general-heading")
    expect(el.getAttribute("aria-labelledby")).toBe("general-heading")
  })

  it("carries no aria-labelledby and no header without a title or Header", () => {
    const el = firstEl(
      <FieldGroup.Section footer="fine print">
        <FieldGroup.Row label="A" />
      </FieldGroup.Section>,
    )
    expect(el.hasAttribute("aria-labelledby")).toBe(false)
    expect(part(el, "header")).toBeNull()
    expect(part(el, "footer")?.textContent).toBe("fine print")
  })

  it("lets the Header slot beat the title shorthand", () => {
    const el = firstEl(
      <FieldGroup.Section title="from the prop">
        <FieldGroup.Header className="uppercase">
          from the slot
        </FieldGroup.Header>
      </FieldGroup.Section>,
    )
    expect(el.querySelectorAll('[data-part="header"]')).toHaveLength(1)
    const header = part(el, "header")
    expect(header?.textContent).toBe("from the slot")
    expect(hasClass(header as Element, "uppercase")).toBe(true)
  })

  it("lets the Footer slot beat the footer shorthand", () => {
    const el = firstEl(
      <FieldGroup.Section footer="from the prop">
        <FieldGroup.Footer>from the slot</FieldGroup.Footer>
      </FieldGroup.Section>,
    )
    expect(el.querySelectorAll('[data-part="footer"]')).toHaveLength(1)
    expect(part(el, "footer")?.textContent).toBe("from the slot")
  })

  it("keeps rows as the ONLY children of the rows box, so first:/last: are honest", () => {
    const el = firstEl(
      <FieldGroup.Section>
        <FieldGroup.Row label="One" />
        <FieldGroup.Header>Heading</FieldGroup.Header>
        <FieldGroup.Row label="Two" />
        <FieldGroup.Footer>Footer</FieldGroup.Footer>
        <FieldGroup.Row label="Three" />
      </FieldGroup.Section>,
    )
    const rows = part(el, "rows") as HTMLElement
    expect(rows.children).toHaveLength(3)
    for (const child of rows.children) {
      expect(child.getAttribute("data-part")).toBe("row")
    }
    expect(rows.querySelector('[data-part="header"]')).toBeNull()
    expect(rows.querySelector('[data-part="footer"]')).toBeNull()
    //the header still comes first and the footer last, wherever they were written
    const order = [...el.children].map((c) => c.getAttribute("data-part"))
    expect(order).toEqual(["header", "rows", "footer"])
  })

  it("forwards section props and merges className/style", () => {
    const el = firstEl(
      <FieldGroup.Section
        aria-label="x"
        className="px-4"
        style={{ marginTop: 8 }}
      />,
    )
    expect(el.getAttribute("aria-label")).toBe("x")
    expect(hasClass(el, "px-4")).toBe(true)
    expect(el.style.marginTop).toBe("8px")
  })
})

describe("FieldGroup.Row", () => {
  it("renders a flex div with the label column leading and the control trailing", () => {
    const el = firstEl(
      <FieldGroup.Row label="Sounds" description="Play a tone">
        <input type="checkbox" />
      </FieldGroup.Row>,
    )
    expect(el.tagName).toBe("DIV")
    expect(el.getAttribute("data-adaptv")).toBe("field-group")
    expect(el.getAttribute("data-part")).toBe("row")
    //the flex row is a lock, inline; adaptv adds no class of its own
    expect(el.style.display).toBe("flex")
    expect(el.hasAttribute("class")).toBe(false)
    expect(el.children).toHaveLength(2)
    const [column, control] = el.children
    expect(column?.getAttribute("data-part")).toBe("label")
    expect(control?.tagName).toBe("INPUT")
    expect(part(el, "title")?.textContent).toBe("Sounds")
    expect(part(el, "description")?.textContent).toBe("Play a tone")
  })

  it("stacks the title over the description inside the column", () => {
    const el = firstEl(<FieldGroup.Row label="A" description="B" />)
    const column = part(el, "label") as HTMLElement
    expect(column.getAttribute("data-adaptv")).toBe("field-group")
    expect(column.style.display).toBe("flex")
    expect(column.style.flexDirection).toBe("column")
    expect(column.hasAttribute("class")).toBe(false)
    const parts = [...column.children].map((c) =>
      c.getAttribute("data-part"),
    )
    expect(parts).toEqual(["title", "description"])
    for (const child of column.children) expect(child.tagName).toBe("SPAN")
  })

  it("omits the description span when only a label is given, and vice versa", () => {
    const labelOnly = firstEl(<FieldGroup.Row label="A" />)
    expect(part(labelOnly, "title")).not.toBeNull()
    expect(part(labelOnly, "description")).toBeNull()
    const descriptionOnly = firstEl(<FieldGroup.Row description="B" />)
    expect(part(descriptionOnly, "title")).toBeNull()
    expect(part(descriptionOnly, "description")).not.toBeNull()
  })

  it("renders only the children when there is no label, description or slot", () => {
    const el = firstEl(
      <FieldGroup.Row>
        <button type="button">Sign out</button>
      </FieldGroup.Row>,
    )
    expect(part(el, "label")).toBeNull()
    expect(el.children).toHaveLength(1)
    expect(el.firstElementChild?.tagName).toBe("BUTTON")
  })

  it("lets the Label and Description slots beat the shorthand", () => {
    const el = firstEl(
      <FieldGroup.Row label="prop label" description="prop description">
        <FieldGroup.Label className="font-bold">
          slot label
        </FieldGroup.Label>
        <FieldGroup.Description>slot description</FieldGroup.Description>
        <span>control</span>
      </FieldGroup.Row>,
    )
    expect(el.querySelectorAll('[data-part="title"]')).toHaveLength(1)
    expect(el.querySelectorAll('[data-part="description"]')).toHaveLength(
      1,
    )
    const title = part(el, "title") as HTMLElement
    expect(title.textContent).toBe("slot label")
    expect(hasClass(title, "font-bold")).toBe(true)
    expect(part(el, "description")?.textContent).toBe("slot description")
    //the slots live in the column; the control is the row's other child
    const column = part(el, "label") as HTMLElement
    expect(column.children).toHaveLength(2)
    expect(el.children).toHaveLength(2)
    expect(el.lastElementChild?.textContent).toBe("control")
  })

  it("renders the element passed to render, carrying both classNames and the row's own", () => {
    const el = firstEl(
      <FieldGroup.Row
        label="Sounds"
        render={
          <label htmlFor="sounds" className="px-4">
            replaced
          </label>
        }
        className="py-3"
      >
        <input id="sounds" type="checkbox" />
      </FieldGroup.Row>,
    )
    expect(el.tagName).toBe("LABEL")
    expect(el.getAttribute("for")).toBe("sounds")
    expect(el.getAttribute("data-part")).toBe("row")
    expect(hasClass(el, "px-4")).toBe(true)
    expect(hasClass(el, "py-3")).toBe(true)
    expect(el.style.display).toBe("flex")
    expect(part(el, "title")?.textContent).toBe("Sounds")
    expect(el.querySelector("input")?.id).toBe("sounds")
    //the row's content replaces the render element's own children, as Text does
    expect(el.textContent).not.toContain("replaced")
  })

  it("merges the render element's className with the row's instead of concatenating", () => {
    const el = firstEl(
      <FieldGroup.Row
        render={<div className="px-2" />}
        className="px-4"
      />,
    )
    expect(hasClass(el, "px-4")).toBe(true)
    expect(hasClass(el, "px-2")).toBe(false)
  })

  it("keeps the flex structure when a className or style fights it, but yields alignment", () => {
    const el = firstEl(
      <FieldGroup.Row
        label="A"
        className="block items-start"
        style={{ display: "grid", alignItems: "start" }}
      />,
    )
    //the consumer's classes land untouched; the lock is inline, above any class
    expect(el.className).toBe("block items-start")
    expect(el.style.display).toBe("flex")
    //alignment is a default (field-group.css), so the consumer's style keeps it
    expect(el.style.alignItems).toBe("start")
  })

  it("stamps data-disabled and aria-disabled on the row and changes nothing else", () => {
    const plain = firstEl(
      <FieldGroup.Row label="A">
        <input type="checkbox" />
      </FieldGroup.Row>,
    )
    const disabled = firstEl(
      <FieldGroup.Row label="A" disabled>
        <input type="checkbox" />
      </FieldGroup.Row>,
    )
    expect(plain.hasAttribute("data-disabled")).toBe(false)
    expect(plain.hasAttribute("aria-disabled")).toBe(false)
    //`""`, not `"true"`: a presence attribute (styling.md §3.1)
    expect(disabled.getAttribute("data-disabled")).toBe("")
    expect(disabled.getAttribute("aria-disabled")).toBe("true")
    expect(disabled.className).toBe(plain.className)
    expect(disabled.innerHTML).toBe(plain.innerHTML)
    //it does not reach into the control
    expect(disabled.querySelector("input")?.disabled).toBe(false)
  })

  it("forwards div props and merges style through the render path too", () => {
    const el = firstEl(
      <FieldGroup.Row
        id="row"
        render={
          <a href="/x" style={{ color: "red" }}>
            replaced
          </a>
        }
        style={{ marginTop: 4 }}
      />,
    )
    expect(el.tagName).toBe("A")
    expect(el.id).toBe("row")
    expect(el.style.color).toBe("red")
    expect(el.style.marginTop).toBe("4px")
  })
})

describe("getFieldItemPosition", () => {
  it("calls a group of one 'only'", () => {
    expect(getFieldItemPosition(0, 1)).toBe("only")
  })

  it("splits a group of two into leading and trailing", () => {
    expect(getFieldItemPosition(0, 2)).toBe("leading")
    expect(getFieldItemPosition(1, 2)).toBe("trailing")
  })

  it("puts the middle of three in the middle", () => {
    expect([0, 1, 2].map((i) => getFieldItemPosition(i, 3))).toEqual([
      "leading",
      "middle",
      "trailing",
    ])
  })

  it("throws a RangeError naming the arguments for an index outside the group", () => {
    expect(() => getFieldItemPosition(-1, 3)).toThrow(RangeError)
    expect(() => getFieldItemPosition(3, 3)).toThrow(RangeError)
    expect(() => getFieldItemPosition(0, 0)).toThrow(RangeError)
    expect(() => getFieldItemPosition(1.5, 3)).toThrow(RangeError)
    expect(() => getFieldItemPosition(4, 3)).toThrow(/index 4 .* 3/)
  })
})
