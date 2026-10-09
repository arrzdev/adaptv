import type { ReactNode } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"
import type { DocPage } from "@/content/docs"
import { Pager } from "./docs-layout"

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
