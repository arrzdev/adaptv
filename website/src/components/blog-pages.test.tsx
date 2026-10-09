import type { ReactNode } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"
import type { Post } from "@/content/blog"
import { Route as PostRoute } from "@/routing/pages/blog/post.page"
import { Route as BlogIndexRoute } from "@/routing/pages/blog.page"

//the real links need a router; a plain anchor keeps the className the card passes
vi.mock("adaptv/components", () => ({
  Link: ({
    className,
    children,
  }: {
    className?: string
    children: ReactNode
  }) => (
    <a href="/blog" className={className}>
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
  ExternalLink: () => null,
  ScrollView: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))
//the site header's theme toggle, and the real router, pull in the whole runtime
vi.mock("adaptv/hooks", () => ({ useTheme: () => ({}) }))
vi.mock("adaptv/router", () => ({
  createFileRoute: () => (options: object) => ({ options }),
  notFound: () => new Error("not found"),
}))
vi.mock("@/content/blog", () => {
  const post = (slug: string, date: string, kind: Post["kind"]): Post => ({
    slug,
    title: `title ${slug}`,
    date,
    kind,
    summary: `summary ${slug}`,
    blocks: [],
  })
  //array order is not date order: the index must not trust it
  return {
    POSTS: [
      post("older", "2026-10-07", "Field note"),
      post("same-day-first", "2026-10-08", "Field note"),
      post("newest", "2026-10-09", "Release"),
      post("same-day-second", "2026-10-08", "Field note"),
    ],
  }
})

type HeadTag = Record<string, string>
type Head = { meta?: HeadTag[]; links?: HeadTag[] }

function metaContent(head: Head, key: string) {
  return head.meta?.find((tag) => tag.property === key || tag.name === key)
    ?.content
}

describe("blog index", () => {
  const Index = BlogIndexRoute.options.component as () => ReactNode

  it("lists posts newest first, keeping array order within a day", () => {
    const html = renderToStaticMarkup(<Index />)
    const titles = [...html.matchAll(/title ([a-z-]+)/g)].map((m) => m[1])
    expect(titles).toEqual([
      "newest",
      "same-day-first",
      "same-day-second",
      "older",
    ])
  })

  it("paints the Release kind word in the brand colour, and only that one", () => {
    const html = renderToStaticMarkup(<Index />)
    expect(html).toMatch(
      /<span class="[^"]*\btext-brand\b[^"]*">Release<\/span>/,
    )
    expect(html).not.toMatch(/class="[^"]*\btext-brand\b[^"]*">Field note</)
  })
})

describe("social card", () => {
  const card = [
    "og:title",
    "og:description",
    "og:type",
    "og:url",
    "og:image",
    "og:image:width",
    "og:image:height",
    "og:image:alt",
    "twitter:card",
  ]

  it("is in a post's head, as an article at its own address", () => {
    const head = (PostRoute.options.head as (ctx: unknown) => Head)({
      loaderData: {
        slug: "newest",
        title: "title newest",
        summary: "summary newest",
        date: "2026-10-09",
      },
    })
    for (const key of card) expect(metaContent(head, key), key).toBeTruthy()
    expect(metaContent(head, "og:title")).toBe("title newest")
    expect(metaContent(head, "og:description")).toBe("summary newest")
    expect(metaContent(head, "og:type")).toBe("article")
    expect(metaContent(head, "article:published_time")).toBe("2026-10-09")
    expect(metaContent(head, "twitter:card")).toBe("summary_large_image")
    expect(metaContent(head, "og:url")).toBe(
      "https://adaptv.tudu.dev/blog/newest",
    )
    expect(metaContent(head, "og:image")).toMatch(
      /^https:\/\/adaptv\.tudu\.dev\//,
    )
    expect(head.links).toContainEqual({
      rel: "canonical",
      href: "https://adaptv.tudu.dev/blog/newest",
    })
  })

  it("is in the index's head, as a website", () => {
    const head = (BlogIndexRoute.options.head as () => Head)()
    for (const key of card) expect(metaContent(head, key), key).toBeTruthy()
    expect(metaContent(head, "og:type")).toBe("website")
    expect(head.links).toContainEqual({
      rel: "canonical",
      href: "https://adaptv.tudu.dev/blog",
    })
  })
})
