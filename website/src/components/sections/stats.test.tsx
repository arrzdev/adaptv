import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { STATS, Stats } from "@/components/sections/stats"

afterEach(cleanup)

describe("stats band", () => {
  it("draws every figure from the one constant", () => {
    render(<Stats />)
    for (const stat of STATS) expect(screen.getByText(stat.value)).toBeTruthy()
  })

  // happy-dom lays nothing out, so assert the rule that keeps a figure on one line on a
  // phone: the line never wraps, and its size follows the band's width (container units)
  it("keeps each figure on one line that scales with the band", () => {
    render(<Stats />)
    const line = screen.getByText(STATS[0].value).parentElement
    expect(line?.className.split(" ")).toContain("whitespace-nowrap")
    expect(line?.closest("ul")?.className).toMatch(/cqi/)
  })
})
