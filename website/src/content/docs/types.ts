import type { Block } from "@/content/blocks"

/** The badges under a reference page's title. "Web" covers desktop and mobile browsers. */
export type Platform = "Web" | "PWA" | "iOS" | "Android"

export type DocPage = {
  /** The URL: /docs/<slug>. Flat, lowercase, hyphenated. */
  slug: string
  title: string
  /** One sentence under the title, and the search result's second line. */
  summary: string
  /** The whole `<title>`, at most 60 characters. Omit for "<title> — adaptv docs". */
  seoTitle?: string
  /** The meta description, at most 155 characters. Omit to use `summary`. */
  seoDescription?: string
  /** Reference pages: where the thing runs. Omit on guides. */
  platforms?: Platform[]
  /** Reference pages: the import line, e.g. `import { Switch } from "adaptv/components"`. */
  importLine?: string
  /** Repo-relative path of the implementation, e.g. "src/components/switch.tsx". */
  source?: string
  blocks: Block[]
}

export type DocGroup = {
  /** The sidebar tab this group sits under. */
  section: "Guides" | "Reference"
  title: string
  pages: DocPage[]
}
