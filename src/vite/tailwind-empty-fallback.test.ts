// @vitest-environment node
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { beforeAll, describe, expect, it, vi } from "vitest"
import { compileEveryUtility } from "#adaptv/styles/compile.test-helper"
import {
  RING_CARRIERS,
  RING_INSET_ORDER_MESSAGE,
  rewriteEmptyFallbacks,
  rewriteRingShadow,
  usesEmptyRingFallback,
} from "#adaptv/vite/tailwind-empty-fallback"

// Verbatim tailwindcss@4.2.4 output. Copied from its compiler, not hand-written — the
// rewrite is a text transform on someone else's generated CSS, so a paraphrase would test
// the wrong thing.
const RING_1 =
  ".ring-1 { --tw-ring-shadow: var(--tw-ring-inset,) 0 0 0 calc(1px + var(--tw-ring-offset-width)) var(--tw-ring-color, currentcolor); box-shadow: var(--tw-inset-shadow), var(--tw-inset-ring-shadow), var(--tw-ring-offset-shadow), var(--tw-ring-shadow), var(--tw-shadow); }"
const RING_OFFSET_2 =
  ".ring-offset-2 { --tw-ring-offset-width: 2px; --tw-ring-offset-shadow: var(--tw-ring-inset,) 0 0 0 var(--tw-ring-offset-width) var(--tw-ring-offset-color); }"
const RING_INSET = ".ring-inset { --tw-ring-inset: inset; }"
const RESET =
  "*, ::before, ::after, ::backdrop { --tw-ring-color: initial; --tw-ring-shadow: 0 0 #0000; --tw-ring-inset: initial; }"
const SHEET = [RING_1, RING_OFFSET_2, RING_INSET, RESET].join("\n")

