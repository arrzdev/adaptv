import { render } from "@testing-library/react"
import type { ReactNode } from "react"
import { describe, expect, it } from "vitest"
import { Dropdown } from "#adaptv/components/dropdown"
import { compileAdaptvStyles } from "#adaptv/styles/compile.test-helper"

/*
 * Dropdown.Item is a press target that runs no gesture engine — the same shape as
 * ExternalLink. It still owes the browser-facing half of the press-target contract:
 * the `touch-action` longhand LOCKED (press-core.ts, WebKit 240917) and the cursor in
 * the BASE tier where a consumer can beat it.
 *
 * The bug these tests exist for was invisible to every class-string assertion: the slot
 * held the *name* of that contract, `clickable`, long after the utility behind it was
 * deleted and split in two. A class no stylesheet defines is indistinguishable from a
 * class that works until you compile — so the first test compiles.
 */

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

function classList(el: Element): string[] {
  return el.className.split(/\s+/).filter(Boolean)
}

describe("Dropdown.Item — the press-target contract (B8)", () => {
  it("carries classes the stylesheet emits, not a name nothing defines", async () => {
    /*
     * Hand the item's OWN class list to the real compiler and demand the two
     * declarations back. This is the only assertion that fires on the actual bug:
     * an unknown candidate emits no rule and raises no error, so the component
     * rendered a perfectly plausible `class="clickable …"` and shipped a menu with
     * no `touch-action` and no pointer cursor at all.
     *
     * Only these two are asserted. The rest of the item's base tier is theme paint
     * (`text-foreground`, and `bg-surface`/`ring-border` on the panel) — tokens the
     * CONSUMER's `@theme` supplies, so they are correctly absent from adaptv's own
     * compiled output and prove nothing either way.
     */
    const css = await compileAdaptvStyles(
      classList(itemEl(<Dropdown.Item>Rename</Dropdown.Item>)),
    )
    expect(css).toContain("touch-action:")
    expect(css).toContain("cursor: pointer")
  })

  it("keeps the touch pass-through when a className fights it", () => {
    //An item lives inside the panel's own scroller, so `touch-none` here is not a
    //restyle — it is a row of a scrolling menu the finger can no longer fling, and
    //on iOS a `pointercancel` the engine below never hears (WebKit 240917).
    const el = itemEl(
      <Dropdown.Item className="touch-none">Rename</Dropdown.Item>,
    )
    expect(classList(el)).toContain("touch-pan-x")
    expect(classList(el)).not.toContain("touch-none")
  })

  it("lets a consumer's cursor win — that half is a look, not correctness", () => {
    //the tier split press-core.ts describes: `clickable` bundled both and locked the
    //cursor with them, so `cursor-wait` on a pending item was unreachable.
    const el = itemEl(
      <Dropdown.Item className="cursor-wait">Saving…</Dropdown.Item>,
    )
    expect(classList(el)).toContain("cursor-wait")
    expect(classList(el)).not.toContain("cursor-pointer")
  })

  it("keeps a disabled item inert without making it a scroll dead zone", () => {
    //same reasoning as a disabled Button: `touch-action` never governed tappability
    //(the `disabled` attribute does), it governs whether the browser may read the
    //gesture as a scroll — so `touch-none` here would freeze the menu under a thumb
    //that happens to land on a greyed-out row.
    const el = itemEl(<Dropdown.Item disabled>Delete</Dropdown.Item>)
    expect(classList(el)).toContain("touch-pan-x")
    expect(classList(el)).not.toContain("touch-none")
    expect(classList(el)).toContain("cursor-not-allowed")
  })
})
