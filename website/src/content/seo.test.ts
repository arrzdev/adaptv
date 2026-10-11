import { describe, expect, it, vi } from "vitest"
import { POSTS } from "@/content/blog"
import { ALL_DOCS } from "@/content/docs"
import { Route as DocRoute } from "@/routing/pages/docs/doc.page"
import { Route as DocsIndexRoute } from "@/routing/pages/docs.page"

//the real pages import their demos, and a demo imports the runtime; only the data is read
vi.mock("adaptv/components", () => ({}))
vi.mock("adaptv/hooks", () => ({}))
vi.mock("adaptv/storage", () => ({}))
vi.mock("@/assets/captures/ios-list.png?adaptv-image", () => ({ default: {} }))
vi.mock("@/components/docs-layout", () => ({ DocsLayout: () => null }))
vi.mock("@/components/docs-home", () => ({ DocsHome: () => null }))
vi.mock("adaptv/router", () => ({
  createFileRoute: () => (options: object) => ({ options }),
  notFound: () => new Error("not found"),
}))

type Meta = Record<string, string>
type Options = {
  loader: (ctx: { params: { slug: string } }) => unknown
  head: (ctx: { loaderData?: unknown }) => { meta: Meta[] }
}

function docHead(slug: string) {
  const options = DocRoute.options as unknown as Options
  return options.head({ loaderData: options.loader({ params: { slug } }) }).meta
}

const pages = [
  ...ALL_DOCS.map((page) => ({ path: `/docs/${page.slug}`, ...page })),
  ...POSTS.map((post) => ({ path: `/blog/${post.slug}`, ...post })),
]

describe("search titles and descriptions", () => {
  it.each(pages.map((page) => [page.path, page]))(
    "%s fits a search result",
    (_, page) => {
      expect(page.seoTitle?.length ?? 0).toBeLessThanOrEqual(60)
      expect(page.seoDescription?.length ?? 0).toBeLessThanOrEqual(155)
    },
  )

  it("a doc page writes its seoTitle and seoDescription into the head", () => {
    const page = ALL_DOCS.find((item) => item.seoTitle && item.seoDescription)
    if (!page) throw new Error("no doc page sets both")
    const meta = docHead(page.slug)
    expect(meta).toContainEqual({ title: page.seoTitle })
    expect(meta).toContainEqual({
      name: "description",
      content: page.seoDescription,
    })
  })

  it("a doc page without them keeps its title and describes itself with its summary", () => {
    const page = ALL_DOCS.find((item) => !item.seoTitle && !item.seoDescription)
    if (!page) throw new Error("every doc page sets both")
    const meta = docHead(page.slug)
    expect(meta).toContainEqual({ title: `${page.title} — adaptv docs` })
    expect(meta).toContainEqual({ name: "description", content: page.summary })
  })

  it("the docs home has a description", () => {
    const head = (DocsIndexRoute.options as unknown as Options).head({})
    expect(head.meta.find((tag) => tag.name === "description")).toBeTruthy()
  })
})

describe("internal links", () => {
  const paths = new Set(["/", "/docs", "/blog", ...pages.map((p) => p.path)])

  it.each(pages.map((page) => [page.path, page]))(
    "%s links only to pages that exist",
    (_, page) => {
      const hrefs = [
        ...JSON.stringify(page.blocks).matchAll(/\]\((\/[^)#]*)/g),
      ].map((match) => match[1])
      for (const href of hrefs) expect(paths, href).toContain(href)
    },
  )
})
