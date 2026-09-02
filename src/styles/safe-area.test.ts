import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import {
  compileAdaptvStyles,
  compileCss,
  ruleFor,
} from "#adaptv/styles/compile.test-helper"
import { cn } from "#adaptv/utils/cn"

//The safe-area inset contract, guarded as text — docs/decisions/register.md §6.0 (B18). The rule
//is a source-ordering rule (`var(--safe-area-inset-*)` FIRST, `env()` only as
//fallback) that no DOM we can test against can tell apart from the naive spelling:
//happy-dom resolves both identically, and so does every engine except Android
//WebView < 140, the one that's actually broken. Locking the text is the only guard
//that fires. `import.meta.url` is not a file: URL under happy-dom, so resolve from cwd.
const SRC = join(process.cwd(), "src")
const SAFE_AREA_CSS = join(SRC, "styles/safe-area.css")
const safeAreaCss = readFileSync(SAFE_AREA_CSS, "utf8")

const SIDES = ["top", "right", "bottom", "left"] as const

describe("safe-area.css — the locked inset contract", () => {
  //Capacitor's SystemBars injects `--safe-area-inset-*` on Android because `env()`
  //reads 0/wrong in WebView < 140 (crbug/40699457). Consume the var first, env() last.
  it("spells each inset var-first with env() as fallback", () => {
    for (const side of SIDES) {
      expect(safeAreaCss).toContain(
        `--adaptv-inset-${side}: var(--safe-area-inset-${side}, env(safe-area-inset-${side}, 0px))`,
      )
    }
  })

  it("carries the bug/decision reference so the ordering is not 'corrected' back", () => {
    expect(safeAreaCss).toContain("§6.0")
    expect(safeAreaCss).toContain("40699457")
  })

  //The contract vars are PREFIXED, deliberately against §3.2's unprefixed rule: they are
  //global and generic enough to collide with a consumer's own `--safe-bottom`.
  it("no longer depends on the tailwindcss-safe-area plugin's private vars", () => {
    //strip comments: the header names the plugin's private var to explain the removal
    const declarations = safeAreaCss.replace(/\/\*[\s\S]*?\*\//g, "")
    expect(declarations).not.toContain("--twsa-")
    const pkg = JSON.parse(
      readFileSync(join(process.cwd(), "package.json"), "utf8"),
    )
    expect(pkg.peerDependencies).not.toHaveProperty(
      "tailwindcss-safe-area",
    )
    expect(pkg.devDependencies).not.toHaveProperty("tailwindcss-safe-area")
  })
})

/*
 * Compiled-output guards. `@utility` and Tailwind v4's `--value()` / `--spacing()`
 * fail SOFT — a rule that does not parse simply never emits, with no error — so a
 * source-text assertion would pass on a stylesheet that ships nothing at all.
 */
describe("safe-area utilities — the compiled CSS", () => {
  //every name adaptv or the playground actually writes, so the plugin's removal is
  //provably not a downstream break
  const IN_USE = [
    "p-safe",
    "px-safe",
    "py-safe",
    "pt-safe",
    "pb-safe",
    "m-safe",
    "p-safe-offset-2",
    "px-safe-offset-6",
    "py-safe-offset-8",
    "pt-safe-offset-2",
    "pb-safe-offset-2",
  ]

  it("emits every utility name adaptv and the playground use", async () => {
    const css = await compileAdaptvStyles(IN_USE)
    for (const name of IN_USE) {
      expect(ruleFor(css, `.${name}`), name).not.toBeNull()
    }
  })

  it("resolves each side through its contract var", async () => {
    const css = await compileAdaptvStyles([
      "pt-safe",
      "pr-safe",
      "pb-safe",
      "pl-safe",
    ])
    for (const side of SIDES) {
      const short = side[0]
      expect(ruleFor(css, `.p${short}-safe`)).toBe(
        `padding-${side}: var(--adaptv-inset-${side}, 0px);`,
      )
    }
  })

  //`--spacing(--value(...))` is a NESTED functional-utility call. Assert the resolved
  //arithmetic, not the source spelling: this is the exact construct that silently
  //emits nothing when the nesting is a character off.
  it("compiles the --spacing(--value(...)) nesting to real arithmetic", async () => {
    const css = await compileAdaptvStyles([
      "pb-safe-offset-4",
      "pb-safe-or-4",
    ])

    //offset = inset PLUS n spacing units
    expect(ruleFor(css, ".pb-safe-offset-4")).toBe(
      "padding-bottom: calc(var(--spacing) * 4 + var(--adaptv-inset-bottom, 0px));",
    )
    //or = the inset, floored at n spacing units. `max()`, not a `var()` fallback: the
    //contract vars are always defined (`0px`), so a fallback could never fire.
    expect(ruleFor(css, ".pb-safe-or-4")).toBe(
      "padding-bottom: max(var(--adaptv-inset-bottom, 0px), calc(var(--spacing) * 4));",
    )
  })

  it("accepts the arbitrary-integer form the plugin accepted", async () => {
    const css = await compileAdaptvStyles([
      "pt-safe-offset-[7]",
      "mt-safe-or-[3]",
    ])
    expect(ruleFor(css, ".pt-safe-offset-\\[7\\]")).toContain(
      "var(--spacing) * 7",
    )
    expect(ruleFor(css, ".mt-safe-or-\\[3\\]")).toContain(
      "var(--spacing) * 3",
    )
  })

  it("emits the margin and inset families, not only padding", async () => {
    const css = await compileAdaptvStyles([
      "mb-safe",
      "ms-safe",
      "inset-x-safe",
      "bottom-safe-or-2",
      "end-safe",
    ])
    expect(ruleFor(css, ".mb-safe")).toBe(
      "margin-bottom: var(--adaptv-inset-bottom, 0px);",
    )
    expect(ruleFor(css, ".ms-safe")).toBe(
      "margin-inline-start: var(--adaptv-inset-left, 0px);",
    )
    expect(ruleFor(css, ".inset-x-safe")).toBe(
      "right: var(--adaptv-inset-right, 0px); left: var(--adaptv-inset-left, 0px);",
    )
    expect(ruleFor(css, ".bottom-safe-or-2")).toBe(
      "bottom: max(var(--adaptv-inset-bottom, 0px), calc(var(--spacing) * 2));",
    )
    expect(ruleFor(css, ".end-safe")).toBe(
      "inset-inline-end: var(--adaptv-inset-right, 0px);",
    )
  })

  //`safe` / `safe-t` / `safe-none` re-derived the plugin's vars per element from bare
  //`env()` — exactly the Android read the contract exists to avoid. Deliberately gone.
  it("does not resurrect the plugin's per-element env() re-derivation", async () => {
    const css = await compileAdaptvStyles(["safe", "safe-t", "safe-none"])
    expect(ruleFor(css, ".safe")).toBeNull()
    expect(ruleFor(css, ".safe-t")).toBeNull()
    expect(ruleFor(css, ".safe-none")).toBeNull()
  })
})

/*
 * docs/decisions/styling.md §5.5 is absolute: a utility tailwind-merge has never heard of conflicts
 * with nothing, so an unregistered family silently drops out of `mergeStyles`'
 * precedence contract — `View safe="bottom"` would stop beating a stray `pb-0`.
 */
describe("safe-area utilities — registered with tailwind-merge", () => {
  it.each([
    ["pb-0", "pb-safe"],
    ["pb-safe", "pb-4"],
    ["p-4", "p-safe-offset-2"],
    ["pb-safe", "pb-safe-or-4"],
    ["pt-safe-offset-2", "pt-safe-or-2"],
    ["mb-2", "mb-safe"],
    ["bottom-0", "bottom-safe"],
    ["inset-0", "inset-safe"],
  ])("`%s` then `%s` keeps only the last", (first, second) => {
    expect(cn(first, second)).toBe(second)
  })

  it("lets a whole-box utility clear the per-side one, as the standard groups do", () => {
    expect(cn("pb-safe", "p-4")).toBe("p-4")
    expect(cn("top-safe", "inset-safe")).toBe("inset-safe")
  })
})

/*
 * Cascade layers (docs/decisions/styling.md §6 / §6.0.1). Everything adaptv emits is layered, so an
 * unlayered consumer rule wins at ANY specificity — which is what let the cascade-only
 * `!important`s go. Assert the shape the guarantee rests on, since no jsdom-class
 * environment resolves layer order.
 */
/** Everything inside every `@layer <name> { … }` block, concatenated (a layer may reopen). */
function layerContents(css: string, layer: string): string {
  const open = `@layer ${layer} {`
  const out: string[] = []
  for (
    let at = css.indexOf(open);
    at !== -1;
    at = css.indexOf(open, at + 1)
  ) {
    let depth = 0
    for (let i = at + open.length - 1; i < css.length; i++) {
      if (css[i] === "{") depth++
      else if (css[i] === "}" && --depth === 0) {
        out.push(css.slice(at + open.length, i))
        break
      }
    }
  }
  expect(out.length, `no @layer ${layer} block`).toBeGreaterThan(0)
  return out.join("\n")
}

describe("cascade layers — the consumer always wins", () => {
  it("declares the adaptv sublayers in the documented order", async () => {
    const css = await compileAdaptvStyles([])
    expect(css).toContain(
      "@layer adaptv.reset, adaptv.patches, adaptv.components, adaptv.utilities;",
    )
  })

  //Per patch, by name: unlayered author CSS beats EVERY layer at any specificity, so
  //"is this rule inside `@layer adaptv.*`?" is the whole of the "a consumer's plain
  //`.article-body { user-select: text }` wins" guarantee. Verified live in Chrome 141
  //against each of these: the layered `*` reset loses to an unlayered consumer rule and
  //to a `utilities`-layer utility alike, with no `!important` anywhere.
  it.each([
    ["adaptv.reset", "-webkit-user-select: none;"],
    ["adaptv.reset", "scrollbar-width: none;"],
    ["adaptv.reset", "*::-webkit-scrollbar"],
    ["adaptv.reset", "[tabindex]:focus"],
    ["adaptv.reset", 'input[type="search"]::-webkit-search-cancel-button'],
    ["adaptv.patches", "input:-webkit-autofill"],
    ["adaptv.patches", "-webkit-touch-callout: none;"],
    ["adaptv.patches", '[data-caret-muted="true"]'],
    ["adaptv.components", "[data-pwa-drawer-overlay]"],
    ["adaptv.components", "[data-swipeable-root]"],
  ])(
    "keeps `%s`'s `%s` inside its layer, so a plain consumer rule overrides it",
    async (layer, fragment) => {
      const css = await compileAdaptvStyles([])
      expect(layerContents(css, layer)).toContain(fragment)
    },
  )

  it("wraps every rule adaptv ships in a layer", async () => {
    const css = await compileAdaptvStyles([])
    //strip Tailwind's own output and adaptv's layered blocks; keyframes are exempt
    //(keyframe names resolve from one flat namespace, layers do not apply)
    const unlayered = css
      .replace(/@layer [\w.,\s]+;/g, "")
      .replace(/@layer [\w.]+\s*\{[\s\S]*?\n\}/g, "")
      .replace(/@keyframes [\w-]+\s*\{[\s\S]*?\n\}/g, "")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .trim()
    expect(unlayered).toBe("")
  })

  //`!important` INVERTS layer order — an important declaration in a layer declared
  //before `utilities` becomes the strongest author declaration on the page and cannot
  //be overridden, not even by the consumer's own unlayered `!important`. §6.0.1 allows
  //exactly one exemption: a declaration fighting a UA stylesheet, which no layer reaches.
  //Exactly ONE qualifies — the shadow that covers WebKit's UA-important autofill
  //background, which also has to survive a consumer `shadow-*` utility landing on the
  //same field. Anything else appearing in this list is a regression.
  it("keeps !important only where it fights the UA autofill background", async () => {
    const css = await compileAdaptvStyles([])
    const important = css
      .split("\n")
      .filter((line) => line.includes("!important"))
      .map((line) => line.trim())

    expect(important).toEqual([
      "-webkit-box-shadow: 0 0 0 30px transparent inset !important;",
    ])
  })

  //The proof the layering actually buys something: the consumer's plain rule is
  //unlayered, so it beats a adaptv reset that a `*` selector could never lose to before.
  it("puts adaptv's resets in an EARLIER layer than the consumer's utilities", async () => {
    const css = await compileCss(`@import "./index.css";`, ["selectable"])
    const utilitiesLayer = css.indexOf("@layer utilities")
    const adaptvLayer = css.indexOf("@layer adaptv.reset {")
    const statement = css.indexOf(
      "@layer theme, base, adaptv, components, utilities;",
    )
    //the STATEMENT is what fixes the order — first mention wins, and it is emitted first
    expect(statement).toBeGreaterThanOrEqual(0)
    expect(statement).toBeLessThan(utilitiesLayer)
    expect(statement).toBeLessThan(adaptvLayer)
    //and `selectable` no longer needs !important to beat `* { user-select: none }`
    expect(ruleFor(css, ".selectable")).toBe(
      "-webkit-user-select: text; user-select: text;",
    )
  })
})

/** Recursively collect files under `dir` matching one of `exts`. */
function walk(dir: string, exts: string[]): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      out.push(...walk(full, exts))
    } else if (exts.some((e) => entry.name.endsWith(e))) {
      out.push(full)
    }
  }
  return out
}

