import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"
import { lowerDevCss } from "#adaptv/vite/dev-css-lowering"
import {
  rewriteRingShadow,
  usesEmptyRingFallback,
} from "#adaptv/vite/tailwind-empty-fallback"

/*
 * The fixture is NOT hand-written. It is the exact string `@tailwindcss/vite:generate:serve`
 * returned for the playground's `src/styles/main.css`, captured from a real `adaptv dev web`
 * run on tailwindcss@4.2.4 by a throwaway `enforce: "pre"` plugin listed after Tailwind (so
 * it saw Tailwind's output before any adaptv rewrite). It is the input this transform gets in
 * dev, byte for byte, so the test cannot drift into testing a paraphrase of it.
 *
 * ⚠︎ Utility names are never spelled out in this file. adaptv's stylesheet sweeps `src/**`
 * with `@source`, so a utility named in a test string is compiled into every consumer's CSS.
 * The variant selectors are read out of the fixture by pattern instead.
 *
 * `import.meta.url` is not a file: URL under happy-dom, so resolve from cwd.
 */
const FIXTURE = readFileSync(
  resolve(process.cwd(), "src/vite/fixtures/tailwind-serve-output.css"),
  "utf8",
)

type Block = "style" | "group" | "keyframes" | "leaf"

/** At-rules whose block holds rules rather than declarations. */
const GROUP_AT_RULE =
  /^@(media|supports|layer|container|scope|starting-style|document)\b/

/**
 * Every place a rule is opened inside a style rule — which is what CSS nesting is, and what
 * an engine without nesting (Safari < 16.5, Chromium < 112) throws away.
 *
 * A small structural scan rather than a CSS parser on purpose: using lightningcss to check
 * lightningcss's own output would prove nothing. Comments and strings are skipped; a block
 * whose prelude starts with `@` is an at-rule (`@media`, `@supports`, `@layer`… hold rules,
 * `@property`, `@font-face`… hold declarations), anything else is a style rule, and the
 * frames inside an `@keyframes` are declaration blocks rather than style rules.
 */
function nestedRules(css: string): string[] {
  const found: string[] = []
  const stack: Block[] = []
  let prelude = ""
  for (let i = 0; i < css.length; i++) {
    const c = css[i]
    if (c === "/" && css[i + 1] === "*") {
      const end = css.indexOf("*/", i + 2)
      i = end === -1 ? css.length : end + 1
      continue
    }
    if (c === '"' || c === "'") {
      let j = i + 1
      while (j < css.length && css[j] !== c) j += css[j] === "\\" ? 2 : 1
      prelude += css.slice(i, j + 1)
      i = j
      continue
    }
    if (c === "{") {
      const head = prelude.trim()
      const parent = stack.at(-1)
      if (parent === "style") found.push(head)
      if (parent === "keyframes") stack.push("leaf")
      else if (GROUP_AT_RULE.test(head)) stack.push("group")
      else if (/^@[\w-]*keyframes\b/.test(head)) stack.push("keyframes")
      else if (head.startsWith("@")) stack.push("leaf")
      else stack.push("style")
      prelude = ""
    } else if (c === "}") {
      stack.pop()
      prelude = ""
    } else if (c === ";") {
      prelude = ""
    } else {
      prelude += c
    }
  }
  return found
}

/** `&` outside comments and strings, and unescaped: an escaped one is part of a class name. */
function nestingSelectors(css: string): number {
  const bare = css
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, '""')
  return (bare.match(/(?<!\\)&/g) ?? []).length
}

/** The escaped class selectors of one of adaptv's variants, read out of the stylesheet. */
function variantClasses(css: string, variant: "app" | "web"): string[] {
  const pattern = new RegExp(`\\.${variant}\\\\:(?:\\\\.|[\\w-])+`, "g")
  return [...new Set(css.match(pattern) ?? [])]
}

/**
 * Every `@media` prelude written in range syntax — `(width >= 40rem)` — which Safari only
 * parses from 16.4 (Chromium from 104). An engine that cannot parse a media query treats it as
 * `not all`, so every rule inside it never applies: all of Tailwind v4's breakpoints are
 * written this way.
 */
