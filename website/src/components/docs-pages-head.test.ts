import { describe, expect, it, vi } from "vitest"
import { Route as DocRoute } from "@/routing/pages/docs/doc.page"
import { Route as DocsHomeRoute } from "@/routing/pages/docs.page"

//the real router, layout and pages pull in the whole runtime
vi.mock("adaptv/router", () => ({
  createFileRoute: () => (options: object) => ({ options }),
  notFound: () => new Error("not found"),
}))
vi.mock("@/components/docs-layout", () => ({ DocsLayout: () => null }))
vi.mock("@/components/docs-home", () => ({ DocsHome: () => null }))
vi.mock("@/content/docs", () => ({
  ALL_DOCS: [
    {
      slug: "switch",
      title: "Switch",
      summary: "A toggle that follows the finger.",
      blocks: [],
    },
  ],
  DOCS: [],
}))

type HeadTag = Record<string, string>
type Head = { meta?: HeadTag[]; links?: HeadTag[] }

function metaContent(head: Head, key: string) {
  return head.meta?.find((tag) => tag.property === key || tag.name === key)
    ?.content
}

const CARD = [
  "og:title",
  "og:description",
  "og:type",
  "og:url",
  "og:image",
  "twitter:card",
]

describe("a docs page's head", () => {
  const loader = DocRoute.options.loader as (ctx: unknown) => unknown
  const head = (DocRoute.options.head as (ctx: unknown) => Head)({
    loaderData: loader({ params: { slug: "switch" } }),
  })

  it("keeps the docs tab title and the summary as its description", () => {
    expect(head.meta).toContainEqual({ title: "Switch — adaptv docs" })
    expect(metaContent(head, "description")).toBe(
      "A toggle that follows the finger.",
    )
  })

  it("has the social card and a canonical link to its own address", () => {
    for (const key of CARD) expect(metaContent(head, key), key).toBeTruthy()
    expect(metaContent(head, "og:title")).toBe("Switch")
    expect(metaContent(head, "og:description")).toBe(
      "A toggle that follows the finger.",
    )
    expect(metaContent(head, "og:type")).toBe("website")
    expect(metaContent(head, "og:url")).toBe(
      "https://adaptv.tudu.dev/docs/switch",
    )
    expect(metaContent(head, "twitter:card")).toBe("summary_large_image")
    expect(head.links).toContainEqual({
      rel: "canonical",
      href: "https://adaptv.tudu.dev/docs/switch",
    })
  })
})

describe("the docs home's head", () => {
  const head = (DocsHomeRoute.options.head as () => Head)()

  it("keeps its tab title and has the card and a canonical link", () => {
    expect(head.meta).toContainEqual({ title: "Documentation — adaptv" })
    for (const key of CARD) expect(metaContent(head, key), key).toBeTruthy()
    expect(metaContent(head, "og:url")).toBe("https://adaptv.tudu.dev/docs")
    expect(head.links).toContainEqual({
      rel: "canonical",
      href: "https://adaptv.tudu.dev/docs",
    })
  })
})