describe("safe-area contract — bare env(safe-area-inset) is banned outside safe-area.css", () => {
  //`safe-area.css` is the single source of truth for the env() fallback; this guard is
  //why. Anywhere else — a component arbitrary value, an inline style, a JS probe —
  //bare env() silently reads 0 on the large Android WebView < 140 base. Reference the
  //contract var (`var(--adaptv-inset-*)`) instead. This test itself and the contract
  //file are the only allowed occurrences.
  //
  //One invariant, one test: the walk covers ~370 files, and a test per file reported
  //each of them as a separate pass — the suite count moved every time a file landed,
  //for one grep. A violation is listed as `file:line`, all of them at once.
  const files = walk(SRC, [".ts", ".tsx", ".css"]).filter(
    (f) => f !== SAFE_AREA_CSS && !f.endsWith("safe-area.test.ts"),
  )

  it("finds bare env() nowhere but the contract file", () => {
    //the vacuous pass: a walk pointed at nothing has no violations either
    expect(files.length).toBeGreaterThanOrEqual(300)

    const violations: string[] = []
    for (const full of files) {
      //strip comments so prose that *names* the banned spelling to explain it doesn't
      //read as a violation
      const code = readFileSync(full, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/[^\n]*/g, "")
      for (const match of code.matchAll(/env\(\s*safe-area-inset/g)) {
        const line = code.slice(0, match.index).split("\n").length
        violations.push(`${full.slice(SRC.length + 1)}:${line}`)
      }
    }
    expect(violations).toEqual([])
  })
})
