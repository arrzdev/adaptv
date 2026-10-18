import { describe, expect, it, vi } from "vitest"
import { Route as PostRoute } from "@/routing/pages/blog/post.page"
import { Route as DocRoute } from "@/routing/pages/docs/doc.page"
import { Route as HomeRoute } from "@/routing/pages/home.page"

//the real router, layouts and sections pull in the whole runtime; only the heads are read
vi.mock("adaptv/router", () => ({
  createFileRoute: () => (options: object) => ({ options }),
  notFound: () => new Error("not found"),
}))
vi.mock("adaptv/components", () => ({}))
vi.mock("@/components/site-page", () => ({ SitePage: () => null }))
vi.mock("@/components/prose", () => ({ Prose: () => null }))
vi.mock("@/components/docs-layout", () => ({ DocsLayout: () => null }))
vi.mock("@/components/sections/closing", () => ({ FinalCta: () => null }))
vi.mock("@/components/sections/components-bento", () => ({
  ComponentsBento: () => null,
}))
vi.mock("@/components/sections/hero", () => ({ Hero: () => null }))
vi.mock("@/components/sections/idea-to-installed", () => ({
  IdeaToInstalled: () => null,
}))
vi.mock("@/components/sections/where-it-runs", () => ({
  WhereItRuns: () => null,
}))
vi.mock("@/content/docs", () => ({
  ALL_DOCS: [
    {
      slug: "switch",
      title: "Switch",
      summary: "A toggle that follows the finger.",
      blocks: [],
    },
  ],
}))
vi.mock("@/content/blog", () => ({
  POSTS: [
    {
      slug: "the-loupe",
      title: "The loupe",
      date: "2026-10-09",
      kind: "Field note",
      author: "arrz.dev",
      summary: "Why the caret loupe lands in the wrong place.",
      blocks: [],
    },
  ],
}))

type Node = Record<string, unknown>
type Head = { meta?: Record<string, unknown>[] }
type Options = {
  loader?: (ctx: { params: { slug: string } }) => unknown
  head: (ctx: { loaderData?: unknown }) => Head
}

/** The one JSON-LD script a head writes, as its `@graph`. */
function graph(route: { options: unknown }, slug?: string): Node[] {
  const options = route.options as Options
  const loaderData = slug ? options.loader?.({ params: { slug } }) : undefined
  const scripts = (options.head({ loaderData }).meta ?? []).filter(
    (tag) => "script:ld+json" in tag,
  )
  expect(scripts).toHaveLength(1)
  const data = scripts[0]["script:ld+json"] as Node
  expect(data["@context"]).toBe("https://schema.org")
  return data["@graph"] as Node[]
}

function ofType(nodes: Node[], type: string) {
  return nodes.find((node) => [node["@type"]].flat().includes(type))
}

function crumbs(nodes: Node[]) {
  const list = ofType(nodes, "BreadcrumbList")?.itemListElement as Node[]
  return list.map(({ position, name, item }) => [position, name, item])
}

describe("structured data", () => {
  it("the home page describes the framework, its licence and its repository", () => {
    const software = ofType(graph(HomeRoute), "SoftwareApplication")
    expect(software).toMatchObject({
      "@type": ["SoftwareApplication", "SoftwareSourceCode"],
      name: "adaptv",
      url: "https://adaptv.tudu.dev/",
      license: "https://opensource.org/licenses/MIT",
      codeRepository: "https://github.com/arrzdev/adaptv",
    })
    expect(software?.description).toContain("pre-alpha")
    //nothing the site cannot back: no price, rating, download or version
    for (const key of [
      "offers",
      "aggregateRating",
      "downloadUrl",
      "softwareVersion",
    ])
      expect(software, key).not.toHaveProperty(key)
  })

  it("a docs page is a TechArticle under Docs", () => {
    const nodes = graph(DocRoute, "switch")
    expect(ofType(nodes, "TechArticle")).toMatchObject({
      headline: "Switch",
      description: "A toggle that follows the finger.",
      url: "https://adaptv.tudu.dev/docs/switch",
    })
    expect(ofType(nodes, "TechArticle")).not.toHaveProperty("datePublished")
    expect(crumbs(nodes)).toEqual([
      [1, "adaptv", "https://adaptv.tudu.dev/"],
      [2, "Docs", "https://adaptv.tudu.dev/docs"],
      [3, "Switch", "https://adaptv.tudu.dev/docs/switch"],
    ])
  })

  it("a post is a dated TechArticle by its author, under Blog", () => {
    const nodes = graph(PostRoute, "the-loupe")
    expect(ofType(nodes, "TechArticle")).toMatchObject({
      headline: "The loupe",
      description: "Why the caret loupe lands in the wrong place.",
      url: "https://adaptv.tudu.dev/blog/the-loupe",
      datePublished: "2026-10-09",
      author: { "@type": "Person", name: "arrz.dev" },
    })
    expect(crumbs(nodes)).toEqual([
      [1, "adaptv", "https://adaptv.tudu.dev/"],
      [2, "Blog", "https://adaptv.tudu.dev/blog"],
      [3, "The loupe", "https://adaptv.tudu.dev/blog/the-loupe"],
    ])
  })
})