function rangeMediaQueries(css: string): string[] {
  const bare = css.replace(/\/\*[\s\S]*?\*\//g, "")
  return (bare.match(/@media[^{;]*\{/g) ?? [])
    .map((prelude) => prelude.slice(0, -1).trim())
    .filter((prelude) => /\([^()]*[<>=][^()]*\)/.test(prelude))
}

/**
 * Every `@media` prelude that negates a bare condition — `not (min-width: 40rem)`. That is the
 * Media Queries 4 spelling, and the engines without range syntax do not parse it either; the
 * spelling they do parse is `not all and (min-width: 40rem)`.
 */
function bareNegatedMediaQueries(css: string): string[] {
  const bare = css.replace(/\/\*[\s\S]*?\*\//g, "")
  return (bare.match(/@media[^{;]*\{/g) ?? [])
    .map((prelude) => prelude.slice(0, -1).trim())
    .filter((prelude) => /(^|[\s,(])not \(/.test(prelude))
}

/** The generated column of every source-map segment, per generated line. */
function mappedColumns(mappings: string): number[][] {
  const BASE64 =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
  return mappings.split(";").map((line) => {
    let column = 0
    return line
      .split(",")
      .filter(Boolean)
      .map((segment) => {
        //only the first VLQ field (the generated column, relative within the line) matters
        let value = 0
        let shift = 0
        for (const char of segment) {
          const digit = BASE64.indexOf(char)
          value += (digit & 31) << shift
          if (digit & 32) {
            shift += 5
            continue
          }
          column += value & 1 ? -(value >>> 1) : value >>> 1
          break
        }
        return column
      })
  })
}

/**
 * What `@tailwindcss/vite` writes above everything it compiled. The synthetic sheets below carry
 * it so they go down the same path the real one does.
 */
const TAILWIND_BANNER =
  "/*! tailwindcss v4.2.4 | MIT License | https://tailwindcss.com */\n"

const NATIVE = ':where(html[data-adaptv-platform="native"] *)'
const WEB = ':where(html[data-adaptv-platform="web"] *)'

describe("the fixture is the bug", () => {
  // the premise: if Tailwind ever stops nesting, these tests would pass vacuously
  it("is nested wherever a variant applies", () => {
    expect(nestedRules(FIXTURE).length).toBeGreaterThan(100)
    expect(nestingSelectors(FIXTURE)).toBeGreaterThan(50)
    expect(variantClasses(FIXTURE, "app").length).toBeGreaterThan(0)
    expect(variantClasses(FIXTURE, "web").length).toBeGreaterThan(0)
  })

  it("writes its breakpoints in range syntax", () => {
    expect(rangeMediaQueries(FIXTURE).length).toBeGreaterThan(0)
  })

  // A Tailwind bump changes what the serve plugin emits; this forces a re-capture with it.
  it("was captured from the tailwindcss installed here", () => {
    const installed = JSON.parse(
      readFileSync(
        resolve(process.cwd(), "node_modules/tailwindcss/package.json"),
        "utf8",
      ),
    ).version
    expect(FIXTURE.match(/^\/\*! tailwindcss v(\S+) /)?.[1]).toBe(
      installed,
    )
  })
})

describe("lowerDevCss on the real dev stylesheet", () => {
  const out = lowerDevCss(FIXTURE, "/app/src/styles/main.css").code

  it("leaves no rule nested inside a style rule", () => {
    expect(nestedRules(out)).toEqual([])
  })

  it("leaves no nesting selector", () => {
    expect(nestingSelectors(out)).toBe(0)
  })

  it("leaves no media query in range syntax", () => {
    expect(rangeMediaQueries(out)).toEqual([])
  })

  it("leaves no media query negating a bare condition", () => {
    expect(bareNegatedMediaQueries(out)).toEqual([])
  })

  // `sm:` still means `min-width: 40rem`, spelled so Safari < 16.4 parses it
  it("keeps every breakpoint, spelled as a min-width", () => {
    const widths = rangeMediaQueries(FIXTURE).map(
      (prelude) => /\(width >= ([^)]+)\)/.exec(prelude)?.[1],
    )
    expect(widths.length).toBeGreaterThan(0)
    for (const width of widths) {
      expect(width, "a range form other than `width >=`").toBeDefined()
      expect(out).toContain(`@media (min-width: ${width}) {`)
    }
  })

  // the symptom: content under the status bar in a native dev build on iOS 16.2
  it("emits every `app:` utility as top-level rules for both of its branches", () => {
    const classes = variantClasses(FIXTURE, "app")
    for (const cls of classes) {
      expect(out).toContain(`${cls}${NATIVE} {`)
      expect(out).toMatch(
        new RegExp(
          `@media \\(display-mode: standalone\\) \\{\\s*${cls.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\{`,
        ),
      )
    }
  })

  it("emits every `web:` utility as a top-level rule", () => {
    for (const cls of variantClasses(FIXTURE, "web")) {
      expect(out).toContain(`${cls}${WEB} {`)
    }
  })

  // Tailwind's own build does exactly this pass; it must not lose rules on the way
  it("warns about nothing Tailwind emitted", () => {
    expect(
      lowerDevCss(FIXTURE, "/app/src/styles/main.css").warnings,
    ).toEqual([])
  })

  // The ring rewrite runs next door and matches on text. lightningcss re-prints
  // `var(--x,)` as `var(--x, )`, so the rewrite has to keep working on what this emits.
  it("hands the ring rewrite a stylesheet it still rewrites completely", () => {
    expect(usesEmptyRingFallback(out)).toBe(true)
    const rewritten = rewriteRingShadow(out) as string
    expect(rewritten).not.toBeNull()
    expect(usesEmptyRingFallback(rewritten)).toBe(false)
    expect(rewritten).not.toMatch(/var\(\s*--tw-ring-inset\s*,\s*\)/)
    expect(rewritten).toContain("--tw-ring-shadow:var(--adaptv-tw-ring)")
    expect(rewritten).toContain(
      "--tw-ring-shadow:inset var(--adaptv-tw-ring,0 0 #0000)",
    )
  })
})

/*
 * The rest of what Tailwind's own production pass does to its output, on the shapes Tailwind
 * 4.2.4 writes for them. The playground's sheet happens not to use these variants, so they are
 * written out here — as media queries only: a class name in this file would be scanned into
 * every consumer's CSS.
 */
describe("lowerDevCss on a Tailwind sheet — the rest of production's pass", () => {
  const lower = (css: string) =>
    lowerDevCss(`${TAILWIND_BANNER}${css}`, "/app/src/styles/main.css")

  // `max-sm:` is `(width < 40rem)` and `not-sm:` is `not (width >= 40rem)`. lightningcss lowers
  // both to `not (min-width: 40rem)`, which Safari < 16.4 drops; production rewrites that after
  // lightningcss, and so must dev.
  it.each([
    [".probe { @media (width < 40rem) { color: red } }"],
    [".probe { @media not (width >= 40rem) { color: red } }"],
  ])("writes the negated breakpoint in `%s` as `not all and`", (css) => {
    const { code, warnings } = lower(css)
    expect(code).toContain("@media not all and (min-width: 40rem) {")
    expect(bareNegatedMediaQueries(code)).toEqual([])
    expect(warnings).toEqual([])
  })

  // `sm:max-md:` nests one media query in the other; the inner one is negated too
  it("rewrites a negated breakpoint nested in another", () => {
    const { code } = lower(
      ".probe { @media (width >= 40rem) { @media (width < 48rem) { color: red } } }",
    )
    expect(code).toContain("@media (min-width: 40rem) {")
    expect(code).toContain("@media not all and (min-width: 48rem) {")
    expect(bareNegatedMediaQueries(code)).toEqual([])
  })

  // An app's stylesheet can declare one, and Tailwind passes it through to its own pass
  it("resolves @custom-media, as production does", () => {
    const { code, warnings } = lower(
      "@custom-media --probe (width >= 40rem);\n.probe { @media (--probe) { color: red } }",
    )
    expect(code).toContain("@media (min-width: 40rem) {")
    expect(code).not.toContain("@custom-media")
    expect(code).not.toContain("--probe")
    expect(warnings).toEqual([])
  })
})

/*
 * A sheet Tailwind did not compile — a CSS module, a side-effect import, a dependency's CSS. In a
 * build, Tailwind's pass never sees it; only Vite's minifier does, at `build.cssTarget` (Vite 8:
 * Chrome 111 / Safari 16.4), which flattens nesting and leaves range syntax alone. Dev does the
 * same, so a sheet does not change shape between the two.
 */
describe("lowerDevCss on a sheet Tailwind did not compile", () => {
  const { code, warnings } = lowerDevCss(
    ".probe { &:hover { color: blue } @media (width < 40rem) { color: green } }",
    "/app/src/components/card.module.css",
  )

  it("flattens its nesting", () => {
    expect(nestedRules(code)).toEqual([])
    expect(nestingSelectors(code)).toBe(0)
    expect(code).toContain(".probe:hover {")
    expect(warnings).toEqual([])
  })

  it("leaves its media queries as written", () => {
    expect(code).toContain("@media (width < 40rem) {")
    expect(code).not.toContain("min-width")
  })
})

describe("lowerDevCss's source map", () => {
  it("maps the flattened sheet back to the file when asked", () => {
    const { map } = lowerDevCss(FIXTURE, "/app/src/styles/main.css", {
      sourceMap: true,
    })
    expect(map).not.toBeNull()
    const parsed = JSON.parse(map as string)
    //lightningcss writes the source relative, the same map Vite's own lightningcss
    //transformer hands on for a CSS file
    expect(parsed.sources).toHaveLength(1)
    expect(parsed.sources[0]).toMatch(/src\/styles\/main\.css$/)
    expect(parsed.mappings.length).toBeGreaterThan(0)
  })

  // `not all and` is inserted after lightningcss wrote the map, without re-mapping. That is exact
  // only while no segment on a rewritten line sits past the insertion point; lightningcss maps an
  // at-rule by its `@` alone. If that ever changes, this fails before a map points a column off.
  it("maps nothing past the point `not all and` is inserted at", () => {
    const { code, map } = lowerDevCss(
      `${TAILWIND_BANNER}.probe { @media (width < 40rem) { color: red } }\n.probe { @media (width >= 40rem) { @media (width < 48rem) { color: blue } } }`,
      "/app/src/styles/main.css",
      { sourceMap: true },
    )
    const columns = mappedColumns(JSON.parse(map as string).mappings)
    const rewritten = code
      .split("\n")
      .map((line, index) => ({ index, at: line.indexOf("not all and (") }))
      .filter(({ at }) => at !== -1)
    expect(rewritten).toHaveLength(2)
    for (const { index, at } of rewritten) {
      expect(columns[index]?.length ?? 0).toBeGreaterThan(0)
      for (const column of columns[index] ?? []) {
        expect(column).toBeLessThanOrEqual(at + "not ".length)
      }
    }
  })

  it("builds no map when the dev server does not want one", () => {
    expect(lowerDevCss(FIXTURE, "/app/src/styles/main.css").map).toBeNull()
  })
})
