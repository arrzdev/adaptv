/**
 * Make Tailwind v4's `ring-*` utilities render on Chromium 113–118. → `docs/decisions/register.md`
 *
 * ## The bug, in one line of CSS
 *
 * ```css
 * .ring-1 { --tw-ring-shadow: var(--tw-ring-inset,) 0 0 0 calc(1px + …) var(--tw-ring-color, currentcolor) }
 * ```
 *
 * `--tw-ring-inset` is registered with `syntax: "*"` and **no `initial-value`**, so it holds
 * the guaranteed-invalid value, and `var(--tw-ring-inset,)` is supposed to substitute the
 * EMPTY fallback. Chromium 113–118 instead throw the whole declaration away. `--tw-ring-shadow`
 * falls back to its `0 0 #0000` initial, and every `ring-*` / `focus:ring-*` in the app
 * silently computes to nothing — checkboxes, field hairlines, focus states. Nothing errors.
 *
 * Bisected across every Chrome-for-Testing milestone 113→119: broken 113–118, fixed in 119,
 * with 113 cross-checked against a real Android WebView 113.
 *
 * ## The rewrite
 *
 * Move the shadow body into an **unregistered** custom property, so no empty fallback exists
 * anywhere, and let `.ring-inset` prepend the keyword by re-declaring the whole thing:
 *
 * ```css
 * .ring-1     { --adaptv-tw-ring: 0 0 0 calc(1px + …) var(--tw-ring-color, currentcolor);
 *               --tw-ring-shadow: var(--adaptv-tw-ring) }
 * .ring-inset { --tw-ring-shadow: inset var(--adaptv-tw-ring) }
 * ```
 *
 * Unregistered is the whole trick: the bug is specific to `var()` over a REGISTERED property
 * with no initial-value, and `--adaptv-tw-ring` is never registered. **Do not "tidy" it into
 * an `@property`** — that reintroduces the exact bug this file exists to remove, on a
 * browser nobody on the team is testing.
 *
 * ## Why this is unconditional — no UA sniff, no `@supports`, no stamp
 *
 * The rewrite is **byte-identical on browsers that were never broken.** Measured on device,
 * both constructs side by side: WebView 149 computes the same five-shadow stack for ring and
 * for ring-inset either way. So there is nothing to detect and nothing to branch on — which
 * also means no `@supports` (the failure is at computed-value time, so
 * `CSS.supports("box-shadow","var(--x,) 0 0 0 1px red")` returns **true** on a broken build
 * and cannot see it) and no runtime probe in the boot path.
 *
 * ## Why not rewrite `ring` to `outline`
 *
 * `outline` is immune to this bug and costs no layout — but an element has exactly ONE
 * outline, and `box-shadow` composes. Apps put `ring-1 … focus-within:outline-none` on one
 * element (the playground's own `text-input` does), so collapsing the two properties would
 * make `outline-none` erase the ring precisely on focus. It also cannot express
 * `ring-offset-*`, whose gap is painted in `--tw-ring-offset-color` where `outline-offset`'s
 * is transparent. Staying in `box-shadow` keeps every one of those independent.
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
 * ones. Caught here once already; `ring-shadow-fallback.test.ts` now guards it.
 *
 * `-tw-` also says what these are: a carrier for TAILWIND's `--tw-ring-*`, not an adaptv
 * design token anyone should read or set.
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
 * Rewrite Tailwind's compiled `ring-*` utilities so they survive Chromium 113–118.
 *
 * ## ⚠︎ The plugin ordering is measured, and BOTH ends of it are load-bearing
 *
 * No `enforce`. That is deliberate, and it is the narrow slot between two failures:
 *
 * - **`enforce: "pre"` is too early.** `@tailwindcss/vite:generate:{build,serve}` is itself
 *   `enforce: "pre"` (read from its dist, 4.2.4). A `pre` plugin ordered before it sees the
 *   app's `@import "tailwindcss"` — there are no ring utilities in the file yet to rewrite.
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
 * {@link rewriteRingShadow} directly), and only an old Android WebView shows the damage.
 * Re-verify by grepping the built stylesheet for `var(--tw-ring-inset,)`; it must be 0.
 */
export function adaptvRingShadowPlugin(): PluginOption {
  let warned = false
  return {
    name: "adaptv:ring-shadow-fallback",
    //NO `enforce` — see the header. Both "pre" and "post" break this silently.
    transform(code, id) {
      if (!isTransformableCssId(id)) return null
      const rewritten = rewriteRingShadow(code, () => {
        if (warned) return
        warned = true
        //the channel every other adaptv vite plugin warns through (sw-build.ts)
        console.warn(`[adaptv] ${RING_INSET_ORDER_MESSAGE}`)
      })
      if (rewritten === null) return null
      //no source map: custom-property declarations rewritten in place within one line
      return { code: rewritten, map: null }
    },
  }
}
