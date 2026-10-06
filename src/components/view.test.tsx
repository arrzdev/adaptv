import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { render } from "@testing-library/react"
import type { ReactElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, describe, expect, it, vi } from "vitest"
import { droppedBySafe, View } from "#adaptv/components/view"
import { resetWarnOnce } from "#adaptv/utils/warn-once"

function rootOf(ui: ReactElement): HTMLElement {
  const { container } = render(ui)
  return container.firstChild as HTMLElement
}

/**
 * The inline style the server renders, per property. Read off the markup because
 * happy-dom's CSSOM drops a `var()` padding value, so `el.style` cannot show the lock.
 */
function inlineStyleOf(ui: ReactElement): Record<string, string> {
  const style = renderToStaticMarkup(ui).match(
    /^<[^>]*\bstyle="([^"]*)"/,
  )?.[1]
  return Object.fromEntries(
    (style ?? "")
      .split(";")
      .filter(Boolean)
      .map((decl) => {
        const at = decl.indexOf(":")
        return [decl.slice(0, at).trim(), decl.slice(at + 1).trim()]
      }),
  )
}

/** The body of one `:where(…)` default rule in view.css. */
function viewRule(selector: string): string | undefined {
  const css = readFileSync(
    resolve(__dirname, "../styles/view.css"),
    "utf8",
  )
  const escaped = selector.replace(/[[\]()"=.*-]/g, "\\$&")
  return css.match(
    new RegExp(`:where\\(${escaped}\\)\\s*\\{([^}]*)\\}`),
  )?.[1]
}

describe("View", () => {
  it("is a flex column by default — a layered rule, no class of its own", () => {
    const el = rootOf(<View />)
    expect(el.getAttribute("data-adaptv")).toBe("view")
    expect(el.getAttribute("data-part")).toBe("root")
    expect(el.hasAttribute("class")).toBe(false)
    const rule = viewRule('[data-adaptv="view"][data-part="root"]')
    expect(rule).toContain("display: flex;")
    expect(rule).toContain("flex-direction: column;")
  })

  it("row switches direction", () => {
    const el = rootOf(<View row />)
    expect(el.hasAttribute("data-view-row")).toBe(true)
    expect(rootOf(<View />).hasAttribute("data-view-row")).toBe(false)
    expect(
      viewRule('[data-adaptv="view"][data-part="root"][data-view-row]'),
    ).toContain("flex-direction: row;")
  })

  it("center + fill add the flex helpers", () => {
    const el = rootOf(<View center fill />)
    expect(el.hasAttribute("data-view-center")).toBe(true)
    expect(el.hasAttribute("data-view-fill")).toBe(true)
    const center = viewRule(
      '[data-adaptv="view"][data-part="root"][data-view-center]',
    )
    expect(center).toContain("align-items: center;")
    expect(center).toContain("justify-content: center;")
    const fill = viewRule(
      '[data-adaptv="view"][data-part="root"][data-view-fill]',
    )
    expect(fill).toContain("flex: 1;")
    expect(fill).toContain(
      "min-height: calc(var(--spacing, 0.25rem) * 0);",
    )
  })

  it("safe locks the safe-area padding inline, over a conflicting className and style", () => {
    const ui = (
      <View
        safe="bottom"
        className="pb-0"
        style={{ paddingBottom: "0px", opacity: 0.5 }}
      />
    )
    expect(inlineStyleOf(ui)).toEqual({
      "padding-bottom": "var(--adaptv-inset-bottom, 0px)",
      opacity: "0.5",
    })
    //the consumer class passes through untouched; it simply cannot win that edge
    expect(rootOf(ui).className).toBe("pb-0")
  })

  it("safe names its edges, and only those", () => {
    const top = "var(--adaptv-inset-top, 0px)"
    const right = "var(--adaptv-inset-right, 0px)"
    const bottom = "var(--adaptv-inset-bottom, 0px)"
    const left = "var(--adaptv-inset-left, 0px)"
    expect(inlineStyleOf(<View safe="all" />)).toEqual({
      "padding-top": top,
      "padding-right": right,
      "padding-bottom": bottom,
      "padding-left": left,
    })
    expect(inlineStyleOf(<View safe="x" />)).toEqual({
      "padding-right": right,
      "padding-left": left,
    })
    expect(inlineStyleOf(<View safe="y" />)).toEqual({
      "padding-top": top,
      "padding-bottom": bottom,
    })
    expect(inlineStyleOf(<View safe="top" />)).toEqual({
      "padding-top": top,
    })
    expect(inlineStyleOf(<View safe="bottom" />)).toEqual({
      "padding-bottom": bottom,
    })
    expect(inlineStyleOf(<View />)).toEqual({})
  })

  it("applies the consumer className (look) and style untouched", () => {
    const el = rootOf(
      <View className="bg-surface gap-3" style={{ opacity: "0.5" }} />,
    )
    expect(el.className).toBe("bg-surface gap-3")
    expect(el.style.opacity).toBe("0.5")
  })

  it("forwards native div props", () => {
    const { getByRole } = render(<View role="region" aria-label="x" />)
    expect(getByRole("region")).toBeTruthy()
  })
})

describe("View safe and the consumer's padding", () => {
  afterEach(() => {
    vi.restoreAllMocks()
    resetWarnOnce()
  })

  it("drops a padding class on the edges safe owns, and only those", () => {
    expect(droppedBySafe("all", "gap-4 p-6")).toEqual(["p-6"])
    expect(droppedBySafe("all", "gap-4 px-6")).toEqual(["px-6"])
    expect(droppedBySafe("bottom", "gap-4 p-6")).toEqual([])
    expect(droppedBySafe("all", "gap-4 p-safe-offset-6")).toEqual([
      "p-safe-offset-6",
    ])
    expect(droppedBySafe(undefined, "p-6")).toEqual([])
  })

  it("names the dropped class in a dev warning", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {})
    render(<View safe="all" className="gap-4 p-6" />)
    expect(error).toHaveBeenCalledTimes(1)
    expect(error.mock.calls[0][0]).toContain("p-6 was dropped")
    expect(error.mock.calls[0][0]).toContain("p-safe-offset-")
  })

  it("says nothing when no class is dropped", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {})
    render(<View safe="bottom" className="gap-4 px-6" />)
    render(<View className="p-safe-offset-6" />)
    expect(error).not.toHaveBeenCalled()
  })

  //The starter every created app begins from, the example, the README and the guides
  //all wrote `safe="all" className="... p-6"`: the p-6 was dropped and the first
  //screen of every app sat flush against the left edge on Android (TUD-84, run
  //37313755883). Every View snippet adaptv ships or teaches keeps its own padding.
  it("loses no padding in any View adaptv ships or teaches", () => {
    const root = resolve(__dirname, "../..")
    const files = [
      "README.md",
      "docs/guides/cookbook.md",
      "examples/basic/src/routing/pages/home.page.tsx",
      "packages/create-adaptv/template/src/routing/pages/home.page.tsx",
      ".github/android-smoke/routing/pages/home.page.tsx",
      ".github/android-smoke/routing/pages/form.page.tsx",
    ]
    const losses: string[] = []
    let views = 0
    for (const file of files) {
      const source = readFileSync(resolve(root, file), "utf8")
      for (const [tag] of source.matchAll(/<View\b[^>]*>/g)) {
        views++
        const safe = tag.match(/\bsafe="(\w+)"/)?.[1]
        const className = tag.match(/\bclassName="([^"]*)"/)?.[1]
        const dropped = droppedBySafe(
          safe as Parameters<typeof droppedBySafe>[0],
          className,
        )
        if (dropped.length > 0)
          losses.push(`${file}: ${tag} drops ${dropped}`)
      }
    }
    expect(
      views,
      "no View snippet was found, so this proves nothing",
    ).toBeGreaterThan(5)
    expect(losses).toEqual([])
  })
})
