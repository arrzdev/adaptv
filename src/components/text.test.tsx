import { render } from "@testing-library/react"
import type { ReactElement } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { Text, textClampStyle } from "#adaptv/components/text"
import { measureDynamicTypeScale } from "#adaptv/utils/text-scale"

//The scalar is an ambient iOS-WebKit measurement (covered on its own in
//`utils/text-scale.test.ts`); mock it here so the COMPONENT's scaling wiring is
//deterministic instead of riding on happy-dom's `-webkit-touch-callout` behaviour.
vi.mock("#adaptv/utils/text-scale", () => ({
  measureDynamicTypeScale: vi.fn(() => 1),
}))
const mockedScale = vi.mocked(measureDynamicTypeScale)

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
    //the opt-in presence attribute has to reach the cloneElement path too, not just <span>
    const el = firstEl(<Text render={<h1>Inbox</h1>} scaleWithSystem />)
    expect(el.getAttribute("data-adaptv")).toBe("text")
    expect(el.hasAttribute("data-scale-with-system")).toBe(true)
  })
})

/* =============================================================================
 * DYNAMIC TYPE — scaleWithSystem
 *
 * The scalar itself is iOS-WebKit only and is exercised in `utils/text-scale.test.ts`;
 * happy-dom fails the `-webkit-touch-callout` gate, so here the scale is always 1 and
 * these assertions cover the attribute contract and the "zero inline sizing off iOS"
 * guarantee that the whole opt-in default rides on.
 * ============================================================================= */

describe("Text scaleWithSystem", () => {
  beforeEach(() => {
    //default: off iOS, the factor is 1 — reset per test so a multiply case cannot leak
    mockedScale.mockReturnValue(1)
  })

  //opt-in, and a PRESENCE attribute (docs/decisions/styling.md §3.1): unset means the attribute is
  //ABSENT, never `data-scale-with-system="false"`
  it("is off by default — the attribute is absent, not present", () => {
    const el = firstEl(<Text />)
    expect(el.hasAttribute("data-scale-with-system")).toBe(false)
  })

  it("opting in stamps the presence attribute as an empty string", () => {
    const el = firstEl(<Text scaleWithSystem />)
    expect(el.hasAttribute("data-scale-with-system")).toBe(true)
    expect(el.getAttribute("data-scale-with-system")).toBe("")
  })

  //The whole point of the opt-in default: with the opt-in ABSENT the layout effect never
  //runs its body, so a plain sized Text carries zero inline sizing — exactly its class.
  it("sets no inline font-size on plain Text (zero JS by default)", () => {
    expect(firstEl(<Text className="text-lg" />).style.fontSize).toBe("")
  })

  //Opted in but the factor is 1 (every non-iOS target, and iOS at the default size): the
  //element still keeps exactly its className size — the multiply is a no-op, not a pin.
  it("sets no inline font-size when the factor is 1", () => {
    mockedScale.mockReturnValue(1)
    expect(
      firstEl(<Text scaleWithSystem className="text-lg" />).style.fontSize,
    ).toBe("")
  })

  //The multiply itself: the effect reads the CLASS-computed (built) size and writes it
  //back × the factor, so the class size is scaled rather than replaced.
  it("multiplies the built font-size by the factor when it is > 1", () => {
    mockedScale.mockReturnValue(2)
    const base = Number.parseFloat(
      getComputedStyle(firstEl(<Text />)).fontSize,
    )
    const el = firstEl(<Text scaleWithSystem />)
    expect(el.style.fontSize).toBe(`${base * 2}px`)
  })
})

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
