import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { ComponentsBento } from "@/components/sections/components-bento"

afterEach(cleanup)

describe("components bento", () => {
  // happy-dom lays nothing out, so assert the rule that keeps the page from
  // scrolling sideways on a phone: without an explicit column the grid's
  // implicit track is `auto`, sized to the swipe rows' min-content (378 px in a
  // 342 px column at 390), and the cards push the landing 12 px wider.
  it("gives the phone layout one shrinkable column", () => {
    render(<ComponentsBento />)
    const grid = screen.getByText("Swipe actions").closest(".grid")
    expect(grid?.className.split(" ")).toContain("grid-cols-1")
  })
})
