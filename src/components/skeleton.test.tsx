import { readFileSync } from "node:fs"
import { join } from "node:path"
import { render } from "@testing-library/react"
import type { ReactElement } from "react"
import { describe, expect, it } from "vitest"
import { Skeleton } from "#adaptv/components/skeleton"
import { compileAdaptvStyles } from "#adaptv/styles/compile.test-helper"

/*
 * The three quirks `Skeleton` was admitted for (docs/roadmap/component-gaps.md), each
 * asserted where it actually lives. Two of them are CSS `@media` rules, and happy-dom
 * evaluates no media query and compiles no Tailwind — so those are asserted on the
 * COMPILED stylesheet a consumer gets, the way scroll-fade.test.ts does, plus the
 * source text where the property is one no DOM can tell apart from its absence.
 */

function firstEl(ui: ReactElement): HTMLElement {
  const { container } = render(ui)
  return container.firstElementChild as HTMLElement
}

/** Class-attribute membership by TOKEN — `rounded-md` must not read as `rounded`. */
function hasClass(el: HTMLElement, token: string): boolean {
  return (el.getAttribute("class") ?? "").split(/\s+/).includes(token)
}

describe("Skeleton while loading", () => {
  it("renders a div by default, carrying the scope attribute", () => {
    const el = firstEl(<Skeleton />)
    expect(el.tagName).toBe("DIV")
    expect(el.getAttribute("data-adaptv")).toBe("skeleton")
  })

  it("is hidden from assistive technology — the region speaks, not the row", () => {
    expect(firstEl(<Skeleton />).getAttribute("aria-hidden")).toBe("true")
  })

  it("forwards native div props", () => {
    const el = firstEl(<Skeleton id="x" data-testid="t" />)
    expect(el.id).toBe("x")
    expect(el.getAttribute("data-testid")).toBe("t")
  })

  it("never renders the children — they are the loaded content", () => {
    //showing them inside the box would leak the very thing the skeleton stands in for
    const el = firstEl(
      <Skeleton>
        <b>secret</b>
      </Skeleton>,
    )
    expect(el.textContent).toBe("")
    expect(el.childElementCount).toBe(0)
  })

  it("ships the neutral look as a layered default, not a class", () => {
    const el = firstEl(<Skeleton />)
    expect(el.getAttribute("data-part")).toBe("root")
    expect(el.hasAttribute("class")).toBe(false)
    const rule = readFileSync(
      join(process.cwd(), "src/styles/skeleton.css"),
      "utf8",
    ).match(
      /:where\(\[data-adaptv="skeleton"\]\[data-part="root"\]\)\s*\{([^}]*)\}/,
    )?.[1]
    expect(rule).toContain("border-radius: var(--radius-md, 0.375rem);")
    expect(rule).toContain(
      "background-color: var(--color-gray-200, oklch(92.8% 0.006 264.531));",
    )
  })

  it("the consumer className is the shape and the size, and passes through untouched", () => {
    //§5.4.1: no shape prop — `rounded-full` IS the circle; with no adaptv class on the
    //element there is nothing for it to conflict with, and the layer order makes it win
    const el = firstEl(
      <Skeleton className="size-12 rounded-full bg-red-500" />,
    )
    expect(el.className).toBe("size-12 rounded-full bg-red-500")
  })

  it("locks no class, so a consumer's `animate-none` is theirs to keep", () => {
    //the pulse is a CSS rule on the attribute, not a locked class; the class
    //that turns it off must survive the merge and reach the later `utilities` layer
    expect(
      hasClass(
        firstEl(<Skeleton className="animate-none" />),
        "animate-none",
      ),
    ).toBe(true)
  })

  it("forwards the consumer style", () => {
    const el = firstEl(<Skeleton style={{ width: "7px" }} />)
    expect(el.style.width).toBe("7px")
  })

  it("forwards the ref to the box", () => {
    let seen: HTMLDivElement | null = null
    render(
      <Skeleton
        ref={(node) => {
          seen = node
        }}
      />,
    )
    expect(seen).not.toBeNull()
    expect(
      (seen as unknown as HTMLElement).getAttribute("data-adaptv"),
    ).toBe("skeleton")
  })
})

