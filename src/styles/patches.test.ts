import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import {
  compileAdaptvStyles,
  ruleFor,
} from "#adaptv/styles/compile.test-helper"
import { UI_STAMPS } from "#adaptv/utils/platform"

/*
 * The two app-feel resets that a consumer gets to decide (`ui.noSelect`,
 * `ui.hideScrollbars`).
 *
 * They are the only rules in patches.css keyed on a stamp, and the stamp is
 * written by a JS string in `utils/platform.ts` — so nothing but a test connects
 * the attribute the script writes to the attribute the CSS reads. A typo in either
 * half compiles, ships, and silently applies the reset nowhere.
 */

const PATCHES_CSS = readFileSync(
  join(process.cwd(), "src/styles/patches.css"),
  "utf8",
)

/** The selectors of every compiled rule whose body declares `property`. */
function selectorsDeclaring(css: string, property: string): string[] {
  const out: string[] = []
  for (const [, selector, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (new RegExp(`(^|[;\\s])${property}\\s*:`).test(body)) {
      out.push(selector.trim())
    }
  }
  return out
}

describe("ui.noSelect — the selection reset is stamped, not universal", () => {
  it("keys the reset on the pre-paint stamp", async () => {
    const css = await compileAdaptvStyles([])
    expect(
      ruleFor(
        css,
        "html[data-adaptv-no-select], html[data-adaptv-no-select] *",
      ),
    ).toBe("-webkit-user-select: none; user-select: none;")
  })

  it("ships NO unstamped `user-select: none` a browser tab would get", async () => {
    //the regression this whole slice exists to prevent: a global reset in a real
    //browser tab means the user cannot select an error message or Ctrl+A a page
    const css = await compileAdaptvStyles(["selectable"])
    const selectors = selectorsDeclaring(css, "user-select").filter(
      (selector) => !selector.includes("data-adaptv-no-select"),
    )
    //what remains is opt-in (`.selectable`), component-scoped (a swipeable's content
    //must not select while it is being dragged), or media — never a bare `*`
    for (const selector of selectors) {
      expect(selector).not.toBe("*")
    }
    //`.selectable` leads because it is an `@utility`, emitted into Tailwind's own
    //`utilities` layer ahead of everything adaptv writes into `adaptv.*`
    expect(selectors).toEqual([
      ".selectable",
      "img, svg, video, canvas",
      "[data-swipeable-content]",
    ])
  })

  /*
   * Media is unconditional and must STAY unconditional. `ui.noSelect` answers "is
   * text selectable in this app"; whether a photo paints a blue selection wash is a
   * different question with only one answer. And a selection-drag beginning on an
   * image is what starts a native image drag, which steals the pointer from the
   * gesture engine — swipe a row containing a thumbnail and it stops tracking.
   */
  it("makes media unselectable regardless of the knob", async () => {
    const css = await compileAdaptvStyles([])
    const selectors = selectorsDeclaring(css, "user-select")
    const media = selectors.filter((s) => s.includes("img"))

    expect(media).toEqual(["img, svg, video, canvas"])
    //the point of the test: no stamp on it, so `ui.noSelect: "off"` cannot reach it
    expect(media[0]).not.toContain("data-adaptv-no-select")
  })

  it("keeps text-editing surfaces selectable, out-specifying the reset", async () => {
    //`input` alone would now LOSE to `html[data-adaptv-no-select] *` (0,0,1 vs
    //0,1,1), so the exemption carries the stamp AND `:is()` — 0,2,1.
    const css = await compileAdaptvStyles([])
    expect(
      ruleFor(
        css,
        'html[data-adaptv-no-select] :is(input, textarea, [contenteditable="true"])',
      ),
    ).toBe("-webkit-user-select: text; user-select: text;")
  })

  it("still lets `selectable` win on layer order alone", async () => {
    //the stamp adds specificity to the reset; `.selectable` is in a LATER layer, so
    //it does not have to care — and must still carry no `!important` (STYLING §6.0.1)
    const css = await compileAdaptvStyles(["selectable"])
    expect(ruleFor(css, ".selectable")).toBe(
      "-webkit-user-select: text; user-select: text;",
    )
  })
})

describe("ui.hideScrollbars — the scrollbar reset is stamped, not universal", () => {
  it("keys both halves on the stamp, root element included", async () => {
    //`html[…]` is listed explicitly because the old bare `*` matched the root, and
    //the root element is the one that owns the DOCUMENT scrollbar
    const css = await compileAdaptvStyles([])
    expect(
      ruleFor(
        css,
        "html[data-adaptv-hide-scrollbars], html[data-adaptv-hide-scrollbars] *",
      ),
    ).toBe("scrollbar-width: none;")
    expect(css).toContain(
      "html[data-adaptv-hide-scrollbars]::-webkit-scrollbar",
    )
    expect(css).toContain(
      "html[data-adaptv-hide-scrollbars] *::-webkit-scrollbar",
    )
  })

  it("ships NO unstamped `scrollbar-width`", async () => {
    const css = await compileAdaptvStyles([])
    for (const selector of selectorsDeclaring(css, "scrollbar-width")) {
      expect(selector).toContain("data-adaptv-hide-scrollbars")
    }
  })
})

describe("focus — the reset must not take the keyboard indicator with it", () => {
  it("resets only :focus:not(:focus-visible)", async () => {
    //a flat `:focus` reset leaves a CONSUMER's plain <button> with no visible focus
    //indicator on any target, Tab included — WCAG 2.4.7 Level AA
    const css = await compileAdaptvStyles([])
    expect(
      ruleFor(
        css,
        "input:focus:not(:focus-visible), textarea:focus:not(:focus-visible), select:focus:not(:focus-visible), button:focus:not(:focus-visible), a:focus:not(:focus-visible), [tabindex]:focus:not(:focus-visible)",
      ),
    ).toBe("outline: none; box-shadow: none;")

    //…and nothing else adaptv ships strips an outline from a bare `:focus`. The
    //drawer overlay is the one deliberate exception (a tap on the backdrop must
    //fade it out, not flash a ring over the dim layer).
    for (const selector of selectorsDeclaring(css, "outline")) {
      if (!/outline\s*:\s*none/.test(ruleFor(css, selector) ?? ""))
        continue
      if (selector.includes("data-pwa-drawer-overlay")) continue
      expect(selector).toContain(":focus:not(:focus-visible)")
    }
  })

  it("ships a replacement ring at zero specificity", async () => {
    const css = await compileAdaptvStyles([])
    expect(ruleFor(css, ":where(:focus-visible)")).toBe(
      "outline: 2px solid var(--adaptv-ring, currentColor); outline-offset: 2px;",
    )
  })

  it("does NOT branch on platform — :focus-visible already handles touch", async () => {
    //UAs deliberately do not match :focus-visible for touch-initiated focus, and a
    //platform stamp could never see an external keyboard on an installed iPad PWA
    const css = await compileAdaptvStyles([])
    const ring = css.slice(css.indexOf(":where(:focus-visible)"))
    expect(ring.slice(0, ring.indexOf("}"))).not.toContain(
      "data-adaptv-platform",
    )
  })
})

describe("ui.touchCallout — the iOS link callout is stamped, the tap flash is not", () => {
  it("keys only the callout on the stamp", async () => {
    const css = await compileAdaptvStyles([])
    expect(
      ruleFor(css, "html[data-adaptv-no-touch-callout] a[href]"),
    ).toBe("-webkit-touch-callout: none;")
  })

  it("keeps -webkit-tap-highlight-color universal (doctrine, no knob)", async () => {
    //the grey flash duplicates adaptv's own press feedback — there is no app that
    //wants both, so it must NOT move behind the stamp with the callout
    const css = await compileAdaptvStyles([])
    expect(
      selectorsDeclaring(css, "-webkit-tap-highlight-color"),
    ).toContain("a[href]")
    //…and no stamped variant of it snuck in alongside
    for (const selector of selectorsDeclaring(
      css,
      "-webkit-tap-highlight-color",
    )) {
      expect(selector).not.toContain("data-adaptv-no-touch-callout")
    }
  })

  it("ships NO unstamped `-webkit-touch-callout`", async () => {
    //a browser tab must keep long-press → copy link / open in new tab
    const css = await compileAdaptvStyles([])
    for (const selector of selectorsDeclaring(
      css,
      "-webkit-touch-callout",
    )) {
      expect(selector).toContain("data-adaptv-no-touch-callout")
    }
  })
})

describe("the CSS reads exactly the attributes the init script writes", () => {
  //two files, one contract, no compiler between them
  it.each(UI_STAMPS)("%s → %s", (_key, attr) => {
    expect(PATCHES_CSS).toContain(`html[${attr}]`)
  })
})
