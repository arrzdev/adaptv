import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import type { ReactNode } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { DocPage } from "@/content/docs"
import { DocsNav, Pager } from "./docs-layout"

//the real links need a router; a plain anchor keeps the className the card passes
vi.mock("adaptv/components", () => ({
  Link: ({
    className,
    children,
  }: {
    className?: string
    children: ReactNode
  }) => (
    <a href="/docs" className={className}>
      {children}
    </a>
  ),
  View: ({
    className,
    children,
  }: {
    className?: string
    children: ReactNode
  }) => <div className={className}>{children}</div>,
  Drawer: {},
  ExternalLink: () => null,
  ScrollView: () => null,
}))
//the site header's theme toggle, and the real pages, pull in the whole runtime
vi.mock("adaptv/hooks", () => ({ useTheme: () => ({}) }))
vi.mock("@/content/docs", () => {
  const page = (slug: string) => ({
    slug,
    title: slug,
    summary: "",
    blocks: [],
  })
  return { ALL_DOCS: ["first", "middle", "last"].map(page), DOCS: [] }
})

afterEach(cleanup)

describe("Pager", () => {
  //adaptv's Link paints gray-950 unless a class sets the colour; on the dark page
  //that hid the page titles, so each card must take the site's theme token
  it("colours both cards with the foreground token", () => {
    const page = { slug: "middle" } as DocPage
    const html = renderToStaticMarkup(<Pager page={page} />)
    const anchors = [...html.matchAll(/<a [^>]*class="([^"]*)"/g)].map(
      (match) => match[1].split(" "),
    )
    expect(anchors).toHaveLength(2)
    for (const classes of anchors) expect(classes).toContain("text-foreground")
  })
})

describe("DocsNav search", () => {
  const search = () => screen.getByPlaceholderText("Search the docs")
  const type = (value: string) =>
    fireEvent.change(search(), { target: { value } })
  //the region is in the DOM before anything is typed: a screen reader only announces
  //changes to a live region that already exists (WCAG 4.1.3)
  const status = () => screen.getByRole("status")

  it("keeps a polite live region mounted, empty until a query is typed", () => {
    render(<DocsNav current="" />)
    expect(status().getAttribute("aria-live")).toBe("polite")
    expect(status().textContent).toBe("")
  })

  it("announces how many pages match", () => {
    render(<DocsNav current="" />)
    type("middle")
    expect(status().textContent).toBe("1 result")
    type("st")
    expect(status().textContent).toBe("2 results")
  })

  it("announces an empty result", () => {
    render(<DocsNav current="" />)
    type("zzz")
    expect(status().textContent).toBe("No results")
  })

  it("goes quiet again when the query is cleared", () => {
    render(<DocsNav current="" />)
    type("first")
    type("")
    expect(status().textContent).toBe("")
  })
})