describe("rewriteRingShadow", () => {
  // the bug: Chromium 113–118 drop any declaration containing `var(--x,)` when `--x` is a
  // registered property with no initial-value. That is this exact idiom.
  it("removes every empty var() fallback", () => {
    const out = rewriteRingShadow(SHEET) as string
    expect(out).not.toContain("var(--tw-ring-inset,)")
    expect(usesEmptyRingFallback(out)).toBe(false)
  })

  // Caught during the first device build, before it shipped: `--adaptv-ring` and
  // `--adaptv-ring-offset` are adaptv's PUBLIC focus-ring tokens (patches.css writes
  // `outline: 2px solid var(--adaptv-ring, currentColor)`), and a consumer may set them on
  // `:root`. Using those names as carriers would make every `ring-*` element redefine the
  // focus-ring colour as a box-shadow body, killing `:focus-visible` on EVERY browser —
  // a much worse bug than the one being fixed, and invisible in the fixed browsers' tests.
  it("never reuses adaptv's public ring tokens as carriers", () => {
    for (const taken of RING_CARRIERS.collidesWith) {
      expect(RING_CARRIERS.ring).not.toBe(taken)
      expect(RING_CARRIERS.ringOffset).not.toBe(taken)
    }
    // and the rewritten sheet must not write them either
    const out = rewriteRingShadow(SHEET) as string
    expect(out).not.toMatch(/--adaptv-ring\s*:/)
    expect(out).not.toMatch(/--adaptv-ring-offset\s*:/)
  })

  it("carries the ring body in an UNREGISTERED property", () => {
    const out = rewriteRingShadow(SHEET) as string
    expect(out).toContain(
      "--adaptv-tw-ring:0 0 0 calc(1px + var(--tw-ring-offset-width)) var(--tw-ring-color, currentcolor);--tw-ring-shadow:var(--adaptv-tw-ring);",
    )
    // registering it would reintroduce the bug it exists to dodge
    expect(out).not.toContain("@property --adaptv-tw-ring")
  })

  it("rewrites ring-offset with its own carrier, not the ring's", () => {
    const out = rewriteRingShadow(SHEET) as string
    expect(out).toContain(
      "--tw-ring-offset-shadow:var(--adaptv-tw-ring-offset)",
    )
  })

  // `.ring-inset` used to set a variable the width rule read; now it re-declares the whole
  // shadow, which only works because it is emitted after the widths (guarded below).
  it("turns ring-inset into a full re-declaration", () => {
    const out = rewriteRingShadow(SHEET) as string
    expect(out).toContain(
      "--tw-ring-shadow:inset var(--adaptv-tw-ring,0 0 #0000);",
    )
    expect(out).toContain(
      "--tw-ring-offset-shadow:inset var(--adaptv-tw-ring-offset,0 0 #0000);",
    )
  })

  // Tailwind's reset sets `--tw-ring-inset: initial`, which is not the keyword and must
  // survive untouched — rewriting it would hand every element an inset ring.
  it("leaves the reset's `--tw-ring-inset: initial` alone", () => {
    expect(rewriteRingShadow(SHEET) as string).toContain(
      "--tw-ring-inset: initial;",
    )
  })

  it("is a no-op on CSS that never used the idiom", () => {
    expect(rewriteRingShadow(".a { color: red }")).toBeNull()
    expect(rewriteRingShadow(RESET)).toBeNull()
  })

  // running twice must not double-wrap: the plugin sees dev and build, and HMR re-transforms
  it("is idempotent", () => {
    const once = rewriteRingShadow(SHEET) as string
    expect(rewriteRingShadow(once)).toBeNull()
  })

  // If Tailwind ever emits ring-inset first, the rewritten inset rule would lose the cascade
  // and insets would render ring-less. Refuse and say so, rather than half-work.
  it("refuses, loudly, if ring-inset is emitted before the widths", () => {
    const onOutOfOrder = vi.fn()
    const reordered = [RING_INSET, RING_1].join("\n")
    expect(rewriteRingShadow(reordered, onOutOfOrder)).toBeNull()
    expect(onOutOfOrder).toHaveBeenCalledOnce()
    expect(RING_INSET_ORDER_MESSAGE).toContain("113–118")
  })

  // minified output has no spaces and drops the final semicolon before `}`
  it("handles minified output", () => {
    const min =
      ".ring-1{--tw-ring-shadow:var(--tw-ring-inset,) 0 0 0 1px var(--tw-ring-color,currentcolor)}.ring-inset{--tw-ring-inset:inset}"
    const out = rewriteRingShadow(min) as string
    expect(out).not.toContain("var(--tw-ring-inset,)")
    expect(out).toContain("--tw-ring-shadow:var(--adaptv-tw-ring)}")
    expect(out).toContain(
      "--tw-ring-shadow:inset var(--adaptv-tw-ring,0 0 #0000);",
    )
  })

  // Measured on WebView 113: with no fallback, `--tw-ring-offset-shadow` computed to "" on
  // any element that had `ring-inset` but no `ring-offset-*` (i.e. almost all of them), and
  // that guaranteed-invalid value poisoned the whole `box-shadow` — ring correct, page wrong.
  it("gives every carrier reference a valid fallback", () => {
    const out = rewriteRingShadow(SHEET) as string
    // `.ring-inset` is the rule that needs them: it references carriers it does not set.
    // A width rule sets its own carrier in the same declaration, so it is always safe.
    const insetRule = out
      .split("\n")
      .find((line) => line.includes(".ring-inset")) as string
    expect(insetRule).toContain("var(--adaptv-tw-ring,0 0 #0000)")
    expect(insetRule).toContain("var(--adaptv-tw-ring-offset,0 0 #0000)")
  })

  // variants are the same declaration under a different selector — they must come along,
  // otherwise focus states specifically stay broken
  it("rewrites variants too", () => {
    const variant =
      ".focus\\:ring-2:focus { --tw-ring-shadow: var(--tw-ring-inset,) 0 0 0 2px var(--tw-ring-color, currentcolor); }"
    expect(rewriteRingShadow(variant) as string).toContain(
      "--tw-ring-shadow:var(--adaptv-tw-ring)",
    )
  })
})

/*
 * The same bug in every other composition Tailwind v4 builds out of independent parts.
 *
 * ⚠︎ No utility NAME is written below — only `--tw-*` parts, neutral selectors and values.
 * adaptv's `@source` scans this file, so a utility named here would ship in every
 * consumer's stylesheet (see the module header). The compiled sheet is Tailwind's WHOLE
 * class list instead, which is also the stronger claim, and every verbatim declaration below
 * is checked against it so none of them is a paraphrase.
 */

/**
 * Every `var(--tw-*,)` in tailwindcss@4.2.4's compiler, grouped by what reads it.
 * `--tw-ring-inset` is the ring rewrite's; the rest are the composition rewrite's.
 */
