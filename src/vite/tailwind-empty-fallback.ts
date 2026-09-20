/**
 * Make Tailwind v4's empty `var()` fallbacks survive Chromium 113–118. → `docs/decisions/register.md`
 *
 * ## The bug, in one line of CSS
 *
 * Tailwind v4 composes several properties out of independent parts. Each part is a custom
 * property registered with `syntax: "*"`, `inherits: false` and **no `initial-value`**, and
 * it is read with an EMPTY fallback, so a part nobody set contributes nothing:
 *
 * ```css
 * .x { --tw-blur: blur(8px); filter: var(--tw-blur,) var(--tw-brightness,) … var(--tw-drop-shadow,) }
 * ```
 *
 * Chromium 113–118 throw the whole declaration away instead (bisected across every
 * Chrome-for-Testing milestone: broken 113–118, fixed in 119). Nothing errors; the property
 * computes to its initial value. Measured on an Android 14 emulator's WebView
 * 113.0.5672.136, against HeadlessChrome 149 as the control: with `--tw-numeric-spacing`
 * set, `font-variant-numeric` computes `normal`; with `--tw-pan-y` set, `touch-action`
 * computes `auto` (149: `pan-y`); with `--tw-blur` set, `filter` computes `none` (149:
 * `blur(8px)`); and every ring width computes `box-shadow: none`.
 *
 * Every empty fallback tailwindcss@4.2.4 can emit, by the property that reads it — the test
 * re-reads Tailwind's compiler, so an upgrade that adds one fails there by name:
 *
 * ```
 * transform             --tw-rotate-x --tw-rotate-y --tw-rotate-z --tw-skew-x --tw-skew-y
 * touch-action          --tw-pan-x --tw-pan-y --tw-pinch-zoom
 * font-variant-numeric  --tw-ordinal --tw-slashed-zero --tw-numeric-figure
 *                       --tw-numeric-spacing --tw-numeric-fraction
 * filter                --tw-blur --tw-brightness --tw-contrast --tw-grayscale --tw-hue-rotate
 *                       --tw-invert --tw-saturate --tw-sepia --tw-drop-shadow
 * backdrop filters      --tw-backdrop-blur --tw-backdrop-brightness --tw-backdrop-contrast
 *   (both spellings)    --tw-backdrop-grayscale --tw-backdrop-hue-rotate --tw-backdrop-invert
 *                       --tw-backdrop-opacity --tw-backdrop-saturate --tw-backdrop-sepia
 * contain               --tw-contain-size --tw-contain-layout --tw-contain-paint --tw-contain-style
 * the ring's shadows    --tw-ring-inset
 * ```
 *
 * ⚠︎ **Spell utilities as their `--tw-*` parts in this file and its test.** adaptv's
 * stylesheet declares `@source "../**\/*.{ts,tsx}"`, so Tailwind scans these sources —
 * comments and test strings included — and every utility NAME written here is compiled into
 * every consumer's CSS. A first draft of this rewrite added 25 utilities and 13 `@property`
 * rules to the playground that way, and a second still leaked four through prose, an
 * example selector and a test helper's name. Tailwind's scanner does not read `--tw-*` as a class, so write
 * parts, write example selectors as `.x`, and check an edit by running
 * `@tailwindcss/oxide`'s `Scanner` over the file before and after: no candidate that
 * compiles may be new.
 *
 * ## Compositions: one unregistered carrier per part, declared where it is read
 *
 * ```css
 * .x { --tw-blur: blur(8px);
 *      --adaptv-tw-blur: var(--tw-blur); … --adaptv-tw-drop-shadow: var(--tw-drop-shadow);
 *      filter: var(--adaptv-tw-blur,) … var(--adaptv-tw-drop-shadow,) }
 * ```
 *
 * **Why it is valid on 113.** No `var()` with an empty fallback over a REGISTERED property
 * is left. The empty fallbacks now sit on unregistered carriers, which the same WebView 113
 * substitutes correctly (measured: `var(--unregistered,)` painted where `var(--registered,)`
 * did not). A carrier reads its part with no fallback at all, so an unset part makes its
 * carrier invalid at computed-value time, i.e. guaranteed-invalid, and the composition takes
 * the carrier's empty fallback. That was measured on the same WebView 113.0.5672.136 with
 * the rewritten sheet, not inferred: a part nobody set contributes nothing (`--tw-blur` and
 * `--tw-invert` together compute `blur(8px) invert(1)`), a part emptied by `--tw-blur:  ;`
 * next to `--tw-brightness` computes `brightness(1.5)`, and 51 of 51 probes matched
 * Chromium 149. It holds on Chromium 149 and WebKit 26.5 too.
 *
 * **Why it is identical on 119+.** Substitution is textual: each carrier holds exactly the
 * tokens its part holds, or nothing, so the composed value is the same token list Tailwind
 * wrote. The parts stay independent and combinable — `--tw-numeric-spacing` with
 * `--tw-slashed-zero`, `--tw-blur` with `--tw-brightness`, `--tw-rotate-x` with
 * `--tw-skew-y` on one element — because each has its own carrier. And `inherits: false`
 * still holds, for two reasons that are both load-bearing:
 *
 * 1. Tailwind's `@property` rules are left exactly as compiled, so the parts never inherit.
 * 2. **Every rule that reads a carrier declares it in the same block**, from the element's
 *    own part. A custom property whose `var()` is invalid computes to guaranteed-invalid —
 *    it does NOT inherit. Measured on WebView 113.0.5672.136: a child whose own part is
 *    `--tw-invert`, under a parent whose part is `--tw-blur`, computes `invert(1)`, and a
 *    bare reader under that parent computes `filter: none`. Measured on Chromium 149 and
 *    WebKit 26.5: a child carrying the rewritten composition, under a parent whose carrier
 *    is `blur(3px)`, computes `filter: none`. ⚠︎ A rule that read a carrier WITHOUT declaring it would inherit its
 *    parent's part — the test holds every block Tailwind can generate to the invariant.
 *
 * `playground/e2e/tailwind-empty-fallback.spec.ts` renders every composition both ways and
 * compares computed values in Chromium and WebKit, inheritance included.
 *
 * Rejected, with the reason:
 * - **Identity fallbacks** (`var(--tw-blur, blur(0))`). They turn a `none` filter or
 *   transform into a real one — a stacking context, a containing block for fixed
 *   descendants, a filter pass — and `touch-action`, `font-variant-numeric` and `contain`
 *   have no keyword that combines as a no-op.
 * - **Unregistering the parts.** `var(--x,)` would work, but `inherits: false` would then
 *   rest on a universal `*, ::before, ::after, ::backdrop` reset, which misses
 *   `::placeholder`, `::marker` and `::file-selector-button`. The e2e spec's mutant run of
 *   this shape broke 8 of its inheritance probes on Chromium 149.
 * - **Registering the carriers** reintroduces the bug. Do not "tidy" them into `@property`.
 *
 * ## Why this is unconditional — no UA sniff, no `@supports`, no stamp
 *
 * The rewrite computes identically on browsers that were never broken, so there is nothing
 * to detect and nothing to branch on. `@supports` could not see it anyway: the failure is at
 * computed-value time, so `CSS.supports("box-shadow","var(--x,) 0 0 0 1px red")` returns
 * **true** on a broken build.
 *
 * ## The ring keeps its own rewrite
 *
 * `var(--tw-ring-inset,)` is not a composition of parts: it is a keyword prefixed onto a
 * shadow body that itself lives in a registered property. It was fixed first, proven on
 * device, and is left byte for byte as it was:
 *
 * ```css
 * .ring-1     { --adaptv-tw-ring: 0 0 0 calc(1px + …) var(--tw-ring-color, currentcolor);
 *               --tw-ring-shadow: var(--adaptv-tw-ring) }
 * .ring-inset { --tw-ring-shadow: inset var(--adaptv-tw-ring) }
 * ```
 *
 * The body moves into an unregistered carrier and `.ring-inset` re-declares the whole
 * shadow. Measured on WebView 149, both constructs compute the same five-shadow stack.
 *
 * Why not rewrite `ring` to `outline`: `outline` is immune to this bug and costs no layout —
 * but an element has exactly ONE outline, and `box-shadow` composes. Apps put
 * `ring-1 … focus-within:outline-none` on one element (the playground's own `text-input`
 * does), so collapsing the two properties would make `outline-none` erase the ring
 * precisely on focus. It also cannot express `ring-offset-*`, whose gap is painted in
 * `--tw-ring-offset-color` where `outline-offset`'s is transparent.
 */

