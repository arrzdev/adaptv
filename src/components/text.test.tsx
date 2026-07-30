import { render } from "@testing-library/react"
import type { ReactElement } from "react"
import { describe, expect, it } from "vitest"
import { Text, textClampStyle } from "#adaptv/components/text"
import {
  compileAdaptvStyles,
  ruleFor,
} from "#adaptv/styles/compile.test-helper"

function firstEl(ui: ReactElement): HTMLElement {
  const { container } = render(ui)
  return container.firstElementChild as HTMLElement
}

/** Class-attribute membership by TOKEN — `text-sm` must not read as `text`. */
function hasClass(el: HTMLElement, token: string): boolean {
  return (el.getAttribute("class") ?? "").split(/\s+/).includes(token)
}

describe("Text", () => {
  it("renders a span by default, so it nests without invalid markup", () => {
    expect(firstEl(<Text>hi</Text>).tagName).toBe("SPAN")
  })

  it("carries the scope attribute for import-free global styling", () => {
    expect(firstEl(<Text />).getAttribute("data-adaptv")).toBe("text")
  })

  it("forwards native span props", () => {
    const el = firstEl(<Text id="x" aria-label="label" />)
    expect(el.id).toBe("x")
    expect(el.getAttribute("aria-label")).toBe("label")
  })

  it("applies the consumer className (look)", () => {
    const el = firstEl(<Text className="text-sm text-gray-500" />)
    expect(hasClass(el, "text-sm")).toBe(true)
    expect(hasClass(el, "text-gray-500")).toBe(true)
  })
})

/* =============================================================================
 * RENDER (STYLING.md §3.3)
 * ============================================================================= */

describe("Text render", () => {
  it("renders the element it is given", () => {
    expect(firstEl(<Text render={<p />}>body</Text>).tagName).toBe("P")
  })

  it("keeps the rendered element's own children when Text has none", () => {
    //cloneElement's third argument is omitted rather than passed as undefined —
    //`children: undefined` inside the config WIPES the element's own children
    expect(
      firstEl(<Text render={<p>from the slot</p>} />).textContent,
    ).toBe("from the slot")
  })

  it("Text's children replace the rendered element's", () => {
    expect(
      firstEl(<Text render={<p>slot</p>}>from Text</Text>).textContent,
    ).toBe("from Text")
  })

  it("merges the slot's className with Text's instead of concatenating", () => {
    //both are the CONSUMER tier; Text's own prop is the more local, so it wins the
    //per-property tie — and only ONE of the pair reaches the DOM
    const el = firstEl(
      <Text render={<p className="text-sm" />} className="text-lg" />,
    )
    expect(hasClass(el, "text-lg")).toBe(true)
    expect(hasClass(el, "text-sm")).toBe(false)
  })

  it("still stamps its attributes on the rendered element", () => {
    const el = firstEl(<Text render={<h1>Inbox</h1>} />)
    expect(el.getAttribute("data-adaptv")).toBe("text")
    expect(el.hasAttribute("data-dynamic-type")).toBe(true)
  })
})

/* =============================================================================
 * DYNAMIC TYPE
 * ============================================================================= */

describe("Text dynamicType", () => {
  //presence, not `data-dynamic-type="true"` (STYLING.md §3.1) — text.css matches
  //`[data-dynamic-type]`, so the opt-out has to REMOVE the attribute
  it("is on by default, as a presence attribute", () => {
    const el = firstEl(<Text />)
    expect(el.hasAttribute("data-dynamic-type")).toBe(true)
    expect(el.getAttribute("data-dynamic-type")).toBe("")
  })

  it("opting out removes the attribute rather than setting it false", () => {
    expect(
      firstEl(<Text dynamicType={false} />).hasAttribute(
        "data-dynamic-type",
      ),
    ).toBe(false)
  })

  //The CSS half. Asserted against the COMPILED bundle, not the source text: the
  //`font` shorthand is the load-bearing part (a system font "can only be set with the
  //font property" — `font-size: -apple-system-body` is invalid and dropped), and a
  //toolchain that did not recognise the keyword would drop the declaration silently.
  it("compiles to a font SHORTHAND behind the iOS-only @supports gate", async () => {
    const css = await compileAdaptvStyles([])
    const body = ruleFor(css, '[data-adaptv="text"][data-dynamic-type]')

    expect(body).not.toBeNull()
    expect(body).toContain("font: -apple-system-body")
    //`font-size:` alone would mean the keyword was longhanded somewhere and Dynamic
    //Type silently stopped working — the exact regression PRIOR-ART.md §10 warns about
    expect(body).not.toContain("font-size: -apple-system-body")

    //the gate is what keeps macOS Safari (13px system body) and Blink out
    expect(css).toContain("@supports (-webkit-touch-callout: none)")

    //the shorthand also resets family/weight to the system face; both must be restored
    //or the app's brand font vanishes on iOS and nowhere else
    expect(body).toContain("font-family: inherit")
    expect(body).toContain("font-weight: inherit")
  })
})

