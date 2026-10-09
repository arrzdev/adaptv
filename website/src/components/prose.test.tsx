import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { Prose } from "@/components/prose"

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

/** happy-dom lays nothing out: give every element the widths a phone would. */
function layout({ scrollWidth, clientWidth }: Record<string, number>) {
  vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockReturnValue(
    scrollWidth,
  )
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(
    clientWidth,
  )
}

describe("table block", () => {
  it("keeps a code-token first cell on one line and lets a sentence wrap", () => {
    render(
      <Prose
        blocks={[
          {
            type: "table",
            head: ["Name", "What it does"],
            rows: [
              ["`render`", "Picks the rendering mode."],
              ["Routing from files", "You write the route files."],
            ],
          },
        ]}
      />,
    )
    expect(screen.getByText("render").closest("td")?.className).toContain(
      "whitespace-nowrap",
    )
    expect(
      screen.getByText("Routing from files").closest("td")?.className,
    ).not.toContain("whitespace-nowrap")
  })

  it("shows a fade at the right edge only while there is more to scroll", () => {
    layout({ scrollWidth: 900, clientWidth: 300 })
    render(
      <Prose
        blocks={[{ type: "table", head: ["A", "B"], rows: [["one", "two"]] }]}
      />,
    )
    const fade = screen.getByTestId("scroll-fade")
    expect(fade.dataset.more).toBe("true")

    const scroller = fade.previousElementSibling as HTMLElement
    scroller.scrollLeft = 600
    fireEvent.scroll(scroller)
    expect(fade.dataset.more).toBe("false")
  })

  it("shows no fade when the table fits", () => {
    layout({ scrollWidth: 700, clientWidth: 700 })
    render(
      <Prose
        blocks={[{ type: "table", head: ["A", "B"], rows: [["one", "two"]] }]}
      />,
    )
    expect(screen.getByTestId("scroll-fade").dataset.more).toBe("false")
  })
})

describe("props block", () => {
  it("gives phones a card with the description outside the table", () => {
    render(
      <Prose
        blocks={[
          {
            type: "props",
            rows: [
              {
                name: "render",
                type: '"ssr" | "spa"',
                default: '"ssr"',
                description: "How the web build renders.",
              },
            ],
          },
        ]}
      />,
    )
    const outside = screen
      .getAllByText("How the web build renders.")
      .filter((node) => !node.closest("table"))
    expect(outside).toHaveLength(1)
    expect(outside[0].closest("[data-props-cards]")?.className).toContain(
      "sm:hidden",
    )
    expect(
      screen.getByRole("table").parentElement?.parentElement?.className,
    ).toContain("max-sm:hidden")
  })
})
