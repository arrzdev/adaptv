// @vitest-environment node
import { readFileSync } from "node:fs"
import { join } from "node:path"
import type { Selector, SelectorComponent, StyleSheet } from "lightningcss"
import { transform } from "lightningcss"
import { describe, expect, it } from "vitest"
import {
  findUnwrappedHover,
  formatPatchCounts,
  rewriteActive,
  rewriteCssPatches,
  rewriteHover,
} from "#adaptv/vite/css-patch-rewrite.ts"

/*
 * The post-processor (patch-delivery.md §4). Its decision is pure, so it is tested
 * here on CSS strings; the build test (`css-patch-rewrite-build.test.ts`) proves Vite
 * actually runs it, and the playground e2e proves a finger sees the result.
 */

const fixture = (name: string) =>
  readFileSync(join(process.cwd(), "src/vite/fixtures", name), "utf8")

/** Every style rule's selectors, with the media queries it sits under. */
function rules(
  css: string,
): Array<{ media: string[]; selectors: Selector[] }> {
  const out: Array<{ media: string[]; selectors: Selector[] }> = []
  transform({
    filename: "probe.css",
    code: Buffer.from(css),
    visitor: {
      StyleSheet(sheet: StyleSheet) {
        const walk = (list: unknown[], media: string[]) => {
          for (const rule of list as Array<{
            type: string
            value: never
          }>) {
            const value = rule.value as {
              rules?: unknown[]
              selectors?: Selector[]
              query?: { mediaQueries: Array<{ condition: unknown }> }
            }
            if (rule.type === "media") {
              walk(value.rules ?? [], [
                ...media,
                JSON.stringify(value.query?.mediaQueries),
              ])
            } else if (rule.type === "style") {
              out.push({ media, selectors: value.selectors ?? [] })
              walk(value.rules ?? [], media)
            } else if (value.rules) {
              walk(value.rules, media)
            }
          }
        }
        walk(sheet.rules, [])
        //read-only: handing the sheet back makes lightningcss re-serialize it
      },
    },
  })
  return out
}

/** Specificity as [ids, classes, types], per Selectors 4 (`:where` 0, `:is`/`:not`/`:has` max). */
function specificity(selector: Selector): [number, number, number] {
  const total: [number, number, number] = [0, 0, 0]
  const add = (s: [number, number, number]) => {
    total[0] += s[0]
    total[1] += s[1]
    total[2] += s[2]
  }
  for (const c of selector as Array<
    SelectorComponent & { kind?: string; selectors?: Selector[] }
  >) {
    if (c.type === "id") add([1, 0, 0])
    else if (c.type === "class" || c.type === "attribute") add([0, 1, 0])
    else if (c.type === "type" || c.type === "pseudo-element")
      add([0, 0, 1])
    else if (c.type === "pseudo-class") {
      if (c.kind === "where") continue
      if (c.selectors) {
        const max = c.selectors
          .map(specificity)
          .sort((a, b) => b[0] - a[0] || b[1] - a[1] || b[2] - a[2])[0]
        if (max) add(max)
      } else add([0, 1, 0])
    }
  }
  return total
}

const HOVER_MQ = '"name":"hover"'

describe("rewriteHover", () => {
  it("moves a plain :hover rule under (hover: hover), with the focus guard and the hatch", () => {
    const out = rewriteHover(".card:hover { color: red }")
    expect(out?.counts.hover).toEqual({ rewritten: 1, refused: 0 })
    const [optedOut, guarded] = rules(out?.code ?? "")
    expect(optedOut?.media).toEqual([])
    expect(guarded?.media.join()).toContain(HOVER_MQ)
    expect(out?.code).toContain(
      ".card:hover:not(:where(:focus, :focus-within, [data-adaptv-no-hover], [data-adaptv-no-hover] *))",
    )
    expect(out?.code).toContain(
      ".card:hover:where([data-adaptv-no-hover], [data-adaptv-no-hover] *)",
    )
  })

  it("rewrites a third-party stylesheet, leaving no :hover a tap can stick", () => {
    const css = fixture("third-party-picker.css")
    expect(findUnwrappedHover(css).length).toBe(5)
    const out = rewriteHover(css)
    //five rules rewritten; `:not(:hover)` refused rather than switched off on touch
    expect(out?.counts.hover).toEqual({ rewritten: 5, refused: 1 })
    expect(findUnwrappedHover(out?.code ?? "")).toEqual([])
    //the non-hover half of a selector list stays outside the media query
    expect(out?.code).toMatch(
      /\.picker__header button:focus-visible, \.picker__header button:hover:where/,
    )
    //the negation is byte-for-byte what the library wrote, modulo printing
    expect(out?.code).toContain(".picker__day--disabled:not(:hover)")
  })

  it("leaves a rule already inside @media (hover: hover) alone", () => {
    const css = "@media (hover: hover) { .x:hover { color: red } }"
    expect(rewriteHover(css)).toBeNull()
    //…and the `any-hover` spelling, and an author who chose `(hover: none)`
    expect(
      rewriteHover(
        "@media (any-hover: hover) { .x:hover { color: red } }",
      ),
    ).toBeNull()
    expect(
      rewriteHover("@media (hover: none) { .x:hover { color: red } }"),
    ).toBeNull()
  })

  it("leaves Tailwind's nested form alone: the query sits inside &:hover", () => {
    const css = ".u { &:hover { @media (hover: hover) { color: red } } }"
    expect(rewriteHover(css)).toBeNull()
  })

  it("rewrites a nested &:hover that is not guarded", () => {
    const out = rewriteHover(".u { &:hover { color: red } }")
    expect(out?.counts.hover.rewritten).toBe(1)
    expect(findUnwrappedHover(out?.code ?? "")).toEqual([])
  })

  it("tokenizes a selector list with :is(), commas and strings", () => {
    const css = `:is(.a, .b):hover, .c, :is(.d:hover, .e) > .f, .g[title="x:hover, y"] { color: red }`
    const out = rewriteHover(css)
    expect(out?.counts.hover.rewritten).toBe(1)
    const code = out?.code ?? ""
    expect(findUnwrappedHover(code)).toEqual([])
    //the attribute string is data, not a selector: that item never moves
    const [outside, inside] = rules(code)
    const printed = (s: Selector[]) => JSON.stringify(s)
    expect(printed(outside?.selectors ?? [])).toContain(
      '"value":"x:hover, y"',
    )
    expect(printed(inside?.selectors ?? [])).not.toContain("x:hover, y")
    //`.c` is not a hover selector, so it stays outside
    expect(printed(inside?.selectors ?? [])).not.toContain('"name":"c"')
  })

  it("refuses a :hover inside :not() or :has(), and counts it", () => {
    for (const css of [
      ".x:not(:hover) { color: red }",
      ".x:has(.y:hover) { color: red }",
    ]) {
      const out = rewriteHover(css)
      expect(out?.counts.hover).toEqual({ rewritten: 0, refused: 1 })
      expect(out?.code).toBe(css)
    }
  })

  it("keeps every selector's specificity exactly as written", () => {
    const css = fixture("third-party-picker.css")
    const before = rules(css).flatMap((r) => r.selectors.map(specificity))
    const after = rules(rewriteHover(css)?.code ?? "").flatMap((r) =>
      r.selectors.map(specificity),
    )
    //every rewritten selector has the specificity of an original one, and no new value appears
    const known = new Set(before.map((s) => s.join()))
    for (const s of after) expect(known.has(s.join())).toBe(true)
  })

  it("is idempotent: a second pass rewrites nothing", () => {
    const once =
      rewriteHover(fixture("third-party-picker.css"))?.code ?? ""
    const twice = rewriteHover(once)
    expect(twice?.counts.hover.rewritten ?? 0).toBe(0)
  })

  it("returns null for a stylesheet without :hover, without parsing it", () => {
    expect(rewriteHover(".a { color: red }")).toBeNull()
  })
})

