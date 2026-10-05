/**
 * The `hover:` and `active:` corrections, applied to every `:hover` and `:active` rule the app
 * ships — Tailwind, SCSS, CSS modules, plain CSS, a dependency's stylesheet.
 * → `docs/roadmap/patch-delivery.md` §4
 *
 * ## Why a post-processor
 *
 * The corrections used to live only in `styles/patches.css`'s `@custom-variant`s, so they reached
 * a rule only if the developer spelled it `hover:`/`active:` in a Tailwind class. A
 * `.card:hover { … }` in their own stylesheet got stock behaviour (`docs/decisions/styling.md`
 * §0.1). This runs over the EMITTED CSS instead, so the spelling stops mattering.
 *
 * ## What each rule becomes
 *
 * `:hover` — the rule moves inside `@media (hover: hover)` (a touch screen never matches it, so a
 * tap leaves no sticky hover), and gains adaptv's focus guard, as the `hover:` variant does. A
 * copy stays outside the media query for elements inside `data-adaptv-no-hover`:
 *
 * ```css
 * .card:hover:where([data-adaptv-no-hover], [data-adaptv-no-hover] *) { … }
 * @media (hover: hover) {
 *   .card:hover:not(:where(:focus, :focus-within, [data-adaptv-no-hover], [data-adaptv-no-hover] *)) { … }
 * }
 * ```
 *
 * `:active` — the item splits by who owns the press, as the `active:` variant does: native
 * `:active` on a plain element, the gesture engine's reentrant `[data-pressed]` on an engine
 * element (`[data-press-engine]`), native `:active` again inside `data-adaptv-no-active`:
 *
 * ```css
 * .tile:active:not(:where([data-press-engine])),
 * .tile[data-pressed]:not(:where([data-adaptv-no-active], [data-adaptv-no-active] *)),
 * .tile:active:where([data-adaptv-no-active], [data-adaptv-no-active] *) { … }
 * ```
 *
 * ## 🔑 Specificity does not move
 *
 * Everything added is inside `:where()`, which counts zero, and `[data-pressed]` weighs what
 * `:active` weighed. A consumer's override that won before still wins. A prefix such as
 * `html[data-x] .card:hover` would have cost every rule a point, which `styling.md` §3.1 treats as
 * load-bearing — hence `@media` for the wrap, not a selector.
 *
 * ## What it leaves alone, and says so
 *
 * - **Already decided.** A `:hover` rule under any `@media` that names `hover` or `any-hover`
 *   (Tailwind's own `hover:`, or an author who wrote the query), including Tailwind's nested
 *   form, where the query sits inside `&:hover`. A selector that already names
 *   `[data-pressed]`, `[data-press-engine]` or a hatch (the variants' output, or this pass's).
 * - **Refused, and counted.** A pseudo-class inside `:not()`, `:has()` or any selector argument
 *   other than `:is()`/`:where()`. `.x:not(:hover)` matches on a touch screen today; wrapping it
 *   in `(hover: hover)` would turn it off there. The rule is left exactly as written and the
 *   build line says how many were refused.
 *
 * ## Why postcss and a tokenizer, not lightningcss's visitor
 *
 * lightningcss 1.32's JS visitor cannot hand back a stylesheet Tailwind compiled: an identity
 * `StyleSheet` visitor over `fixtures/tailwind-serve-output.css` throws "failed to deserialize"
 * (`:host`, an `@import` with no media — 439 nodes in all). postcss keeps every byte it is not
 * asked to change, and the selector goes through {@link scanSelector}, which knows strings,
 * escapes, attribute brackets and which functional pseudo-class a `:hover` sits in — the "real
 * tokenizing" §4.3 asks for, not a regex over the selector text.
 *
 * The decision is pure — {@link rewriteHover} / {@link rewriteActive} take CSS and return CSS — so
 * it is tested without a bundler.
 */

import postcss, {
  type ChildNode,
  type Container,
  type Rule,
} from "postcss"
import type { Plugin } from "vite"
import { hatchAttribute, PATCHES } from "#adaptv/utils/patch-registry.ts"
import { isTransformableCssId } from "#adaptv/vite/css-layer-order.ts"

/** The two patches this file enforces. */
export type CssRewritePatch = "hover" | "active"

/** What one pass did, per patch. `refused` counts rules left as written (see the header). */
export type PatchCounts = Record<
  CssRewritePatch,
  { rewritten: number; refused: number }
>

export type PatchRewrite = { code: string; counts: PatchCounts }

const PATCH_NAMES = [
  "hover",
  "active",
] as const satisfies CssRewritePatch[]