import type { PluginOption } from "vite"
import { isTransformableCssId } from "#adaptv/vite/css-layer-order.ts"

/**
 * The unregistered properties that carry the shadow bodies.
 *
 * ⚠︎ **The `-tw-` in the middle is load-bearing. Do not shorten these to `--adaptv-ring` /
 * `--adaptv-ring-offset`** — those names are already adaptv's PUBLIC focus-ring tokens
 * (`styles/patches.css`: `outline: 2px solid var(--adaptv-ring, currentColor)`), and a
 * consumer may set them on `:root`. Reusing them would make every element carrying a
 * `ring-*` utility redefine the focus-ring colour as a box-shadow body, so `:focus-visible`
 * would compute an invalid outline and disappear — on every browser, not just the broken
 * ones. Caught here once already; `tailwind-empty-fallback.test.ts` now guards it.
 *
 * `-tw-` also says what these are: a carrier for TAILWIND's `--tw-*`, not an adaptv design
 * token anyone should read or set. The composition carriers follow the same scheme.
 */
const RING = "--adaptv-tw-ring"
const RING_OFFSET = "--adaptv-tw-ring-offset"

/**
 * A valid, invisible shadow — the fallback every carrier reference carries.
 *
 * It is Tailwind's own "no shadow" value, so a rule that falls back to it renders exactly
 * what an unset ring renders today. See the `.ring-inset` replacement inside
 * {@link rewriteRingShadow} for WHY a fallback is mandatory here rather than merely tidy.
 */
