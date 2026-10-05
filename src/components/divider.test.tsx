import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { render } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { Divider } from "#adaptv/components/divider"

function first(ui: Parameters<typeof render>[0]) {
  return render(ui).container.firstElementChild as HTMLElement
}

describe("Divider", () => {
  it("is a separator across by default, with the theme's border colour as a layered default", () => {
    const el = first(<Divider />)
    expect(el.tagName).toBe("DIV")
    expect(el.getAttribute("data-adaptv")).toBe("divider")
    expect(el.getAttribute("role")).toBe("separator")
    //horizontal is ARIA's default and is left unsaid, so nothing to parse
    expect(el.hasAttribute("aria-orientation")).toBe(false)
    expect(el.hasAttribute("data-orientation")).toBe(false)
    //the colour is a default rule keyed on the part (styles/divider.css), not a class
    expect(el.getAttribute("data-part")).toBe("root")
    expect(el.hasAttribute("class")).toBe(false)
  })

  it("passes a consumer className through untouched, and its style beside it", () => {
    const el = first(
      <Divider
        className="border-red-500 ms-4"
        style={{ marginBlock: "4px" }}
      />,
    )
    expect(el.className).toBe("border-red-500 ms-4")
    expect(el.style.marginBlock).toBe("4px")
  })

  it("vertical says so twice: to the stylesheet and to assistive technology", () => {
    const el = first(<Divider orientation="vertical" />)
    expect(el.getAttribute("data-orientation")).toBe("vertical")
    expect(el.getAttribute("aria-orientation")).toBe("vertical")
  })

  it("decorative is seen and not announced, in either orientation", () => {
    expect(first(<Divider decorative />).getAttribute("role")).toBe("none")
    const vertical = first(<Divider decorative orientation="vertical" />)
    expect(vertical.getAttribute("role")).toBe("none")
    expect(vertical.hasAttribute("aria-orientation")).toBe(false)
    //the stylesheet still needs the edge
    expect(vertical.getAttribute("data-orientation")).toBe("vertical")
  })

  it("render swaps the element and joins both call sites' classes, adding none of its own", () => {
    const el = first(
      <Divider render={<li className="my-2" />} className="ms-4" />,
    )
    expect(el.tagName).toBe("LI")
    expect(el.getAttribute("data-adaptv")).toBe("divider")
    expect(el.getAttribute("role")).toBe("separator")
    //the render element's first, then the prop's (styling.md §3.3)
    expect(el.className).toBe("my-2 ms-4")
  })

  it("drops its children, so a stray child cannot give the hairline a height", () => {
    const el = first(<Divider>{"text"}</Divider>)
    expect(el.childNodes.length).toBe(0)
  })

  it("forwards native props and the ref", () => {
    let node: HTMLDivElement | null = null
    const el = first(
      <Divider
        id="rule"
        aria-label="Section end"
        ref={(n) => {
          node = n
        }}
      />,
    )
    expect(el.id).toBe("rule")
    expect(el.getAttribute("aria-label")).toBe("Section end")
    expect(node).toBe(el)
  })
})

describe("the hairline stylesheet", () => {
  //the rules, with the prose stripped: the comments explain the quirks, and name
  //what the sheet must not do, so they cannot be what the asserts read
  const css = readFileSync(
    resolve(__dirname, "../styles/divider.css"),
    "utf8",
  ).replace(/\/\*[\s\S]*?\*\//g, "")

  it("draws a border on the identity attribute, never a background", () => {
    expect(css).toContain('[data-adaptv="divider"]')
    expect(css).toContain("border-block-start-width: 1px")
    expect(css).toContain("border-inline-start-width: 1px")
    expect(css).not.toMatch(/background(?!-)/)
  })

  it("keeps a whole 1px border and scales it by 1 / floor(dpr) per density bucket", () => {
    //a sub-pixel border WIDTH is what both engines get wrong (Chromium rounds it up to
    //1 CSS px, WebKit floors a third at 3x to nothing); the scale is what neither snaps.
    //The factor is 1 / floor(dpr): a 1px border is itself snapped DOWN to whole device
    //pixels first (0.761905px on a 2.625x Pixel), so the whole-number buckets are exact
    expect(css).not.toMatch(/border-[a-z-]*width: (0\.|calc)/)
    expect(css).toContain("--adaptv-hairline-scale: 1;")
    expect(css).toContain(
      "transform: scaleY(var(--adaptv-hairline-scale))",
    )
    expect(css).toContain(
      "transform: scaleX(var(--adaptv-hairline-scale))",
    )
    expect(css).toContain("transform-origin: 0 0")
    //each ladder step's block carries its factor, checked on the text between the
    //step's media query and the closing brace of its rule
    const ladder: Array<[string, string]> = [
      ["2dppx", "0.5"],
      ["3dppx", "calc(1 / 3)"],
      ["4dppx", "0.25"],
    ]
    for (const [bucket, factor] of ladder) {
      const at = css.indexOf(`@media (min-resolution: ${bucket})`)
      expect(at, bucket).toBeGreaterThan(-1)
      const block = css.slice(at, css.indexOf("}", at))
      expect(block, bucket).toContain(`--adaptv-hairline-scale: ${factor}`)
    }
  })

  it("stretches a vertical rule down its row and keeps it out of the flex squeeze", () => {
    expect(css).toMatch(
      /\[data-orientation="vertical"\][^}]*align-self: stretch/,
    )
    expect(css).toContain("flex-shrink: 0")
  })

  it("is layered so a consumer's own rule wins without !important", () => {
    expect(css).toContain("@layer adaptv.components")
    expect(css).not.toContain("!important")
  })
})
