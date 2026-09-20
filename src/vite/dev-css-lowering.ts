/**
 * Lower what an old engine silently throws away out of the DEV stylesheet, the way the build
 * already does. → `docs/design/vite-plugin-map.md` §2.5
 *
 * ## The bug
 *
 * Tailwind v4 compiles a variant into a NESTED rule, and writes a breakpoint in RANGE syntax:
 *
 * ```css
 * .x { @media (display-mode: standalone) { … } &:where(html[data-adaptv-platform="native"] *) { … } }
 * .y { @media (width >= 40rem) { … } }
 * ```
 *
 * - **Nesting.** An engine without it — Safari < 16.5, so iOS 15 and 16.0–16.4, and Chromium <
 *   112 — keeps the outer rule and throws away everything nested in it. In the playground's own
 *   dev stylesheet that is 151 rules: every `app:` and `web:` utility, and every `hover:`,
 *   `dark:`, breakpoint, `data-*` and pseudo-element variant with them. On an iOS 16.2 native
 *   dev build the page content sat under the status bar.
 * - **Range media queries.** Safari parses `(width >= 40rem)` only from 16.4 (Chromium from
 *   104). Below that the query is unknown, so it matches nothing: once the nesting is gone, every
 *   `sm:`/`md:`/`lg:` rule is still dead on iOS 15 and 16.0–16.3. 31 queries in the playground.
 *   `max-sm:` and `not-sm:` are worse: lowered naively they become `not (min-width: 40rem)`,
 *   a Media Queries 4 spelling those engines do not parse either.
 *
 * Nothing errors in any case. Production never had them: `@tailwindcss/vite`'s BUILD plugin
 * runs its compiled output through `optimize` from `@tailwindcss/node`, and Vite's CSS minifier
 * lowers to `build.cssTarget` after that. Its SERVE plugin does neither, and Vite does not lower
 * CSS in dev with the default PostCSS transformer. So dev was the one place any of it reached a
 * browser.
 *
 * ## The fix: the pass production applies, sheet by sheet
 *
 * lightningcss, unminified and with no `targets`, in one of two modes:
 *
 * - **A sheet Tailwind compiled** — it carries Tailwind's `/*! tailwindcss v…` banner, which
 *   Tailwind writes into exactly the output its build plugin optimizes — gets the part of
 *   `optimize` that decides whether a rule exists: `Features.Nesting | Features.MediaQueries`
 *   (nesting, range and interval syntax, `@custom-media` with its draft flag), the same
 *   non-standard `>>>` parsing, and the same text rewrite afterwards, `@media not (` →
 *   `@media not all and (`, which is how the engines without range syntax spell a negation.
 * - **Any other sheet** — a CSS module, a side-effect import, a dependency's CSS — gets
 *   `Features.Nesting` only. Tailwind's pass never sees it in a build; Vite's minifier does, and
 *   at Vite 8's default `build.cssTarget` (Chrome 111, Safari 16.4) it flattens nesting and
 *   leaves range syntax as written. Dev does the same, so no sheet changes shape between the two.
 *
 * lightningcss is the library, and the version, `optimize` uses: `@tailwindcss/node` 4.2.4
 * depends on `lightningcss` 1.32.0 exactly, and adaptv pins the same, so one binary serves both.
 *
 * - **Not a version gate or a UA sniff.** Flat CSS with `min-width` queries means the same thing
 *   to an engine that supports nesting and range syntax, so there is nothing to detect.
 * - **Not the whole production pass.** `optimize` also lowers with browser targets (vendor
 *   prefixes, `color-mix()` fallbacks, logical properties…). Those change how a rule renders;
 *   the part above decides whether a rule exists at all.
 * - **One lightningcss pass, where `optimize` runs two.** The second merges the rules the first
 *   flattened out of nesting into selector lists and adjacent `@media` blocks. With targets,
 *   lightningcss knows which selectors an old engine lacks and keeps those apart; without
 *   targets it would not, and one selector an engine cannot parse kills the whole list there.
 *   Skipping it keeps every Tailwind variant unmerged, which the cascade does not tell apart.
 *   The one pass still merges adjacent top-level rules with identical declarations, and
 *   without targets it can do that to a pair a build keeps apart (`.a:hover` next to
 *   `.b::details-content`): Tailwind nests its variants, so its utilities are not exposed, but
 *   such a pair in an authored sheet renders differently in dev on the floor engines.
 * - **A dependency's prebuilt Tailwind CSS** carries the banner too, so dev gives it Tailwind's
 *   pass while a build leaves its range syntax to Vite's minifier. Rare, and dev-only.
 * - **Not the build.** `apply: "serve"`: the build is already lowered, and a second pass there
 *   would only re-print it.
 *
 * lightningcss prints what it parsed rather than echoing the source, so a few things change
 * beyond those, all of which production already does to the same rules: numbers lose a leading
 * zero (`0.5` → `.5`), a `color-mix()` over literal colours is resolved to the colour it
 * computes (`color-mix(in oklab, red 50%, transparent)` → `oklab(… / .5)`; one over a `var()` is
 * left alone), some shorthands move to the end of their declaration block, and an empty `var()`
 * fallback gains a space (`var(--x,)` → `var(--x, )`). That last one is why this plugin sits
 * BEFORE the empty-fallback rewrite — see {@link adaptvDevCssLoweringPlugin}.
 */

