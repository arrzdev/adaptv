import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { render } from "@testing-library/react"
import type { ReactElement } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { droppedBySafe, View } from "#adaptv/components/view"
import { resetWarnOnce } from "#adaptv/utils/warn-once"

function classOf(ui: ReactElement): string {
  const { container } = render(ui)
  return (container.firstChild as HTMLElement).className
}

describe("View", () => {
  it("is a flex column by default", () => {
    const c = classOf(<View />)
    expect(c).toContain("flex")
    expect(c).toContain("flex-col")
  })

  it("row switches direction (and drops flex-col)", () => {
    const c = classOf(<View row />)
    expect(c).toContain("flex-row")
    expect(c).not.toContain("flex-col")
  })

  it("center + fill add the flex helpers", () => {
    const c = classOf(<View center fill />)
    expect(c).toContain("items-center")
    expect(c).toContain("justify-center")
    expect(c).toContain("flex-1")
    expect(c).toContain("min-h-0")
  })

  it("safe maps to safe-area padding and wins over a conflicting className", () => {
    const c = classOf(<View safe="bottom" className="pb-0" />)
    expect(c).toContain("pb-safe")
    expect(c).not.toContain("pb-0")
  })

  it("applies the consumer className (look)", () => {
    const c = classOf(<View className="bg-surface gap-3" />)
    expect(c).toContain("bg-surface")
    expect(c).toContain("gap-3")
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
