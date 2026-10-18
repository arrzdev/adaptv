import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { CodeLine, CodePanel } from "@/components/code"

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

const SAMPLE = { label: "app.tsx", lang: "tsx", code: "const a = 1" } as const

describe("code panel", () => {
  it("shows a fade at the right edge only while there is more to scroll", () => {
    layout({ scrollWidth: 700, clientWidth: 340 })
    render(<CodePanel samples={[SAMPLE]} />)
    const fade = screen.getByTestId("scroll-fade")
    expect(fade.dataset.more).toBe("true")

    const scroller = screen.getByRole("region", { name: "Code sample" })
    scroller.scrollLeft = 360
    fireEvent.scroll(scroller)
    expect(fade.dataset.more).toBe("false")
  })

  it("shows no fade when the code fits", () => {
    layout({ scrollWidth: 340, clientWidth: 340 })
    render(<CodePanel samples={[SAMPLE]} />)
    expect(screen.getByTestId("scroll-fade").dataset.more).toBe("false")
  })

  it("measures again when a tab shows another sample", () => {
    const width = vi
      .spyOn(HTMLElement.prototype, "scrollWidth", "get")
      .mockReturnValue(340)
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(340)
    render(
      <CodePanel
        samples={[SAMPLE, { label: "Terminal", lang: "bash", code: "pnpm" }]}
      />,
    )
    expect(screen.getByTestId("scroll-fade").dataset.more).toBe("false")

    width.mockReturnValue(700)
    fireEvent.click(screen.getByRole("button", { name: "Terminal" }))
    expect(screen.getByTestId("scroll-fade").dataset.more).toBe("true")
  })
})

describe("code line", () => {
  it("shows a fade at the right edge only while there is more to scroll", () => {
    layout({ scrollWidth: 500, clientWidth: 340 })
    render(<CodeLine label="Import">import {"{ Button }"}</CodeLine>)
    const fade = screen.getByTestId("scroll-fade")
    expect(fade.dataset.more).toBe("true")

    const scroller = screen.getByRole("region", { name: "Import" })
    scroller.scrollLeft = 160
    fireEvent.scroll(scroller)
    expect(fade.dataset.more).toBe("false")
  })

  it("shows no fade when the line fits", () => {
    layout({ scrollWidth: 340, clientWidth: 340 })
    render(<CodeLine label="Import">import</CodeLine>)
    expect(screen.getByTestId("scroll-fade").dataset.more).toBe("false")
  })
})