import type { TransformOptions } from "lightningcss"
import { Features, transform } from "lightningcss"
import type { Plugin } from "vite"
import { isTransformableCssId } from "#adaptv/vite/css-layer-order.ts"

export type LoweredCss = {
  code: string
  /** A v3 source map as JSON, or `null` when none was asked for. */
  map: string | null
  /** lightningcss's warnings, as text. Empty for everything Tailwind 4.2.4 emits. */
  warnings: string[]
}

/** Tailwind writes this above everything it compiles, and above nothing else. */
const TAILWIND_BANNER = "/*! tailwindcss v"

/** The part of `@tailwindcss/node`'s `optimize` that decides whether a rule exists. */
const TAILWIND_PASS = {
  include: Features.Nesting | Features.MediaQueries,
  drafts: { customMedia: true },
  nonStandard: { deepSelectorCombinator: true },
} satisfies Partial<TransformOptions<never>>

/** What Vite's build minifier does to every other sheet at its default `build.cssTarget`. */
const AUTHORED_PASS = {
  include: Features.Nesting,
} satisfies Partial<TransformOptions<never>>

/** `optimize` drops these too: the non-standard pseudos a framework compiler leaves for it. */
const IGNORED_TAILWIND_WARNING =
  /'(deep|slotted|global)' is not recognized as a valid pseudo-/

/**
 * `code` with every nested rule hoisted to the top level and, in a sheet Tailwind compiled,
 * every media query written the way Safari < 16.4 parses it. Pure, so the whole decision is
 * testable without a bundler.
 *
 * `errorRecovery` matches `optimize`: a rule lightningcss cannot parse is dropped with a
 * warning instead of failing the request, which is what a browser does with it anyway, and the
 * warning is surfaced rather than swallowed.
 *
 * The `not all and` rewrite runs on lightningcss's output without re-mapping it. That is exact:
 * lightningcss maps an at-rule by its `@` alone, and the rewrite inserts after it, on the same
 * line, moving nothing that is mapped. `dev-css-lowering.test.ts` holds that.
 */
export function lowerDevCss(
  code: string,
  id: string,
  options: { sourceMap?: boolean } = {},
): LoweredCss {
  const tailwind = code.includes(TAILWIND_BANNER)
  const result = transform({
    filename: id,
    code: Buffer.from(code),
    minify: false,
    sourceMap: options.sourceMap === true,
    errorRecovery: true,
    ...(tailwind ? TAILWIND_PASS : AUTHORED_PASS),
  })
  const lowered = result.code.toString()
  return {
    code: tailwind
      ? lowered.replaceAll("@media not (", "@media not all and (")
      : lowered,
    map: result.map ? result.map.toString() : null,
    warnings: result.warnings
      .filter(
        (w) => !(tailwind && IGNORED_TAILWIND_WARNING.test(w.message)),
      )
      .map((w) => `${w.message} (${w.loc.line}:${w.loc.column})`),
  }
}

/**
 * Serve every stylesheet lowered as the build lowers it, so dev renders on the engines
 * production renders on.
 *
 * ## ⚠︎ Position: no `enforce`, and BEFORE the empty-fallback rewrite in the array
 *
 * - **No `enforce`, for the same two reasons the fallback rewrite has none.** `pre` runs before
 *   `@tailwindcss/vite:generate:serve` (itself `pre`, and listed after `adaptv()`), so there is
 *   no Tailwind output yet; `post` runs after Vite's CSS stage has turned the sheet into a JS
 *   module. A normal plugin sees Tailwind's output as CSS.
 * - **Before the fallback rewrite, because that is the order production has.** In a build,
 *   Tailwind's `optimize` runs INSIDE its `pre` transform, so the rewrite has only ever been
 *   handed lightningcss-printed CSS there. Putting this pass first gives it the same input in
 *   dev: flat rules, `var(--x, )` with the printer's spacing (its patterns take `\s*`, and
 *   `dev-css-lowering.test.ts` pipes the real dev sheet through it to hold that), and its own
 *   carriers written exactly as it spells them. After it, the carriers the rewrite introduces
 *   would be re-printed by lightningcss before reaching the one browser they exist for — a
 *   byte shape production never ships.
 *
 * HMR needs nothing extra: a CSS update is the same module re-transformed, and a Tailwind
 * rescan invalidates that module, so every update comes through here.
 *
 * Source map: only when `css.devSourcemap` is on, since that is the only time Vite reads one
 * for CSS. Otherwise `{ mappings: "" }`, which tells Vite the code moved and no map exists;
 * `null` would claim the positions were unchanged, and flattening moves every nested rule.
 */
export function adaptvDevCssLoweringPlugin(): Plugin {
  let sourceMap = false
  return {
    name: "adaptv:dev-css-lowering",
    apply: "serve",
    //NO `enforce` — see above. `pre` sees no Tailwind output, `post` sees JavaScript.
    configResolved(config) {
      sourceMap = config.css.devSourcemap === true
    },
    transform(code, id) {
      if (!isTransformableCssId(id)) return null
      const lowered = lowerDevCss(code, id, { sourceMap })
      for (const warning of lowered.warnings) {
        //Vite prefixes the plugin name and attaches the module id itself
        this.warn(warning)
      }
      return {
        code: lowered.code,
        map: lowered.map ?? { mappings: "" },
      }
    },
  }
}