const EMPTY_FALLBACK_PARTS: Record<string, string[]> = {
  transform: [
    "--tw-rotate-x",
    "--tw-rotate-y",
    "--tw-rotate-z",
    "--tw-skew-x",
    "--tw-skew-y",
  ],
  touch: ["--tw-pan-x", "--tw-pan-y", "--tw-pinch-zoom"],
  numeric: [
    "--tw-ordinal",
    "--tw-slashed-zero",
    "--tw-numeric-figure",
    "--tw-numeric-spacing",
    "--tw-numeric-fraction",
  ],
  filter: [
    "--tw-blur",
    "--tw-brightness",
    "--tw-contrast",
    "--tw-grayscale",
    "--tw-hue-rotate",
    "--tw-invert",
    "--tw-saturate",
    "--tw-sepia",
    "--tw-drop-shadow",
  ],
  backdrop: [
    "--tw-backdrop-blur",
    "--tw-backdrop-brightness",
    "--tw-backdrop-contrast",
    "--tw-backdrop-grayscale",
    "--tw-backdrop-hue-rotate",
    "--tw-backdrop-invert",
    "--tw-backdrop-opacity",
    "--tw-backdrop-saturate",
    "--tw-backdrop-sepia",
  ],
  containment: [
    "--tw-contain-size",
    "--tw-contain-layout",
    "--tw-contain-paint",
    "--tw-contain-style",
  ],
  ring: ["--tw-ring-inset"],
}

const ANY_EMPTY_FALLBACK = /var\(\s*--tw-[\w-]+\s*,\s*\)/

/**
 * Tailwind's whole class list, compiled once for the file in `beforeAll`.
 *
 * The compile is ~0.35–0.5 s on an idle machine. Inside a test it would spend that out of
 * vitest's 5 s test timeout, and `pnpm gate` runs this file among 200+ others in parallel
 * workers on a machine shared with other heavy jobs, where CPU-bound tests elsewhere in the
 * suite have already timed out on load alone. So it is a hook with its own 30 s budget:
 * 60 times the idle cost, local to this one compile rather than a raised global timeout,
 * and still a fast, named failure if the compiler ever hangs.
 */
let every: string
const EVERY_UTILITY_TIMEOUT_MS = 30_000

const squeeze = (css: string) => css.replace(/\s+/g, " ")

/** `var(--tw-a,) var(--tw-b,)` — a composition, spelled the way Tailwind spells it. */
function read(group: string): string {
  return EMPTY_FALLBACK_PARTS[group].map((p) => `var(${p},)`).join(" ")
}

/** The carriers a rewritten rule declares, and the value that reads them. */
function carried(group: string): { carriers: string; value: string } {
  const parts = EMPTY_FALLBACK_PARTS[group]
  const carrier = (p: string) => `--adaptv-${p.slice(2)}`
  return {
    carriers: parts.map((p) => `${carrier(p)}:var(${p});`).join(""),
    value: parts.map((p) => `var(${carrier(p)},)`).join(" "),
  }
}

