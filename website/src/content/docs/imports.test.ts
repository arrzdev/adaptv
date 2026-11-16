import { describe, expect, it, vi } from "vitest"
import { ALL_DOCS } from "@/content/docs"
import { exportedNames } from "./adaptv-exports"
import type { DocPage } from "./types"

//the real pages import their demos, and a demo imports the runtime; this test reads
//only the strings of a page, so empty modules are enough
vi.mock("adaptv/components", () => ({}))
vi.mock("adaptv/hooks", () => ({}))
vi.mock("adaptv/storage", () => ({}))
vi.mock("@/assets/captures/ios-list.png?adaptv-image", () => ({ default: {} }))

/** Every string anywhere in a page: code blocks, demo code, the import line. */
function strings(value: unknown): string[] {
  if (typeof value === "string") return [value]
  if (Array.isArray(value)) return value.flatMap(strings)
  if (value !== null && typeof value === "object")
    return Object.values(value).flatMap(strings)
  return []
}

type DocImport = { subpath: string; name: string | undefined }

const IMPORT =
  /\bimport\s+(?:type\s+)?(?:([\w$]+)\s*,?\s*)?(\{[^}]*\})?\s*(?:from\s*)?["']adaptv\/([^"']+)["']/g

/** Each `import … from "adaptv/<subpath>"`, one entry per imported name. */
function adaptvImports(code: string): DocImport[] {
  const found: DocImport[] = []
  for (const [, defaultName, braces, subpath] of code.matchAll(IMPORT)) {
    const names = (braces ?? "")
      .slice(1, -1)
      .split(",")
      .map(
        (item) =>
          item
            .trim()
            .replace(/^type\s+/, "")
            .split(/\s+as\s+/)[0],
      )
      .filter((name) => name !== undefined && name !== "")
    if (defaultName !== undefined) names.push("default")
    if (names.length === 0) found.push({ subpath, name: undefined })
    for (const name of names) found.push({ subpath, name })
  }
  return found
}

/** What is wrong with the page's adaptv imports, one line each. */
function wrongImports(page: DocPage): string[] {
  const wrong: string[] = []
  for (const { subpath, name } of strings(page).flatMap(adaptvImports)) {
    const names = exportedNames(subpath)
    if (names === undefined)
      wrong.push(`"adaptv/${subpath}" is not in package.json exports`)
    else if (name !== undefined && !names.has(name))
      wrong.push(`${name} is not exported by "adaptv/${subpath}"`)
  }
  return [...new Set(wrong)]
}

describe("adaptvImports", () => {
  it("reads named, typed, aliased, default and multi-line imports", () => {
    const code = `import { Button, type ButtonProps, Text as T } from "adaptv/components"
import adaptv, {
  useTheme,
} from 'adaptv/vite'
import "adaptv/styles.css"`
    expect(adaptvImports(code)).toEqual([
      { subpath: "components", name: "Button" },
      { subpath: "components", name: "ButtonProps" },
      { subpath: "components", name: "Text" },
      { subpath: "vite", name: "useTheme" },
      { subpath: "vite", name: "default" },
      { subpath: "styles.css", name: undefined },
    ])
  })

  it("ignores imports from other packages", () => {
    expect(adaptvImports(`import { motion } from "motion/react"`)).toEqual([])
  })
})

describe("a docs code sample", () => {
  it("is caught when it imports a name the subpath does not export", () => {
    const page: DocPage = {
      slug: "made-up",
      title: "Made up",
      summary: "A page with a made-up import.",
      blocks: [
        {
          type: "code",
          label: "app.tsx",
          lang: "tsx",
          code: `import { Button, NotAComponent } from "adaptv/components"
import { thing } from "adaptv/nowhere"`,
        },
      ],
    }
    expect(wrongImports(page)).toEqual([
      'NotAComponent is not exported by "adaptv/components"',
      '"adaptv/nowhere" is not in package.json exports',
    ])
  })

  //a regex that stops matching would pass every page below without checking anything
  it("is found on the docs pages, about 110 of them", () => {
    const found = ALL_DOCS.flatMap((page) =>
      strings(page).flatMap(adaptvImports),
    )
    expect(found.length).toBeGreaterThan(100)
    expect(exportedNames("components")?.has("Button")).toBe(true)
  })

  it.each(ALL_DOCS.map((page) => [page.slug, page]))(
    "on %s imports only names adaptv exports",
    (_, page) => {
      expect(wrongImports(page)).toEqual([])
    },
  )
})
