import { cleanup, render } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { Screen } from "#nativ/components/screen"

afterEach(cleanup)

describe("Screen", () => {
  it("fills the shell and renders children", () => {
    const { getByTestId } = render(
      <Screen data-testid="screen">
        <span>hello</span>
      </Screen>,
    )
    const el = getByTestId("screen")
    expect(el.className).toContain("flex-1")
    expect(el.className).toContain("min-h-0")
    expect(el.className).toContain("flex-col")
    expect(el.textContent).toBe("hello")
  })

  it("defaults to no inset (edge-to-edge)", () => {
    const { getByTestId } = render(<Screen data-testid="screen" />)
    const className = getByTestId("screen").className
    expect(className).not.toContain("p-safe")
    expect(className).not.toContain("px-safe")
  })

  it("applies the safe inset", () => {
    const { getByTestId } = render(
      <Screen data-testid="screen" inset="safe" />,
    )
    expect(getByTestId("screen").className).toContain("p-safe")
  })

  it("applies the horizontal-only safe inset", () => {
    const { getByTestId } = render(
      <Screen data-testid="screen" inset="safe-x" />,
    )
    const className = getByTestId("screen").className
    expect(className).toContain("px-safe")
    expect(className).not.toContain("p-safe ")
  })

  it("merges a caller className", () => {
    const { getByTestId } = render(
      <Screen
        data-testid="screen"
        className="bg-background items-center"
      />,
    )
    const className = getByTestId("screen").className
    expect(className).toContain("bg-background")
    expect(className).toContain("items-center")
    expect(className).toContain("flex-1")
  })
})