describe("rewriteEmptyFallbacks", () => {
  beforeAll(async () => {
    every = await compileEveryUtility()
  }, EVERY_UTILITY_TIMEOUT_MS)

  // If a Tailwind upgrade adds a composition, this names it — the rewrite is generic and
  // will already cover it, but the module header and the register entry list them.
  it("knows every empty fallback Tailwind's compiler can emit", () => {
    const lib = readFileSync(
      resolve(process.cwd(), "node_modules/tailwindcss/dist/lib.js"),
      "utf8",
    )
    const emitted = new Set(
      [...lib.matchAll(/var\((--tw-[\w-]+),\)/g)].map((m) => m[1]),
    )
    expect([...emitted].sort()).toEqual(
      Object.values(EMPTY_FALLBACK_PARTS).flat().sort(),
    )
  })

  it("leaves no empty fallback in anything Tailwind can generate", () => {
    const css = every
    for (const part of Object.values(EMPTY_FALLBACK_PARTS).flat()) {
      expect(css).toContain(`var(${part},)`)
    }
    expect(rewriteEmptyFallbacks(css)).not.toMatch(ANY_EMPTY_FALLBACK)
  })

  // THE invariant that keeps `inherits: false` true. An unregistered carrier inherits, so
  // a rule that read one without declaring it would pick up its parent's part. Declared in
  // the same block, it is always re-derived from the element's own non-inheriting part —
  // and a `var()` of an unset part is invalid at computed-value time, which for a custom
  // property means guaranteed-invalid, not inherited.
  it("declares every carrier once, in the block that reads it", () => {
    const out = rewriteEmptyFallbacks(every) as string
    let readers = 0
    for (const [, body] of out.matchAll(/\{([^{}]*)\}/g)) {
      for (const [, part] of body.matchAll(
        /var\(--adaptv-tw-([\w-]+),\)/g,
      )) {
        readers++
        const declarations = body.split(
          `--adaptv-tw-${part}:var(--tw-${part});`,
        )
        expect(declarations.length - 1, `${part} in {${body}}`).toBe(1)
      }
    }
    expect(readers).toBeGreaterThan(1000)
  })

  // Tailwind registers the parts for `inherits: false`; the fix leans on that, so the
  // registrations stay exactly as compiled and no carrier is ever registered.
  it("keeps Tailwind's @property rules and registers no carrier", () => {
    const css = every
    const out = rewriteEmptyFallbacks(css) as string
    const registrations = (s: string) =>
      s.match(/@property [^{]+\{[^}]*\}/g)
    expect(registrations(out)).toEqual(registrations(css))
    expect(out).not.toContain("@property --adaptv-tw-")
  })

  // Written out in full once, so the shape is readable without the helper.
  it("carries a composition through unregistered per-part carriers", () => {
    const body = `--tw-numeric-spacing: tabular-nums; font-variant-numeric: ${read("numeric")};`
    expect(squeeze(every)).toContain(`{ ${body} }`)
    expect(rewriteEmptyFallbacks(`.a { ${body} }`)).toBe(
      ".a { --tw-numeric-spacing: tabular-nums; --adaptv-tw-ordinal:var(--tw-ordinal);--adaptv-tw-slashed-zero:var(--tw-slashed-zero);--adaptv-tw-numeric-figure:var(--tw-numeric-figure);--adaptv-tw-numeric-spacing:var(--tw-numeric-spacing);--adaptv-tw-numeric-fraction:var(--tw-numeric-fraction);font-variant-numeric: var(--adaptv-tw-ordinal,) var(--adaptv-tw-slashed-zero,) var(--adaptv-tw-numeric-figure,) var(--adaptv-tw-numeric-spacing,) var(--adaptv-tw-numeric-fraction,); }",
    )
  })

  // [what, the setter Tailwind writes before the composition, property, what precedes
  // the parts in the value]. Each body is verified verbatim against the compiled sheet.
  it.each([
    ["touch", "--tw-pan-y: pan-y; ", "touch-action", ""],
    ["transform", "--tw-rotate-x: rotateX(45deg); ", "transform", ""],
    ["transform", "", "transform", "translateZ(0) "],
    ["filter", "--tw-grayscale: grayscale(50%); ", "filter", ""],
    ["containment", "--tw-contain-paint: paint; ", "contain", ""],
  ])("rewrites %s (%s%s: %s…)", (group, setter, property, prefix) => {
    const body = `${setter}${property}: ${prefix}${read(group)};`
    expect(squeeze(every)).toContain(`{ ${body} }`)
    const { carriers, value } = carried(group)
    expect(rewriteEmptyFallbacks(`.a { ${body} }`)).toBe(
      `.a { ${setter}${carriers}${property}: ${prefix}${value}; }`,
    )
  })

  // The prefixed and unprefixed backdrop properties read the same nine parts in one rule.
  it("declares a shared composition's carriers once per rule", () => {
    const [prefixed, unprefixed] = ["-webkit-backdrop", "backdrop"].map(
      (p) => `${p}-${"filter"}`,
    )
    const body = `--tw-backdrop-grayscale: grayscale(50%); ${prefixed}: ${read("backdrop")}; ${unprefixed}: ${read("backdrop")};`
    expect(squeeze(every)).toContain(`{ ${body} }`)
    const { carriers, value } = carried("backdrop")
    expect(rewriteEmptyFallbacks(`.a { ${body} }`)).toBe(
      `.a { --tw-backdrop-grayscale: grayscale(50%); ${carriers}${prefixed}: ${value}; ${unprefixed}: ${value}; }`,
    )
  })

  // The shape tailwindcss@4.2.4 compiles for the `!` modifier: every declaration marked.
  // Tailwind's class list carries no `!` forms, so this one is not checked against `every`.
  it("keeps !important on the composition", () => {
    const body = `--tw-blur: blur(8px) !important; filter: ${read("filter")} !important;`
    expect(rewriteEmptyFallbacks(`.a { ${body} }`)).toContain(
      `filter: ${carried("filter").value} !important;`,
    )
  })

  // The utility that empties a part WRITES nothing into it rather than reading it: there is
  // no fallback in that declaration to fix, and it must survive as Tailwind wrote it.
  it("leaves an empty setter alone", () => {
    expect(every).toContain(
      `--tw-blur:  ;\n    filter: ${read("filter")};`,
    )
    const out = rewriteEmptyFallbacks(
      `.a { --tw-blur:  ; filter: ${read("filter")}; }`,
    ) as string
    expect(
      out.startsWith(
        ".a { --tw-blur:  ; --adaptv-tw-blur:var(--tw-blur);",
      ),
    ).toBe(true)
  })

  it("handles minified output", () => {
    expect(
      rewriteEmptyFallbacks(
        ".a{--tw-blur:blur(8px);filter:var(--tw-blur,) var(--tw-brightness,)}",
      ),
    ).toBe(
      ".a{--tw-blur:blur(8px);--adaptv-tw-blur:var(--tw-blur);--adaptv-tw-brightness:var(--tw-brightness);filter:var(--adaptv-tw-blur,) var(--adaptv-tw-brightness,)}",
    )
  })

  // A selector's pseudo-class is not a property: only a declaration after `{`, `}` or `;`
  // is rewritten, which is what keeps Tailwind's nested variant output intact.
  it("rewrites inside nested variant blocks and never a selector", () => {
    const nested = `.a { &:hover { @media (hover: hover) { --tw-blur: blur(8px); filter: ${read("filter")}; } } }`
    const out = rewriteEmptyFallbacks(nested) as string
    expect(out).toContain(
      `.a { &:hover { @media (hover: hover) { --tw-blur: blur(8px); ${carried("filter").carriers}filter: ${carried("filter").value}; } } }`,
    )
  })

  // The ring keeps its own, device-proven rewrite byte for byte.
  it("routes the ring through rewriteRingShadow unchanged", () => {
    expect(rewriteEmptyFallbacks(SHEET)).toBe(rewriteRingShadow(SHEET))
    const out = rewriteEmptyFallbacks(every) as string
    expect(out).toContain("--tw-ring-shadow:var(--adaptv-tw-ring)")
    expect(out).not.toContain("--adaptv-tw-ring-inset")
  })

  // The ring's order guard refuses the WHOLE ring rewrite; the composition pass must not
  // then half-fix `--tw-ring-inset` with a shape nobody measured for a box-shadow body.
  it("still fixes compositions when the ring guard refuses", () => {
    const onOutOfOrder = vi.fn()
    const composed = `.a { --tw-blur: blur(8px); filter: ${read("filter")}; }`
    const out = rewriteEmptyFallbacks(
      [RING_INSET, RING_1, composed].join("\n"),
      onOutOfOrder,
    ) as string
    expect(onOutOfOrder).toHaveBeenCalledOnce()
    expect(out).toContain("var(--tw-ring-inset,)")
    expect(out).not.toContain("var(--tw-blur,)")
    expect(out).not.toContain("--adaptv-tw-ring-inset")
  })

  it("is idempotent and a no-op on CSS without the idiom", () => {
    const once = rewriteEmptyFallbacks(every)
    expect(once).not.toBeNull()
    expect(rewriteEmptyFallbacks(once as string)).toBeNull()
    expect(rewriteEmptyFallbacks(".a { filter: blur(2px) }")).toBeNull()
  })

  it("never names a composition carrier after a ring carrier or a public token", () => {
    for (const part of Object.values(EMPTY_FALLBACK_PARTS).flat()) {
      const carrier = `--adaptv-${part.slice(2)}`
      expect(carrier).not.toBe(RING_CARRIERS.ring)
      expect(carrier).not.toBe(RING_CARRIERS.ringOffset)
      expect(RING_CARRIERS.collidesWith).not.toContain(carrier)
    }
  })
})