const TRANSPARENT = "0 0 #0000"

/**
 * adaptv's own ring tokens — the names this rewrite must never collide with.
 * @see {@link RING}
 */
const ADAPTV_PUBLIC_RING_TOKENS = ["--adaptv-ring", "--adaptv-ring-offset"]

/**
 * `--tw-ring-shadow: var(--tw-ring-inset,) <body>` — the broken declaration, and the same
 * shape Tailwind emits for `--tw-ring-offset-shadow`. The body runs to the end of the
 * declaration; it contains `var()` and `calc()` but never a `;` or a brace, so stopping at
 * either terminator is safe on minified and expanded output alike.
 */
const EMPTY_FALLBACK_DECL =
  /--tw-(ring|ring-offset)-shadow:\s*var\(\s*--tw-ring-inset\s*,\s*\)\s*([^;}]*)([;}])/g

/**
 * `.ring-inset { --tw-ring-inset: inset }`. Deliberately matches the keyword and not
 * `initial` — Tailwind's `*, ::before, …` reset sets `--tw-ring-inset: initial`, which must
 * be left alone.
 */
const RING_INSET_DECL = /--tw-ring-inset:\s*inset\s*([;}])/g

/**
 * The carriers, exported so the test can assert they stay clear of adaptv's public tokens.
 * @see {@link RING}
 */
export const RING_CARRIERS = {
  ring: RING,
  ringOffset: RING_OFFSET,
  collidesWith: ADAPTV_PUBLIC_RING_TOKENS,
}

/** Was this stylesheet compiled by a Tailwind that still uses the idiom? */
export function usesEmptyRingFallback(css: string): boolean {
  EMPTY_FALLBACK_DECL.lastIndex = 0
  return EMPTY_FALLBACK_DECL.test(css)
}

/**
 * What is printed when `.ring-inset` is emitted BEFORE the widths it has to override.
 *
 * The rewritten `.ring-inset` wins on source order alone — both selectors are one class, so
 * specificity is equal. Tailwind 4.2.4 emits it last (verified against its compiler output),
 * but that is Tailwind's business, not a guarantee. If it ever moves, the rewrite would
 * quietly produce ring-less insets, which is the exact failure this file exists to remove —
 * so it refuses to rewrite at all and says why.
 */
