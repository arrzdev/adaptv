import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { STATS, type Stat, Stats } from "@/components/sections/stats"

afterEach(cleanup)

const SAMPLE: readonly Stat[] = [
  {
    value: "1,234",
    before: "weekly",
    glyph: "npm",
    label: "downloads",
    source: "https://api.npmjs.org/downloads/point/last-week/adaptv",
  },
  {
    value: "56",
    glyph: "avatars",
    label: "developers",
    source: "https://api.github.com/repos/arrzdev/adaptv",
  },
]

describe("stats band", () => {
  // the band shows only real figures: each one names the URL it was read from
  it("every figure on the site names its source", () => {
    for (const stat of STATS) expect(stat.source).toMatch(/^https:\/\//)
  })

  // adaptv is not on npm and has no stars yet (2026-10-18): no figure is real,
  // so the landing shows no band rather than placeholder numbers
  it("renders nothing while there is no real figure", () => {
    const { container } = render(<Stats stats={[]} />)
    expect(container.innerHTML).toBe("")
  })

  it("draws every figure it is given", () => {
    render(<Stats stats={SAMPLE} />)
    for (const stat of SAMPLE) expect(screen.getByText(stat.value)).toBeTruthy()
  })

  // happy-dom lays nothing out, so assert the rule that keeps a figure on one line on a
  // phone: the line never wraps, and its size follows the band's width (container units)
  it("keeps each figure on one line that scales with the band", () => {
    render(<Stats stats={SAMPLE} />)
    const line = screen.getByText(SAMPLE[0].value).parentElement
    expect(line?.className.split(" ")).toContain("whitespace-nowrap")
    expect(line?.closest("ul")?.className).toMatch(/cqi/)
  })
})
