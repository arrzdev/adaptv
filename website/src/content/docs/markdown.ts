import type { Block, PropRow, TargetRow } from "@/content/blocks"
import { GITHUB_URL, SITE_URL } from "@/content/site"
import type { DocGroup, DocPage } from "./types"

/*
 * The docs as plain markdown, for AI agents and anyone who wants the text without the
 * page: `/llms.txt` (the llmstxt.org index) and `/docs/<slug>.md` for every page. The
 * website's vite.config.ts writes the files into the build; nothing renders them at
 * request time. Kept free of React so a plain module loader can run it.
 */

/** A file the build writes, `path` relative to the site root. */
export type MarkdownFile = { path: string; body: string }

export const LLMS_TXT_PATH = "llms.txt"

export function markdownPath(slug: string) {
  return `docs/${slug}.md`
}

export function markdownUrl(slug: string) {
  return `${SITE_URL}/${markdownPath(slug)}`
}

/** Every file: `llms.txt` first, then one `.md` per docs page, in sidebar order. */
export function docsMarkdownFiles(groups: DocGroup[]): MarkdownFile[] {
  return [
    { path: LLMS_TXT_PATH, body: llmsTxt(groups) },
    ...groups.flatMap((group) =>
      group.pages.map((page) => ({
        path: markdownPath(page.slug),
        body: pageMarkdown(page),
      })),
    ),
  ]
}

export function llmsTxt(groups: DocGroup[]) {
  const out = [
    "# adaptv",
    "",
    "> A React framework: one codebase for desktop web, mobile web, an installable home-screen app (PWA), and real iOS and Android apps.",
    "",
    `Every link below is the markdown version of a page on ${SITE_URL}/docs. adaptv is pre-alpha: the docs say what is true today, and a note on a page says when something is unbuilt.`,
  ]
  for (const group of groups) {
    out.push("", `## ${group.section}: ${group.title}`, "")
    for (const page of group.pages)
      out.push(
        `- [${page.title}](${markdownUrl(page.slug)}): ${inline(page.summary)}`,
      )
  }
  out.push(
    "",
    "## Optional",
    "",
    `- [Source code](${GITHUB_URL}): the framework, its CLI and this site`,
    "",
  )
  return out.join("\n")
}

export function pageMarkdown(page: DocPage) {
  const out = [`# ${page.title}`, "", `> ${inline(page.summary)}`]
  const meta: string[] = []
  if (page.platforms) meta.push(`Platforms: ${page.platforms.join(", ")}`)
  if (page.source)
    meta.push(
      `Source: [${page.source}](${GITHUB_URL}/blob/main/${page.source})`,
    )
  if (meta.length) out.push("", ...meta.map((line) => `${line}  `))
  if (page.importLine) out.push("", fence("ts", page.importLine))
  for (const block of page.blocks) out.push("", blockMarkdown(block, page))
  out.push(
    "",
    "---",
    "",
    `The page with live demos: ${SITE_URL}/docs/${page.slug}`,
    "",
  )
  return out.join("\n")
}

function blockMarkdown(block: Block, page: DocPage): string {
  switch (block.type) {
    case "p":
      return inline(block.text)
    case "h2":
      return `## ${inline(block.text)}`
    case "h3":
      return `### ${inline(block.text)}`
    case "ul":
      return block.items.map((item) => `- ${inline(item)}`).join("\n")
    case "ol":
      return block.items
        .map((item, i) => `${i + 1}. ${inline(item)}`)
        .join("\n")
    case "code":
      return fence(block.lang, block.code, block.label)
    case "note":
      return `> **${block.tone === "warn" ? "Warning" : "Note"}:** ${inline(block.text)}`
    case "props":
      return propsTable(block.rows)
    case "table":
      return table(
        block.head,
        block.rows.map((row) => row.map(inline)),
      )
    case "demo": {
      const note = `_Live demo on ${SITE_URL}/docs/${page.slug}._`
      return block.code
        ? `${note} Its code:\n\n${fence(block.lang ?? "tsx", block.code)}`
        : note
    }
    case "api": {
      const out = [
        `### ${block.name}`,
        "",
        fence("ts", block.signature),
        "",
        inline(block.description),
      ]
      if (block.params?.length)
        out.push("", "Parameters:", "", propsTable(block.params))
      if (block.returns) out.push("", `Returns: ${inline(block.returns)}`)
      return out.join("\n")
    }
    case "targets":
      return targetsTable(block.rows)
  }
}

function propsTable(rows: PropRow[]) {
  return table(
    ["Name", "Type", "Default", "Description"],
    rows.map((row) => [
      `\`${row.name}\`${row.required ? " (required)" : ""}`,
      `\`${row.type}\``,
      row.default ? `\`${row.default}\`` : "",
      inline(row.description),
    ]),
  )
}

const STATUS: Record<TargetRow["status"], string> = {
  yes: "Yes",
  partial: "Partly",
  no: "No",
}

function targetsTable(rows: TargetRow[]) {
  return table(
    ["Target", "Works", "Note"],
    rows.map((row) => [
      row.target,
      STATUS[row.status],
      row.note ? inline(row.note) : "",
    ]),
  )
}

function table(head: string[], rows: string[][]) {
  const line = (cells: string[]) => `| ${cells.map(cell).join(" | ")} |`
  return [
    line(head),
    `| ${head.map(() => "---").join(" | ")} |`,
    ...rows.map(line),
  ].join("\n")
}

//a pipe ends a GFM cell even inside backticks (`"a" | "b"`), and a newline ends the row
function cell(text: string) {
  return text.replace(/\|/g, "\\|").replace(/\s*\n\s*/g, " ")
}

//a fence one backtick longer than any run inside the code, so a snippet holding ``` stays whole
function fence(lang: string, code: string, label?: string) {
  const longest = Math.max(
    2,
    ...[...code.matchAll(/`+/g)].map((m) => m[0].length),
  )
  const ticks = "`".repeat(longest + 1)
  const info = label ? `${lang} title="${label}"` : lang
  return `${ticks}${info}\n${code.replace(/\n+$/, "")}\n${ticks}`
}

//Text fields already use markdown's inline marks; only in-app links change. A docs link
//points at the page's markdown, any other site path becomes absolute.
function inline(text: string) {
  return text.replace(
    /\]\((\/[^)\s]*)\)/g,
    (_, href: string) => `](${absolute(href)})`,
  )
}

function absolute(href: string) {
  const docs = /^\/docs\/([a-z0-9-]+)(#[^)]*)?$/.exec(href)
  if (docs) return `${markdownUrl(docs[1])}${docs[2] ?? ""}`
  return `${SITE_URL}${href}`
}