/* ── the selector tokenizer ────────────────────────────────────────────── */

/** One `:hover`/`:active` in a selector item, by offset. `positive`: only `:is()`/`:where()` around it. */
type Hit = { start: number; end: number; positive: boolean }

/** The functional pseudo-classes that pass their argument through unchanged. */
const TRANSPARENT = new Set(["is", "where", "matches", "-webkit-any"])

const isIdentChar = (c: string | undefined) =>
  c !== undefined &&
  (/[\w-]/.test(c) || c.charCodeAt(0) > 0x7f || c === "\\")

/** Index of the quote that closes the string opened at `open`, skipping escapes. */
function skipString(text: string, open: number): number {
  const quote = text[open]
  let i = open + 1
  while (i < text.length && text[i] !== quote)
    i += text[i] === "\\" ? 2 : 1
  return i
}

/**
 * Split a selector list at its top-level commas, and find every `:kind` in each item — skipping
 * strings, escapes and attribute values, telling `:hover` from a pseudo-element and from a longer
 * name (`:hover-x`), and recording which functional pseudo-classes enclose it.
 */
export function scanSelector(
  selector: string,
  kind: CssRewritePatch,
): Array<{ text: string; hits: Hit[] }> {
  const items: Array<{ text: string; hits: Hit[] }> = []
  let itemStart = 0
  let hits: Hit[] = []
  const stack: string[] = []
  const flush = (end: number) => {
    const raw = selector.slice(itemStart, end)
    const lead = raw.length - raw.trimStart().length
    const shift = itemStart + lead
    items.push({
      text: raw.trim(),
      hits: hits.map((h) => ({
        ...h,
        start: h.start - shift,
        end: h.end - shift,
      })),
    })
    hits = []
  }
  for (let i = 0; i < selector.length; i++) {
    const c = selector[i]
    if (c === "\\") {
      i++
    } else if (c === '"' || c === "'") {
      i = skipString(selector, i)
    } else if (c === "[") {
      while (i < selector.length && selector[i] !== "]") {
        const q = selector[i]
        if (q === "\\") i++
        else if (q === '"' || q === "'") i = skipString(selector, i)
        i++
      }
    } else if (c === "(") {
      //the name of the function this paren opens: `:is(`, `:not(`, `:nth-child(`
      const name = /:{1,2}([\w-]+)$/.exec(selector.slice(0, i))?.[1] ?? ""
      stack.push(name.toLowerCase())
    } else if (c === ")") {
      stack.pop()
    } else if (c === "," && stack.length === 0) {
      flush(i)
      itemStart = i + 1
    } else if (
      c === ":" &&
      selector[i - 1] !== ":" &&
      selector[i + 1] !== ":" &&
      selector.slice(i + 1, i + 1 + kind.length).toLowerCase() === kind &&
      !isIdentChar(selector[i + 1 + kind.length]) &&
      selector[i + 1 + kind.length] !== "("
    ) {
      hits.push({
        start: i,
        end: i + 1 + kind.length,
        positive: stack.every((name) => TRANSPARENT.has(name)),
      })
      i += kind.length
    }
  }
  flush(selector.length)
  return items
}

/** Replace every hit in `text` with `replacement`. */
function replaceHits(
  text: string,
  hits: Hit[],
  replacement: string,
): string {
  let out = text
  for (const hit of [...hits].sort((a, b) => b.start - a.start)) {
    out = out.slice(0, hit.start) + replacement + out.slice(hit.end)
  }
  return out
}

/** Does the selector name one of these attributes (`[name]`, `[name=…]`)? */
function namesAttribute(selector: string, names: string[]): boolean {
  return names.some((name) =>
    new RegExp(`\\[\\s*${name}\\s*[\\]=~|^$*]`, "i").test(selector),
  )
}

type Classified = {
  text: string
  hits: Hit[]
  kind: "none" | "positive" | "negated"
}

function classify(selector: string, patch: CssRewritePatch): Classified[] {
  return scanSelector(selector, patch).map(({ text, hits }) => {
    if (hits.length === 0 || namesAttribute(text, HANDLED[patch])) {
      return { text, hits, kind: "none" }
    }
    return {
      text,
      hits,
      kind: hits.every((h) => h.positive) ? "positive" : "negated",
    }
  })
}

/* ── the replacements ──────────────────────────────────────────────────── */

/** `[hatch], [hatch] *` — the element or anything inside it opted out (`isPatchDisabled`'s walk). */
const hatchList = (patch: CssRewritePatch) => {
  const name = hatchAttribute(patch)
  return `[${name}], [${name}] *`
}