describe("Skeleton loading={false}", () => {
  it("renders the children as-is, with no element of its own", () => {
    const { container } = render(
      <Skeleton loading={false} className="h-4 w-40">
        <b>done</b>
      </Skeleton>,
    )
    expect(container.childElementCount).toBe(1)
    expect(container.firstElementChild?.tagName).toBe("B")
    expect(container.querySelector('[data-adaptv="skeleton"]')).toBeNull()
    expect(container.querySelector("[aria-hidden]")).toBeNull()
    //nothing wears the box's className either — there is no box
    expect(container.querySelector(".h-4")).toBeNull()
  })

  it("renders nothing at all when there are no children", () => {
    const { container } = render(<Skeleton loading={false} />)
    expect(container.childElementCount).toBe(0)
    expect(container.textContent).toBe("")
  })
})

describe("Skeleton render", () => {
  it("renders the element it is given", () => {
    expect(firstEl(<Skeleton render={<span />} />).tagName).toBe("SPAN")
  })

  it("still stamps its attributes on the rendered element", () => {
    const el = firstEl(<Skeleton render={<span />} />)
    expect(el.getAttribute("data-adaptv")).toBe("skeleton")
    expect(el.getAttribute("aria-hidden")).toBe("true")
  })

  it("joins the slot's className and Skeleton's, the slot's first", () => {
    //both are the CONSUMER tier, so both reach the DOM as written — and nothing of
    //adaptv's joins them
    const el = firstEl(
      <Skeleton render={<span className="h-2" />} className="h-4" />,
    )
    expect(el.className).toBe("h-2 h-4")
  })

  it("loading={false} ignores the render element too", () => {
    const { container } = render(
      <Skeleton loading={false} render={<span />}>
        text
      </Skeleton>,
    )
    expect(container.querySelector("span")).toBeNull()
    expect(container.textContent).toBe("text")
  })
})

describe("Skeleton.Region", () => {
  it("carries its own scope attribute, so styling the boxes never touches it", () => {
    const el = firstEl(<Skeleton.Region loading />)
    expect(el.tagName).toBe("DIV")
    expect(el.getAttribute("data-adaptv")).toBe("skeleton-region")
  })

  it("is busy while loading, and the attribute is ABSENT when not", () => {
    //absent rather than `aria-busy="false"`: the resting state is not a value
    expect(
      firstEl(<Skeleton.Region loading />).getAttribute("aria-busy"),
    ).toBe("true")
    expect(
      firstEl(<Skeleton.Region loading={false} />).hasAttribute(
        "aria-busy",
      ),
    ).toBe(false)
  })

  it("announces the label once, through a polite live region, only while loading", () => {
    const { getByRole, rerender } = render(
      <Skeleton.Region loading label="Loading tasks">
        <Skeleton />
        <Skeleton />
      </Skeleton.Region>,
    )
    const status = getByRole("status")
    //`<output>` carries the role and the polite live-ness natively
    expect(status.tagName).toBe("OUTPUT")
    expect(status.textContent).toBe("Loading tasks")
    //visually hidden by the layered `sr-only` recipe keyed on this part
    expect(status.getAttribute("data-adaptv")).toBe(
      "skeleton-region-status",
    )
    expect(status.getAttribute("data-part")).toBe("status")
    expect(status.hasAttribute("class")).toBe(false)
    expect(
      readFileSync(join(process.cwd(), "src/styles/skeleton.css"), "utf8"),
    ).toMatch(
      /:where\(\[data-adaptv="skeleton-region-status"\]\[data-part="status"\]\)\s*\{[^}]*clip-path: inset\(50%\);[^}]*position: absolute;/,
    )
    //one announcement for two rows: the rows themselves are aria-hidden
    expect(
      status.parentElement?.querySelectorAll("[aria-hidden]").length,
    ).toBe(2)

    rerender(
      <Skeleton.Region loading={false} label="Loading tasks">
        <b>done</b>
      </Skeleton.Region>,
    )
    //the live region STAYS mounted (a region that mounts with its text already
    //inside is not reliably announced) — only its text goes
    expect(getByRole("status").textContent).toBe("")
  })

  it("defaults the label to Loading", () => {
    expect(
      firstEl(<Skeleton.Region loading />).querySelector("output")
        ?.textContent,
    ).toBe("Loading")
  })

  it("renders the children in both states", () => {
    expect(
      firstEl(
        <Skeleton.Region loading>
          <b>rows</b>
        </Skeleton.Region>,
      ).querySelector("b")?.textContent,
    ).toBe("rows")
    expect(
      firstEl(
        <Skeleton.Region loading={false}>
          <b>rows</b>
        </Skeleton.Region>,
      ).querySelector("b")?.textContent,
    ).toBe("rows")
  })

  it("forwards native div props and the consumer className unopposed", () => {
    const el = firstEl(
      <Skeleton.Region loading className="gap-2" id="r" />,
    )
    expect(el.id).toBe("r")
    expect(el.className).toBe("gap-2")
  })
})