export const RING_INSET_ORDER_MESSAGE =
  "tailwind now emits `.ring-inset` before the ring widths — adaptv's ring rewrite is disabled, so `ring-*` will not render on Android WebView 113–118"

/**
 * The stylesheet with the ring declarations rewritten, or `null` when there is nothing to do
 * (not Tailwind output, already rewritten, or the ordering guard tripped).
 *
 * Pure, so the whole decision is testable without a bundler.
 */
export function rewriteRingShadow(
  css: string,
  onOutOfOrder?: () => void,
): string | null {
  if (!usesEmptyRingFallback(css)) return null

  //`.ring-inset` re-declares the full shadow, so it MUST come after the widths that define
  //the body. Compare first occurrences before touching anything.
  RING_INSET_DECL.lastIndex = 0
  const insetAt = css.search(/--tw-ring-inset:\s*inset\s*[;}]/)
  const bodyAt = css.search(
    /--tw-(?:ring|ring-offset)-shadow:\s*var\(\s*--tw-ring-inset\s*,\s*\)/,
  )
  if (insetAt !== -1 && insetAt < bodyAt) {
    onOutOfOrder?.()
    return null
  }

  const out = css
    .replace(
      EMPTY_FALLBACK_DECL,
      (_m, which: string, body: string, end: string) => {
        const carrier = which === "ring" ? RING : RING_OFFSET
        return `${carrier}:${body.trim()};--tw-${which}-shadow:var(${carrier})${end}`
      },
    )
    //⚠︎ The `, 0 0 #0000` fallbacks are REQUIRED, not defensive padding. `ring-inset` almost
    //never appears with `ring-offset-*`, so the offset carrier is usually unset — and on the
    //very browsers this file targets, a declaration that is invalid-at-computed-value-time
    //does NOT fall back to the registered `initial-value` the way the spec says. It goes
    //guaranteed-invalid, which then poisons the `box-shadow` shorthand that references it,
    //and the ring disappears again.
    //
    //Measured on WebView 113 with the fallbacks omitted: `--tw-ring-shadow` computed
    //CORRECTLY to `inset 0 0 0 calc(1px + 0px) oklch(…)`, `--tw-ring-offset-shadow` computed
    //to `""`, and `box-shadow` was still `none`. The ring was right and the page was wrong.
    //This is the same root cause as the bug being fixed, one layer down.
    .replace(
      RING_INSET_DECL,
      (_m, end: string) =>
        `--tw-ring-shadow:inset var(${RING},${TRANSPARENT});--tw-ring-offset-shadow:inset var(${RING_OFFSET},${TRANSPARENT})${end}`,
    )

  return out === css ? null : out
}

/**
 * `var(--tw-<part>,)` — every empty fallback except the ring's.
 *
 * `ring-inset` is excluded on purpose: when the ring's order guard refuses, its fallbacks
 * must stay exactly as Tailwind wrote them rather than be half-fixed with a shape nobody
 * measured inside a registered `box-shadow` body.
 */
const PART_FALLBACK = /var\(\s*--tw-(?!ring-inset\s*,)([\w-]+)\s*,\s*\)/g

/**
 * A declaration whose value reads at least one part: `filter: … var(--tw-blur,) …`.
 *
 * Anchored after `{`, `}` or `;`, so a selector's `a:hover` can never be taken for a
 * property name, and the value stops at `;` or `}` without ever crossing a `{`. That holds
 * for Tailwind's nested output (`&:hover { @media … { … } }`) and for minified output alike.
 */
const COMPOSITION_DECL =
  /(?<=[{};]\s*)([\w-]+\s*:)([^;{}]*var\(\s*--tw-(?!ring-inset\s*,)[\w-]+\s*,\s*\)[^;{}]*)(?=[;}])/g

/**
 * The stylesheet with every part-composition rewritten through carriers, or `null` when
 * there is nothing to do. See the header for the shape and why it is sound.
 */