/* =============================================================================
 * LINE CLAMP
 * ============================================================================= */

/*
 * ⚠︎ Asserted on the returned object, not the rendered node. happy-dom's CSS parser
 * rejects every WebKit-only declaration in the triad — a rendered `<Text numberOfLines>`
 * comes back with `style="overflow: hidden;"` and nothing else — so a DOM assertion
 * here would test happy-dom's vocabulary rather than adaptv's output. The one property
 * happy-dom does keep (`overflow`) still carries the precedence assertions below.
 */
describe("textClampStyle", () => {
  it("emits the full WebKit triad plus overflow", () => {
    //the standard `line-clamp` shorthand reaches neither WKWebView nor Android
    //WebView (MDN BCD), so all four declarations are still mandatory
    expect(textClampStyle(3)).toEqual({
      display: "-webkit-box",
      WebkitBoxOrient: "vertical",
      WebkitLineClamp: 3,
      overflow: "hidden",
    })
  })

  it("is undefined when unset, so nothing is forced on plain text", () => {
    expect(textClampStyle(undefined)).toBeUndefined()
    expect(firstEl(<Text />).getAttribute("style")).toBeNull()
  })

  it("treats 0 and negatives as no clamp (`-webkit-line-clamp: 0` clamps nothing)", () => {
    expect(textClampStyle(0)).toBeUndefined()
    expect(textClampStyle(-1)).toBeUndefined()
    expect(
      firstEl(<Text numberOfLines={0} />).getAttribute("style"),
    ).toBeNull()
  })

  it("never reaches the class attribute", () => {
    //`line-clamp-${n}` is not a literal token, so Tailwind's source scan would never
    //generate a rule for it — a class here would reach the DOM and match nothing
    expect(firstEl(<Text numberOfLines={3} />).className).not.toContain(
      "line-clamp",
    )
  })
})

/* =============================================================================
 * PRECEDENCE — STYLING.md §2 / §2.1
 * ============================================================================= */

describe("Text style precedence", () => {
  //The `base` half of §2's pair, and it is deliberately EMPTY: a run of text has no
  //default look, so there is no adaptv class for a consumer's to have to beat. Asserted
  //rather than assumed, because "over-locking looks fine until someone cannot restyle
  //it and files a bug adaptv cannot fix from their side."
  it("contributes no class of its own, so className is unopposed", () => {
    expect(firstEl(<Text />).className).toBe("")
    const el = firstEl(<Text className="block font-bold" />)
    expect(hasClass(el, "block")).toBe(true)
    expect(hasClass(el, "font-bold")).toBe(true)
  })

  //A class that MUST WIN. `selectable` is `locked`: the consumer asked for selection
  //with a prop, and their own `select-none` must not silently cancel it.
  it("locked `selectable` is emitted alongside a consumer select utility", () => {
    const el = firstEl(<Text selectable className="select-none" />)
    expect(hasClass(el, "selectable")).toBe(true)
  })

  it("selectable is opt-in — no class when the prop is absent", () => {
    expect(hasClass(firstEl(<Text />), "selectable")).toBe(false)
  })

  //The inline tier, and the whole reason the clamp lives there: inline style is its
  //own cascade origin, so a consumer `style` would otherwise beat any class or layered
  //rule adaptv could write. `overflow` stands in for the three WebKit declarations
  //happy-dom refuses to parse — the merge is per-property, so it holds identically.
  it("the clamp beats a conflicting consumer inline style", () => {
    const el = firstEl(
      <Text
        numberOfLines={2}
        style={{ overflow: "visible", color: "red" }}
      />,
    )
    expect(el.style.overflow).toBe("hidden")
    //…while leaving everything it does not own alone
    expect(el.style.color).toBe("red")
  })

  it("a consumer inline style still applies when there is no clamp", () => {
    expect(
      firstEl(<Text style={{ overflow: "visible" }} />).style.overflow,
    ).toBe("visible")
  })
})
