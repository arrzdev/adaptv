/*
 * The sitemap and the blog's RSS feed. Both are built from the same lists the routes
 * read (DOCS, POSTS), so a new page or post shows up without editing this file.
 * `scripts/docs-markdown.ts` writes them into the build next to llms.txt.
 */
import type { Post } from "./blog"
import type { MarkdownFile } from "./docs/markdown"
import type { DocGroup } from "./docs/types"
import { SITE_URL } from "./site"

export const SITEMAP_PATH = "sitemap.xml"
export const RSS_PATH = "blog/rss.xml"
export const RSS_TITLE = "adaptv blog"
/** The blog index's lede, and the feed's description. */
export const BLOG_LEDE =
  "Releases, and field notes on what a phone actually does when you put a web page in an app."

/** The `<link rel="alternate">` the blog pages put in their head. */
export const RSS_LINK = {
  rel: "alternate",
  type: "application/rss+xml",
  title: RSS_TITLE,
  href: `${SITE_URL}/${RSS_PATH}`,
}

const XML_HEAD = '<?xml version="1.0" encoding="UTF-8"?>\n'

function escapeXml(text: string) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

//newest first; posts of the same day keep their order in POSTS (sort is stable)
function newestFirst(posts: Post[]) {
  return [...posts].sort((a, b) => b.date.localeCompare(a.date))
}

/** Every public page. The routes in `src/routing/config.ts`, with their params filled. */
export function sitemapXml(groups: DocGroup[], posts: Post[]) {
  const pages: { path: string; lastmod?: string }[] = [
    { path: "/" },
    { path: "/docs" },
    ...groups.flatMap((group) =>
      group.pages.map((page) => ({ path: `/docs/${page.slug}` })),
    ),
    { path: "/blog", lastmod: newestFirst(posts)[0]?.date },
    ...posts.map((post) => ({
      path: `/blog/${post.slug}`,
      lastmod: post.date,
    })),
  ]
  const urls = pages.map(
    ({ path, lastmod }) =>
      `  <url><loc>${SITE_URL}${path}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ""}</url>\n`,
  )
  return `${XML_HEAD}<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("")}</urlset>\n`
}

//RFC 822, which RSS 2.0 requires: a post's YYYY-MM-DD becomes midnight UTC
function rfc822(date: string) {
  return new Date(`${date}T00:00:00Z`).toUTCString()
}

export function rssXml(posts: Post[]) {
  const sorted = newestFirst(posts)
  const items = sorted.map((post) => {
    const url = `${SITE_URL}/blog/${post.slug}`
    return [
      "    <item>",
      `      <title>${escapeXml(post.title)}</title>`,
      `      <link>${url}</link>`,
      `      <guid isPermaLink="true">${url}</guid>`,
      `      <pubDate>${rfc822(post.date)}</pubDate>`,
      `      <category>${escapeXml(post.kind)}</category>`,
      `      <description>${escapeXml(post.summary)}</description>`,
      "    </item>\n",
    ].join("\n")
  })
  return [
    `${XML_HEAD}<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">`,
    "  <channel>",
    `    <title>${RSS_TITLE}</title>`,
    `    <link>${SITE_URL}/blog</link>`,
    `    <description>${escapeXml(BLOG_LEDE)}</description>`,
    "    <language>en</language>",
    ...(sorted[0]
      ? [`    <lastBuildDate>${rfc822(sorted[0].date)}</lastBuildDate>`]
      : []),
    `    <atom:link href="${SITE_URL}/${RSS_PATH}" rel="self" type="application/rss+xml"/>`,
    `${items.join("")}  </channel>`,
    "</rss>\n",
  ].join("\n")
}

export function feedFiles(groups: DocGroup[], posts: Post[]): MarkdownFile[] {
  return [
    { path: SITEMAP_PATH, body: sitemapXml(groups, posts) },
    { path: RSS_PATH, body: rssXml(posts) },
  ]
}