const HOVER_GUARDED = `:hover:not(:where(:focus, :focus-within, ${hatchList("hover")}))`
const HOVER_OPTED_OUT = `:hover:where(${hatchList("hover")})`
const ACTIVE_PLAIN = ":active:not(:where([data-press-engine]))"
const ACTIVE_ENGINE = `[data-pressed]:not(:where(${hatchList("active")}))`
const ACTIVE_OPTED_OUT = `:active:where(${hatchList("active")})`

/** A selector naming one of these already carries the correction — never rewritten twice. */
const HANDLED: Record<CssRewritePatch, string[]> = {
  hover: [hatchAttribute("hover")],
  active: ["data-pressed", "data-press-engine", hatchAttribute("active")],
}

/* ── media queries and rule bodies ─────────────────────────────────────── */

/** `(hover: hover)`, `(hover)`, `(any-hover: none)`, `not all and (hover: none)`… */
const NAMES_HOVER = /\(\s*(?:any-)?hover\s*[:)]/i

function isHoverMedia(node: ChildNode): boolean {
  return (
    node.type === "atrule" &&
    node.name.toLowerCase() === "media" &&
    NAMES_HOVER.test(node.params)
  )
}

/**
 * Does this node apply a declaration that no `(hover)` query guards? A rule's own declarations
 * do; a nested `@media (hover: hover)` does not — Tailwind's nested form
 * (`&:hover { @media (hover: hover) { … } }`), and why reading only the selector is wrong.
 */
function appliesUnguarded(node: ChildNode): boolean {
  if (node.type === "decl") return true
  if (isHoverMedia(node)) return false
  if (node.type === "rule" || node.type === "atrule")
    return (node.nodes ?? []).some(appliesUnguarded)
  return false
}

/* ── the walk ──────────────────────────────────────────────────────────── */

function emptyCounts(): PatchCounts {
  return {
    hover: { rewritten: 0, refused: 0 },
    active: { rewritten: 0, refused: 0 },
  }
}

/** At-rules whose children are ordinary rules in the same cascade. */
const GROUPING = new Set([
  "media",
  "supports",
  "layer",
  "container",
  "scope",
])

function rewriteActiveRule(rule: Rule, counts: PatchCounts): void {
  const items = classify(rule.selector, "active")
  if (items.some((i) => i.kind === "negated")) {
    counts.active.refused++
    return
  }
  if (!items.some((i) => i.kind === "positive")) return
  rule.selector = items
    .flatMap(({ text, hits, kind }) =>
      kind === "positive"
        ? [
            replaceHits(text, hits, ACTIVE_PLAIN),
            replaceHits(text, hits, ACTIVE_ENGINE),
            replaceHits(text, hits, ACTIVE_OPTED_OUT),
          ]
        : [text],
    )
    .join(", ")
  counts.active.rewritten++
}

function rewriteHoverRule(rule: Rule, counts: PatchCounts): void {
  const items = classify(rule.selector, "hover")
  if (items.some((i) => i.kind === "negated")) {
    counts.hover.refused++
    return
  }
  const hovered = items.filter((i) => i.kind === "positive")
  if (hovered.length === 0 || !appliesUnguarded(rule)) return
  const rest = items.filter((i) => i.kind === "none").map((i) => i.text)

  const guarded = rule.clone({
    selector: hovered
      .map(({ text, hits }) => replaceHits(text, hits, HOVER_GUARDED))
      .join(", "),
  })
  rule.selector = [
    ...rest,
    ...hovered.map(({ text, hits }) =>
      replaceHits(text, hits, HOVER_OPTED_OUT),
    ),
  ].join(", ")
  const media = postcss.atRule({ name: "media", params: "(hover: hover)" })
  media.append(guarded)
  rule.after(media)
  counts.hover.rewritten++
}

function walk(
  container: Container,
  patches: ReadonlySet<CssRewritePatch>,
  counts: PatchCounts,
  underHoverMedia: boolean,
): void {
  //a snapshot: the hover rewrite inserts a sibling, which must not be visited again
  for (const node of [...(container.nodes ?? [])]) {
    if (node.type === "atrule") {
      if (!GROUPING.has(node.name.toLowerCase())) continue
      walk(node, patches, counts, underHoverMedia || isHoverMedia(node))
    } else if (node.type === "rule") {
      //children first: a nested `&:hover` is a rule of its own
      walk(node, patches, counts, underHoverMedia)
      if (patches.has("active")) rewriteActiveRule(node, counts)
      if (patches.has("hover") && !underHoverMedia)
        rewriteHoverRule(node, counts)
    }
  }
}