/*
 * The two `@media` quirks, on the stylesheet. `compileAdaptvStyles` is the real
 * Tailwind over `src/styles/index.css`, so these prove the rules SHIP — an unwired
 * `@import` or a rule Tailwind dropped would pass a source-text check and reach no
 * consumer.
 */
describe("skeleton.css", () => {
  //comments stripped: the prose explains what the file avoids, by name
  const source = readFileSync(
    join(process.cwd(), "src/styles/skeleton.css"),
    "utf8",
  ).replace(/\/\*[\s\S]*?\*\//g, "")

  /**
   * Every `@media` block for `query` in the output, each with its rules. There is
   * more than one — the drawer has its own reduced-motion block — so the assertion
   * is "one of them carries the skeleton rule", not "the first one does".
   */
  function mediaBlocks(css: string, query: string): string[] {
    const blocks: string[] = []
    let from = 0
    for (;;) {
      const start = css.indexOf(`@media ${query}`, from)
      if (start === -1) return blocks
      let depth = 0
      let end = -1
      for (let i = css.indexOf("{", start); i < css.length; i++) {
        if (css[i] === "{") depth++
        else if (css[i] === "}" && --depth === 0) {
          end = i + 1
          break
        }
      }
      if (end === -1) return blocks
      blocks.push(css.slice(start, end))
      from = end
    }
  }

  it("is wired into the shipped bundle, inside the components layer", async () => {
    const css = await compileAdaptvStyles([])
    expect(css).toContain("@keyframes adaptv-skeleton-pulse")
    const layer = css.indexOf("@layer adaptv.components")
    const rule = css.indexOf('[data-adaptv="skeleton"]')
    expect(layer).toBeGreaterThan(-1)
    expect(rule).toBeGreaterThan(layer)
  })

  it("pulses opacity — composited on a WebView — rather than sliding a gradient", async () => {
    const css = await compileAdaptvStyles([])
    expect(css).toMatch(
      /\[data-adaptv="skeleton"\]\s*\{[^}]*animation: adaptv-skeleton-pulse [^;]*infinite/,
    )
    expect(source).not.toContain("background-position")
  })

  it("stops under prefers-reduced-motion in CSS, so there is no hydration gap", async () => {
    const css = await compileAdaptvStyles([])
    const blocks = mediaBlocks(css, "(prefers-reduced-motion: reduce)")
    expect(blocks.length).toBeGreaterThan(0)
    expect(
      blocks.some((block) =>
        /\[data-adaptv="skeleton"\]\s*\{\s*animation: none;?\s*\}/.test(
          block,
        ),
      ),
    ).toBe(true)
    //the hook is `false` on the server; the whole point is that it is NOT consulted
    //(the docblock names it as the wrong tool, so this checks the IMPORT, not the word)
    expect(
      readFileSync(
        join(process.cwd(), "src/components/skeleton.tsx"),
        "utf8",
      ),
    ).not.toMatch(/from "#adaptv\/hooks\/use-reduced-motion"/)
  })

  it("stays visible under forced colors: keeps its paint, and draws a CanvasText border", async () => {
    const css = await compileAdaptvStyles([])
    expect(css).toMatch(
      /\[data-adaptv="skeleton"\]\s*\{[^}]*forced-color-adjust: none/,
    )
    const blocks = mediaBlocks(css, "(forced-colors: active)")
    expect(blocks.length).toBeGreaterThan(0)
    expect(
      blocks.some((block) =>
        /\[data-adaptv="skeleton"\]\s*\{\s*border: 1px solid CanvasText;?\s*\}/.test(
          block,
        ),
      ),
    ).toBe(true)
  })

  it("uses no !important — the layer is the mechanism (§6.0.1)", () => {
    expect(source).not.toContain("!important")
  })
})