describe("rewriteActive", () => {
  it("splits an :active item by who owns the press, at the same specificity", () => {
    const css = ".tile:active { transform: scale(0.95) }"
    const out = rewriteActive(css)
    expect(out?.counts.active).toEqual({ rewritten: 1, refused: 0 })
    const [rule] = rules(out?.code ?? "")
    expect(rule?.selectors).toHaveLength(3)
    const code = out?.code ?? ""
    expect(code).toContain(".tile:active:not(:where([data-press-engine]))")
    expect(code).toContain(
      ".tile[data-pressed]:not(:where([data-adaptv-no-active], [data-adaptv-no-active] *))",
    )
    expect(code).toContain(
      ".tile:active:where([data-adaptv-no-active], [data-adaptv-no-active] *)",
    )
    const [original] = rules(css)[0]?.selectors ?? []
    for (const s of rule?.selectors ?? [])
      expect(specificity(s)).toEqual(specificity(original as Selector))
  })

  it("leaves the active: variant's output alone — it already routes", () => {
    const css = `.u[data-pressed]:not(:where([data-adaptv-no-active])) { scale: .95 }
.u:active:not([data-press-engine]) { scale: .95 }
.u:active:is([data-adaptv-no-active], [data-adaptv-no-active] *) { scale: .95 }`
    expect(rewriteActive(css)).toBeNull()
  })

  it("refuses :not(:active) and counts it", () => {
    const out = rewriteActive(".x:not(:active) { opacity: 1 }")
    expect(out?.counts.active).toEqual({ rewritten: 0, refused: 1 })
  })

  it("is idempotent", () => {
    const once = rewriteActive(".a:active { opacity: .5 }")?.code ?? ""
    expect(rewriteActive(once)).toBeNull()
  })
})

describe("the Tailwind output adaptv compiles", () => {
  const css = fixture("tailwind-serve-output.css")
  const count = (text: string, needle: string) =>
    text.split(needle).length - 1

  //the `hover:`/`active:` variants already carry the correction: the pass must find
  //nothing to do in them, or every Tailwind utility would be rewritten twice
  it("leaves every variant rule as compiled", () => {
    const out = rewriteCssPatches(css)?.code ?? css
    for (const variant of [
      "&:hover:not(:is(:focus, :focus-within))",
      "&[data-pressed]",
      "&:active:not([data-press-engine])",
    ]) {
      expect(count(out, variant)).toBe(count(css, variant))
    }
  })

  //what it does rewrite is adaptv's own autofill cover, which lists every state;
  //its bare `input:-webkit-autofill` item still covers all of them
  it("finds only the autofill cover's state list to rewrite", () => {
    const unwrapped = findUnwrappedHover(css)
    expect(unwrapped.length).toBeGreaterThan(0)
    for (const item of unwrapped)
      expect(item).toContain(":-webkit-autofill")
  })
})

describe("formatPatchCounts", () => {
  it("prints one line per build, refused rules named", () => {
    expect(
      formatPatchCounts({
        hover: { rewritten: 5, refused: 1 },
        active: { rewritten: 1, refused: 0 },
      }),
    ).toBe(
      "[adaptv] css patches: hover 5 rules (1 left as written), active 1 rule",
    )
  })
})
