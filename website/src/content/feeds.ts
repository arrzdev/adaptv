import type { Post } from "./blog"
import type { DocGroup } from "./docs"
import type { MarkdownFile } from "./docs/markdown"

export const SITEMAP_PATH = ""
export const RSS_PATH = ""

export function sitemapXml(_groups: DocGroup[], _posts: Post[]) {
  return ""
}

export function rssXml(_posts: Post[]) {
  return ""
}

export function feedFiles(_groups: DocGroup[], _posts: Post[]): MarkdownFile[] {
  return []
}
