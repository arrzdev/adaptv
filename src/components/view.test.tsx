import { render } from "@testing-library/react"
import type { ReactElement } from "react"
import { describe, expect, it } from "vitest"
import { View } from "#adaptv/components/view"

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
