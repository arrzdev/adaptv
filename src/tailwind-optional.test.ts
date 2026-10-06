import { readdirSync, readFileSync, statSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

/*
 * Tailwind is optional (docs/decisions/styling.md §0.1, "What follows"): adaptv's code
 * imports none of `tailwindcss`, `tailwind-merge` or `clsx`, and none of the three is a
 * peer or a dependency. Without this guard one comes back through a convenience import,
 * and a plain-CSS app fails to resolve it — or, worse, a peer warning teaches every user
 * that Tailwind is required after all.
 *
 * The one stylesheet allowed to name Tailwind is `styles/tailwind.css`, the optional
 * entry. Tests and `*.test-helper.ts` are exempt — they never ship, and the style tests
 * compile tailwind.css with the real Tailwind — but only while no shipped file imports a
 * helper, which the third test below proves.
 */

const SRC = path.join(process.cwd(), "src")
const BANNED = ["tailwindcss", "tailwind-merge", "clsx"]

/** Files allowed to import a banned package, and why. */
const ALLOWED: Record<string, string> = {
  "styles/tailwind.css": "the optional Tailwind entry",
}

const isTest = (rel: string) => /\.test(?:-helper)?\.tsx?$/.test(rel)

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name)
    return statSync(full).isDirectory() ? walk(full) : [full]
  })
}

const files = walk(SRC)
  .map((full) => path.relative(SRC, full).split(path.sep).join("/"))
  .filter((rel) => /\.(tsx?|mts|mjs|css)$/.test(rel))

const pkgName = `(?:${BANNED.map((n) => n.replace("-", "\\-")).join("|")})`
//the package itself or a subpath of it, never a longer name (`tailwindcss-safe-area`)
const specifier = `["']${pkgName}(?:/[^"']*)?["']`
const JS_IMPORT = new RegExp(
  `(?:\\bfrom\\s*${specifier}|(?<![@\\w])import\\s*${specifier}|(?<![@\\w])import\\s*\\(\\s*${specifier}|\\brequire\\s*\\(\\s*${specifier})`,
)
const CSS_IMPORT = new RegExp(
  `@(?:import|plugin|reference)\\s+(?:url\\(\\s*)?${specifier}`,
)

/** The banned imports in `source`, read as JS/TS or CSS by extension. */
function bannedImports(rel: string, source: string): string[] {
  const pattern = rel.endsWith(".css") ? CSS_IMPORT : JS_IMPORT
  return source
    .split("\n")
    .filter((line) => pattern.test(line))
    .map((line) => `${rel}: ${line.trim()}`)
}

describe("Tailwind is optional", () => {
  it("no shipped src/ file imports tailwindcss, tailwind-merge or clsx", () => {
    const offenders = files
      .filter((rel) => !isTest(rel) && !(rel in ALLOWED))
      .flatMap((rel) =>
        bannedImports(rel, readFileSync(path.join(SRC, rel), "utf8")),
      )
    expect(offenders).toEqual([])
  })

  it("catches each import form, and not a longer package name", () => {
    expect(
      bannedImports("a.ts", `import { clsx } from "clsx"`),
    ).toHaveLength(1)
    expect(bannedImports("a.ts", `import "tailwindcss/x"`)).toHaveLength(1)
    expect(
      bannedImports("a.ts", `await import('tailwind-merge')`),
    ).toHaveLength(1)
    expect(bannedImports("a.ts", `require("clsx")`)).toHaveLength(1)
    expect(bannedImports("a.css", `@import "tailwindcss";`)).toHaveLength(
      1,
    )
    expect(
      bannedImports("a.css", `@plugin "tailwindcss/x";`),
    ).toHaveLength(1)
    expect(
      bannedImports("a.ts", `import x from "tailwindcss-safe-area"`),
    ).toEqual([])
    //a comment or a string that NAMES Tailwind is not an import
    expect(bannedImports("a.ts", `// @import "tailwindcss";`)).toEqual([])
  })

  it("no shipped file imports a test helper, so the exemption holds", () => {
    const importers = files.filter(
      (rel) =>
        !rel.endsWith(".css") &&
        !isTest(rel) &&
        /from\s*["'][^"']*\.test-helper["']/.test(
          readFileSync(path.join(SRC, rel), "utf8"),
        ),
    )
    expect(importers).toEqual([])
  })

  it("none of the three is a peer dependency or a dependency", () => {
    const pkg = JSON.parse(
      readFileSync(path.join(process.cwd(), "package.json"), "utf8"),
    )
    for (const field of [
      "peerDependencies",
      "dependencies",
      "optionalDependencies",
    ]) {
      for (const name of BANNED) {
        expect(pkg[field]?.[name], `${field}.${name}`).toBeUndefined()
      }
    }
  })
})
