import { render } from "@testing-library/react"
import type { ReactNode } from "react"
import { describe, expect, it } from "vitest"
import { Dropdown } from "#adaptv/components/dropdown"
import {
  compileAdaptvStyles,
  ruleFor,
} from "#adaptv/styles/compile.test-helper"

/*
 * Dropdown.Item is a press target that runs no gesture engine — the same shape as
 * ExternalLink. It still owes the browser-facing half of the press-target contract:
 * the `touch-action` longhand LOCKED (press-core.ts, WebKit 240917) and the cursor a
 * DEFAULT where a consumer can beat it (docs/decisions/styling.md §2).
 *
 * The bug these tests were first written for was invisible to every class-string
 * assertion: the slot held the *name* of that contract, `clickable`, long after the
 * utility behind it was deleted. The same trap exists for a layer rule — a selector
 * the shipped bundle never emits fails silently — so the cursor test compiles the
 * real bundle, and the lock is read off the node's inline style, the one tier no
 * consumer class reaches.
 */

const ITEM = ':where([data-adaptv="dropdown-item"][data-part="item"])'

function itemEl(item: ReactNode): HTMLButtonElement {
  const { container } = render(
    <Dropdown defaultOpen>
      <Dropdown.Trigger>Menu</Dropdown.Trigger>
      <Dropdown.Content>{item}</Dropdown.Content>
    </Dropdown>,
  )
  const el = container.querySelector<HTMLButtonElement>(
    '[data-adaptv="dropdown-item"]',
  )
  if (!el) throw new Error("Dropdown.Item did not render")
  return el
}

describe("Dropdown.Item — the press-target contract (B8)", () => {
  it("ships a default rule for the cursor, keyed on the item's own attributes", async () => {
    /*
     * Only the cursor is asserted from the item's rule. The rest is theme paint
     * (`--color-foreground`, and `--color-surface`/`--color-border` on the panel) —
     * semantic tokens the CONSUMER supplies, read here with no fallback.
     */
    const el = itemEl(<Dropdown.Item>Rename</Dropdown.Item>)
    expect(el.getAttribute("data-part")).toBe("item")
    //adaptv adds no class of its own
    expect(el.hasAttribute("class")).toBe(false)
    const css = await compileAdaptvStyles([])
    expect(ruleFor(css, ITEM)).toContain("cursor: pointer;")
    expect(
      ruleFor(
        css,
        `:where([data-adaptv="dropdown-item"][data-part="item"]:disabled)`,
      ),
    ).toContain("cursor: not-allowed;")
  })

  it("keeps the touch pass-through when a className or style fights it", () => {
    //An item lives inside the panel's own scroller, so `touch-none` here is not a
    //restyle — it is a row of a scrolling menu the finger can no longer fling, and
    //on iOS a `pointercancel` the engine below never hears (WebKit 240917).
    const el = itemEl(
      <Dropdown.Item className="touch-none">Rename</Dropdown.Item>,
    )
    //the consumer's class lands untouched; the lock is inline, above any class
    expect(el.className).toBe("touch-none")
    expect(el.style.touchAction).toBe("pan-x pan-y pinch-zoom")
    expect(el.style.textAlign).toBe("start")
  })

  it("lets a consumer's cursor win — that half is a look, not correctness", () => {
    //the tier split press-core.ts describes: `clickable` bundled both and locked the
    //cursor with them, so `cursor-wait` on a pending item was unreachable. The cursor
    //is a `:where()` default in a layer now, so the class reaches it, and nothing
    //inline competes.
    const el = itemEl(
      <Dropdown.Item className="cursor-wait">Saving…</Dropdown.Item>,
    )
    expect(el.className).toBe("cursor-wait")
    expect(el.style.cursor).toBe("")
  })

  it("keeps a disabled item inert without making it a scroll dead zone", () => {
    //same reasoning as a disabled Button: `touch-action` never governed tappability
    //(the `disabled` attribute does), it governs whether the browser may read the
    //gesture as a scroll — so `touch-none` here would freeze the menu under a thumb
    //that happens to land on a greyed-out row.
    const el = itemEl(<Dropdown.Item disabled>Delete</Dropdown.Item>)
    expect(el.style.touchAction).toBe("pan-x pan-y pinch-zoom")
    expect(el.style.userSelect).toBe("none")
    //the disabled cursor rule keys on this
    expect(el.disabled).toBe(true)
  })
})

describe("Dropdown.Content — the locked panel structure", () => {
  it("holds z-index, the scroll axis and overscroll containment over a consumer style", () => {
    const { container } = render(
      <Dropdown defaultOpen>
        <Dropdown.Trigger>Menu</Dropdown.Trigger>
        <Dropdown.Content
          className="consumer-menu"
          style={{ zIndex: 1, overflowY: "visible", marginTop: "4px" }}
        >
          <Dropdown.Item>Rename</Dropdown.Item>
        </Dropdown.Content>
      </Dropdown>,
    )
    const panel = container.querySelector<HTMLElement>(
      '[data-adaptv="dropdown"][data-part="content"]',
    )
    if (!panel) throw new Error("Dropdown.Content did not render")
    expect(panel.className).toBe("consumer-menu")
    expect(panel.style.zIndex).toBe("50")
    expect(panel.style.overflowY).toBe("auto")
    expect(panel.style.overscrollBehavior).toBe("contain")
    expect(panel.style.position).toBe("fixed")
    //a property adaptv does not lock is the consumer's
    expect(panel.style.marginTop).toBe("4px")
    const trigger = container.querySelector(
      '[data-adaptv="dropdown-trigger"]',
    )
    expect(trigger?.getAttribute("data-part")).toBe("trigger")
    expect(trigger?.hasAttribute("class")).toBe(false)
  })

  it("paints the menu surface from the semantic token, with no fallback", async () => {
    const css = await compileAdaptvStyles([])
    expect(
      ruleFor(
        css,
        ':where([data-adaptv="dropdown"][data-part="content"])',
      ),
    ).toContain("background-color: var(--color-surface);")
  })
})
