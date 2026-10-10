import { describe, expect, it, vi } from "vitest"
import { ALL_DOCS, DOCS } from "@/content/docs"
import {
  docsMarkdownFiles,
  LLMS_TXT_PATH,
  markdownPath,
  markdownUrl,
  pageMarkdown,
} from "./markdown"
import type { DocPage } from "./types"

//the real pages import their demos, and a demo imports the runtime; the markdown never
//renders one, so empty modules are enough
vi.mock("adaptv/components", () => ({}))
vi.mock("adaptv/hooks", () => ({}))
vi.mock("adaptv/storage", () => ({}))
vi.mock("@/assets/captures/ios-list.png?adaptv-image", () => ({ default: {} }))

const files = docsMarkdownFiles(DOCS)
const llms = files.find((file) => file.path === LLMS_TXT_PATH)?.body ?? ""

describe("llms.txt", () => {
  it("opens with the title and a one-line summary", () => {
    expect(llms).toMatch(/^# adaptv\n\n> \S.*\n/)
  })

  it.each(ALL_DOCS.map((page) => [page.slug, page]))(
    "links %s with its title, .md URL and summary",
    (_, page) => {
      expect(llms).toContain(`- [${page.title}](${markdownUrl(page.slug)}): `)
    },
  )

  it("groups the links by docs section", () => {
    for (const group of DOCS)
      expect(llms).toContain(`\n## ${group.section}: ${group.title}\n`)
  })
})

describe("the .md pages", () => {
  it.each(ALL_DOCS.map((page) => [page.slug, page]))(
    "%s has a markdown file that opens with its title",
    (_, page) => {
      const file = files.find((item) => item.path === markdownPath(page.slug))
      expect(file?.body.startsWith(`# ${page.title}\n\n> `)).toBe(true)
    },
  )

  it("writes nothing but llms.txt and one file per page", () => {
    expect(files).toHaveLength(ALL_DOCS.length + 1)
  })
})

describe("pageMarkdown", () => {
  const page = (blocks: DocPage["blocks"]): DocPage => ({
    slug: "sample",
    title: "Sample",
    summary: "One line.",
    blocks,
  })

  it("replaces a demo with a note and its code", () => {
    const md = pageMarkdown(
      page([{ type: "demo", component: () => null, code: "<Switch />" }]),
    )
    expect(md).toContain(
      "_Live demo on https://adaptv.tudu.dev/docs/sample._ Its code:\n\n```tsx\n<Switch />\n```",
    )
  })

  it("points docs links at their markdown and other site links at the site", () => {
    const md = pageMarkdown(
      page([
        {
          type: "p",
          text: "See [Switch](/docs/switch#props) and [the blog](/blog).",
        },
      ]),
    )
    expect(md).toContain(
      "See [Switch](https://adaptv.tudu.dev/docs/switch.md#props) and [the blog](https://adaptv.tudu.dev/blog).",
    )
  })

  it("escapes a pipe inside a table cell", () => {
    const md = pageMarkdown(
      page([
        {
          type: "props",
          rows: [{ name: "tone", type: '"info" | "warn"', description: "x" }],
        },
      ]),
    )
    expect(md).toContain('| `tone` | `"info" \\| "warn"` |  | x |')
  })

  it("keeps a code block whole when the code holds a fence", () => {
    const md = pageMarkdown(
      page([
        { type: "code", label: "a.md", lang: "text", code: "```\nx\n```" },
      ]),
    )
    expect(md).toContain('````text title="a.md"\n```\nx\n```\n````')
  })
})
