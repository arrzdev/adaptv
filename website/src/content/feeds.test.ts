import { readFileSync } from "node:fs"
import { describe, expect, it, vi } from "vitest"
import { POSTS, type Post } from "@/content/blog"
import { ALL_DOCS, DOCS } from "@/content/docs"
import { feedFiles, RSS_PATH, rssXml, SITEMAP_PATH, sitemapXml } from "./feeds"

//the real docs pages import their demos, and a demo imports the runtime; the feeds
//never render one, so empty modules are enough
vi.mock("adaptv/components", () => ({}))
vi.mock("adaptv/hooks", () => ({}))
vi.mock("adaptv/storage", () => ({}))
vi.mock("@/assets/captures/ios-list.png?adaptv-image", () => ({ default: {} }))

const SITE = "https://adaptv.tudu.dev"

function locs(xml: string) {
  return [...xml.matchAll(/<loc>([^<]*)<\/loc>/g)].map((m) => m[1])
}

describe("sitemap.xml", () => {
  const xml = sitemapXml(DOCS, POSTS)
  const urls = locs(xml)

  it("is a sitemaps.org urlset", () => {
    expect(xml).toMatch(/^<\?xml version="1\.0" encoding="UTF-8"\?>\n/)
    expect(xml).toContain(
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    )
    expect(xml.trimEnd()).toMatch(/<\/urlset>$/)
  })

  it("lists the landing, the docs home, every docs page, the blog and every post, once", () => {
    expect(urls).toHaveLength(3 + ALL_DOCS.length + POSTS.length)
    expect(new Set(urls).size).toBe(urls.length)
    expect(urls).toEqual(
      expect.arrayContaining([
        `${SITE}/`,
        `${SITE}/docs`,
        `${SITE}/blog`,
        ...ALL_DOCS.map((page) => `${SITE}/docs/${page.slug}`),
        ...POSTS.map((post) => `${SITE}/blog/${post.slug}`),
      ]),
    )
  })

  it("has only absolute site URLs, and no /lab route", () => {
    for (const url of urls) {
      expect(url.startsWith(`${SITE}/`), url).toBe(true)
      expect(url, url).not.toMatch(/\/lab(\/|$)/)
    }
  })

  it("dates each post with its publication day", () => {
    for (const post of POSTS)
      expect(xml).toContain(
        `<loc>${SITE}/blog/${post.slug}</loc><lastmod>${post.date}</lastmod>`,
      )
  })
})

describe("the blog's RSS feed", () => {
  const xml = rssXml(POSTS)
  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => m[1])

  it("is an RSS 2.0 channel that points at the blog and at itself", () => {
    expect(xml).toMatch(/^<\?xml version="1\.0" encoding="UTF-8"\?>\n/)
    expect(xml).toContain(
      '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
    )
    expect(xml).toContain(`<link>${SITE}/blog</link>`)
    expect(xml).toContain(
      `<atom:link href="${SITE}/${RSS_PATH}" rel="self" type="application/rss+xml"/>`,
    )
    expect(xml).toMatch(/<channel>\s*<title>[^<]+<\/title>/)
    expect(xml).toMatch(/<description>[^<]+<\/description>/)
  })

  it("has one item per post, newest first, each with its link, guid and RFC 822 date", () => {
    expect(items).toHaveLength(POSTS.length)
    const newestFirst = [...POSTS].sort((a, b) => b.date.localeCompare(a.date))
    newestFirst.forEach((post, index) => {
      const item = items[index]
      const url = `${SITE}/blog/${post.slug}`
      expect(item).toContain(`<link>${url}</link>`)
      expect(item).toContain(`<guid isPermaLink="true">${url}</guid>`)
      expect(item).toMatch(
        /<pubDate>(Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} [A-Z][a-z]{2} \d{4} 00:00:00 GMT<\/pubDate>/,
      )
      expect(new Date(item.match(/<pubDate>(.*)<\/pubDate>/)?.[1] ?? "")).toEqual(
        new Date(`${post.date}T00:00:00Z`),
      )
    })
  })

  it("escapes markup in titles and summaries", () => {
    const post: Post = {
      slug: "escaping",
      title: "<meta> & friends",
      date: "2026-10-09",
      kind: "Field note",
      summary: 'Reads "theme-color" <b>not</b>',
      blocks: [],
    }
    const feed = rssXml([post])
    expect(feed).toContain("<title>&lt;meta&gt; &amp; friends</title>")
    expect(feed).toContain(
      "<description>Reads &quot;theme-color&quot; &lt;b&gt;not&lt;/b&gt;</description>",
    )
  })
})

describe("the files the build writes", () => {
  it("are the sitemap at the root and the feed under /blog", () => {
    const files = feedFiles(DOCS, POSTS)
    expect(files.map((file) => file.path)).toEqual([SITEMAP_PATH, RSS_PATH])
    expect(SITEMAP_PATH).toBe("sitemap.xml")
    expect(RSS_PATH).toBe("blog/rss.xml")
  })

  it("include robots.txt's pointer to the sitemap", () => {
    const robots = readFileSync(
      new URL("../../public/robots.txt", import.meta.url),
      "utf8",
    )
    expect(robots).toMatch(/^Sitemap: https:\/\/adaptv\.tudu\.dev\/sitemap\.xml$/m)
  })
})