/**
 * The stylesheet with the given patches applied, or `null` when nothing was found to rewrite or
 * refuse. When rules were only refused, `code` is the input unchanged.
 */
export function rewriteCssPatches(
  css: string,
  patches: readonly CssRewritePatch[] = PATCH_NAMES,
): PatchRewrite | null {
  const wanted = patches.filter((patch) => css.includes(`:${patch}`))
  if (wanted.length === 0) return null
  const counts = emptyCounts()
  const root = postcss.parse(css)
  walk(root, new Set(wanted), counts, false)
  const changed = counts.hover.rewritten + counts.active.rewritten
  const refused = counts.hover.refused + counts.active.refused
  if (changed === 0) return refused === 0 ? null : { code: css, counts }
  return { code: root.toString(), counts }
}

/** `:hover` rules moved under `@media (hover: hover)` with the focus guard and the hatch. Pure. */
export function rewriteHover(css: string): PatchRewrite | null {
  return rewriteCssPatches(css, ["hover"])
}

/** `:active` rules routed through the gesture engine's `[data-pressed]`, with the hatch. Pure. */
export function rewriteActive(css: string): PatchRewrite | null {
  return rewriteCssPatches(css, ["active"])
}

/**
 * Every `:hover` selector a tap can still stick: outside any `(hover)`/`(any-hover)` media query,
 * not inside the hatch, and not refused (a `:hover` under `:not()`/`:has()` — those are counted
 * by the rewrite instead). Empty for a sheet {@link rewriteHover} has processed; the build test
 * greps the emitted CSS with it.
 */
export function findUnwrappedHover(css: string): string[] {
  const found: string[] = []
  const visit = (container: Container, guarded: boolean) => {
    for (const node of container.nodes ?? []) {
      if (
        node.type === "atrule" &&
        GROUPING.has(node.name.toLowerCase())
      ) {
        visit(node, guarded || isHoverMedia(node))
      } else if (node.type === "rule") {
        if (!guarded && appliesUnguarded(node)) {
          for (const item of classify(node.selector, "hover")) {
            if (item.kind === "positive") found.push(item.text)
          }
        }
        visit(node, guarded)
      }
    }
  }
  visit(postcss.parse(css), false)
  return found
}

/** The patches whose `reach` admits this stylesheet (§6.2: `"app"` skips `node_modules`). */
function patchesFor(id: string): CssRewritePatch[] {
  const thirdParty = id.includes("/node_modules/")
  return PATCH_NAMES.filter(
    (patch) => !thirdParty || PATCHES[patch].reach === "all",
  )
}

/** The build line — L7: a rewrite of the developer's CSS is shown, never inferred. */
export function formatPatchCounts(counts: PatchCounts): string {
  const part = (patch: CssRewritePatch) => {
    const { rewritten, refused } = counts[patch]
    const rules = `${rewritten} rule${rewritten === 1 ? "" : "s"}`
    return `${patch} ${rules}${refused ? ` (${refused} left as written)` : ""}`
  }
  return `[adaptv] css patches: ${part("hover")}, ${part("active")}`
}

/**
 * Apply {@link rewriteCssPatches} to every stylesheet Vite transforms.
 *
 * NO `enforce`, for the reason `tailwind-empty-fallback.ts` documents and measured: `pre` runs
 * before `@tailwindcss/vite` has generated anything, `post` runs after Vite's CSS stage has taken
 * the sheet, and the rewrite silently does not happen. It sits after `adaptvDevCssLoweringPlugin`
 * in the array, so in dev it sees the same flat CSS a build does.
 *
 * Prints one line per client build with the count per patch.
 */
export function adaptvCssPatchRewritePlugin(): Plugin {
  let counts = emptyCounts()
  let isBuild = false
  return {
    name: "adaptv:css-patch-rewrite",
    //NO `enforce` — see above.
    configResolved(config) {
      isBuild = config.command === "build"
    },
    buildStart() {
      counts = emptyCounts()
    },
    transform(code, id) {
      if (!isTransformableCssId(id)) return null
      const result = rewriteCssPatches(code, patchesFor(id))
      if (result === null) return null
      for (const patch of PATCH_NAMES) {
        counts[patch].rewritten += result.counts[patch].rewritten
        counts[patch].refused += result.counts[patch].refused
      }
      if (result.code === code) return null
      //no source map: rules are rewritten in place, and a hover rule gains one sibling
      return { code: result.code, map: null }
    },
    buildEnd() {
      if (!isBuild) return
      if (this.environment && this.environment.name !== "client") return
      console.log(formatPatchCounts(counts))
    },
  }
}