export function rewriteCompositions(css: string): string | null {
  PART_FALLBACK.lastIndex = 0
  if (!PART_FALLBACK.test(css)) return null

  const out = css.replace(
    COMPOSITION_DECL,
    (_m, head: string, value: string, offset: number) => {
      //The prefixed and unprefixed backdrop properties read the same nine parts in one
      //rule: declare each carrier once per block, on its first reader.
      const blockStart =
        Math.max(
          css.lastIndexOf("{", offset),
          css.lastIndexOf("}", offset),
        ) + 1
      const earlier = css.slice(blockStart, offset)
      const carriers: string[] = []
      const read = value.replace(PART_FALLBACK, (_v, part: string) => {
        const carrier = `--adaptv-tw-${part}:var(--tw-${part});`
        const readEarlier = new RegExp(
          `var\\(\\s*--tw-${part}\\s*,\\s*\\)`,
        ).test(earlier)
        if (!readEarlier && !carriers.includes(carrier))
          carriers.push(carrier)
        return `var(--adaptv-tw-${part},)`
      })
      return `${carriers.join("")}${head}${read}`
    },
  )

  return out === css ? null : out
}

/**
 * Every Tailwind empty fallback rewritten — the ring's first, then the compositions — or
 * `null` when there is nothing to do.
 *
 * `onOutOfOrder` fires when the ring's order guard refuses; the compositions are still
 * rewritten, because they do not depend on source order.
 */
export function rewriteEmptyFallbacks(
  css: string,
  onOutOfOrder?: () => void,
): string | null {
  const ring = rewriteRingShadow(css, onOutOfOrder) ?? css
  const out = rewriteCompositions(ring) ?? ring
  return out === css ? null : out
}

/**
 * Rewrite Tailwind's compiled empty fallbacks so they survive Chromium 113–118.
 *
 * ## ⚠︎ The plugin ordering is measured, and BOTH ends of it are load-bearing
 *
 * No `enforce`. That is deliberate, and it is the narrow slot between two failures:
 *
 * - **`enforce: "pre"` is too early.** `@tailwindcss/vite:generate:{build,serve}` is itself
 *   `enforce: "pre"` (read from its dist, 4.2.4). A `pre` plugin ordered before it sees the
 *   app's `@import "tailwindcss"` — there are no utilities in the file yet to rewrite.
 *   This is the mirror of `adaptvCssLayerOrderPlugin`, which must be `pre` for exactly that
 *   reason: it needs the source *before* Tailwind compiles it away.
 * - **`enforce: "post"` is too late.** Verified against a clean build: with `post`, the
 *   emitted stylesheet still contained 4 `var(--tw-ring-inset,)` and zero carriers — Vite's
 *   own CSS post-processing has already taken the stylesheet by then. Dropping `enforce`
 *   fixed it in the same build (0 fallbacks, carriers present).
 *
 * So: a NORMAL plugin, which Vite runs after every `pre` plugin (Tailwind included) and
 * before its own CSS output stage. **If you add an `enforce` here, the rewrite silently
 * stops happening** — the CSS still builds, the tests still pass (they call
 * {@link rewriteEmptyFallbacks} directly), and only an old Android WebView shows the damage.
 * Re-verify by grepping the built stylesheet for `var(--tw-`…`,)`; it must be 0.
 */
export function adaptvTailwindEmptyFallbackPlugin(): PluginOption {
  let warned = false
  return {
    name: "adaptv:tailwind-empty-fallback",
    //NO `enforce` — see the header. Both "pre" and "post" break this silently.
    transform(code, id) {
      if (!isTransformableCssId(id)) return null
      const rewritten = rewriteEmptyFallbacks(code, () => {
        if (warned) return
        warned = true
        //the channel every other adaptv vite plugin warns through (sw-build.ts)
        console.warn(`[adaptv] ${RING_INSET_ORDER_MESSAGE}`)
      })
      if (rewritten === null) return null
      //no source map: declarations rewritten in place within their own lines
      return { code: rewritten, map: null }
    },
  }
}
