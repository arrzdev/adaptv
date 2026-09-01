/**
 * Cascade-layer order, injected into the app's stylesheet. → `docs/decisions/styling.md §6.0`
 *
 * ## The trap this removes
 *
 * CSS fixes layer order by **first mention**, and a layer name first mentioned in a
 * LATER statement is *appended to the end* rather than inserted where it is written.
 * So an app that imports adaptv's stylesheet gets:
 *
 * ```
 * @import "tailwindcss";              → @layer theme, base, components, utilities;
 * @import "@arrzdev/adaptv/styles.css";  → adaptv first mentioned HERE, so it lands
 *                                          AFTER utilities
 * ```
 *
 * …and every rule adaptv ships starts beating the app's own Tailwind utilities. It
 * looks exactly like a adaptv bug, and the app cannot fix it by writing the order it
 * wants further down the file — a second statement can only re-state what is already
 * known. The one fix the spec allows is a `@layer` STATEMENT before every `@import`
 * (statements and `@charset` are the only rules permitted there), which is why this
 * cannot be shipped from inside `styles/index.css` and used to be a hand-written line
 * in the consumer's entry stylesheet that nothing checked and everyone forgot.
 *
 * ## Why a `transform` and not a resolved virtual module
 *
 * The line has to be the first rule of the file the consumer wrote — prepending it to
 * a module adaptv owns would not help, because the consumer's own `@import
 * "tailwindcss"` would still be the first mention in THEIR file. So the only place it
 * can land is inside their source, before Tailwind compiles it away.
 *
 * ## Ordering against `@tailwindcss/vite` — the whole ballgame
 *
 * `@tailwindcss/vite` inlines `@import "tailwindcss"` and compiles the file in its own
 * `transform`, which is ALSO `enforce: "pre"` (`@tailwindcss/vite:generate:build` /
 * `:serve`, read from `dist/index.mjs` in 4.2.4). Vite sorts plugins into pre/normal/
 * post buckets and keeps array order *within* a bucket, so this plugin runs first only
 * because `adaptv()` is listed before `tailwindcss()` in the app's `vite.config.ts`.
 *
 * That is not a fragile assumption, it is a LOUD one: if Tailwind gets there first the
 * source this plugin sees is already-compiled CSS with no `@import "tailwindcss"` left
 * in it, nothing is injected, and {@link NO_TAILWIND_ENTRY_MESSAGE} is printed. The
 * failure mode is a warning naming the line to paste, never a silently wrong cascade.
 *
 * **Measured on the playground, both modes, rather than reasoned about.** With the
 * hand-written line deleted from the app's `main.css`, `vite build` emits a stylesheet
 * whose content hash is UNCHANGED (`main-BI3Rkm-d.css`) and whose first-mention order is
 * still `theme, base, adaptv, components, utilities` — so what this plugin injects and
 * what a human types are the same bytes into Tailwind's compiler. Swapping the two
 * plugins in the app's config produces the opposite, in build and in dev alike: the
 * warning fires once, and the order collapses to `components, adaptv.utilities,
 * properties, theme, base, utilities, …` — adaptv's utilities ahead of Tailwind's own,
 * which is exactly §6.0's bug.
 */

import type { PluginOption } from "vite"

/**
 * The statement, verbatim. `adaptv` sits between `base` and `components` so adaptv's
 * rules beat preflight and lose to every Tailwind utility — including the app's own.
 */
export const ADAPTV_LAYER_ORDER =
  "@layer theme, base, adaptv, components, utilities;"

/** What is printed when no stylesheet in the build declares a Tailwind entry. */
export const NO_TAILWIND_ENTRY_MESSAGE = `no stylesheet imports tailwindcss — add \`${ADAPTV_LAYER_ORDER}\` as the first line of your CSS entry, or adaptv's styles will beat your own utilities`

/**
 * A Tailwind ENTRY import: `@import "tailwindcss"` and the à-la-carte
 * `@import "tailwindcss/preflight"` / `/utilities` / `/theme` forms, in either quote
 * style, with or without `url(…)`, and with anything after it (`layer(…)`,
 * `source(…)`, a media query — all legal on a Tailwind import).
 */
const TAILWIND_ENTRY_IMPORT =
  /@import\s+(?:url\(\s*)?["']tailwindcss(?:\/[^"']*)?["']/

/**
 * A `@layer` STATEMENT (a name list terminated by `;`, not a block) that already names
 * `adaptv` as a top-level layer.
 *
 * `(?![\w.-])` is load-bearing: `@layer adaptv.reset, adaptv.patches;` — what adaptv's
 * own `index.css` declares — names SUB-layers. It does register the `adaptv` parent, but
 * only at whatever position it appears, which is the very failure this plugin exists to
 * prevent, so it must not read as "already handled".
 */
const DECLARES_ADAPTV_LAYER = /@layer[^{;]*\badaptv(?![\w.-])[^{;]*;/

/** A leading `@charset`, which the spec requires to be the very first byte of the file. */
const LEADING_CHARSET = /^\s*@charset\s+["'][^"']*["']\s*;/

/**
 * Ids this plugin may rewrite: real `.css` modules only.
 *
 * `?raw` / `?url` / `?worker` are excluded because those imports hand the source to the
 * app as DATA — injecting a rule into a string the app is about to read would be a
 * silent corruption, not a fix. `/.vite/` is the dep optimiser's cache.
 */
export function isTransformableCssId(id: string): boolean {
  if (id.includes("/.vite/")) return false
  if (/[?&](?:raw|url|worker|sharedworker)\b/.test(id)) return false
  if (/\?commonjs-proxy/.test(id)) return false
  const [file] = id.split("?", 2)
  return file.endsWith(".css")
}

/** Does this stylesheet pull in Tailwind itself? */
export function declaresTailwindEntry(source: string): boolean {
  return TAILWIND_ENTRY_IMPORT.test(source)
}

/** Has someone already fixed the order by hand? */
export function declaresLayerOrder(source: string): boolean {
  return DECLARES_ADAPTV_LAYER.test(source)
}

/**
 * The stylesheet with the layer order in front of it, or `null` when there is nothing
 * to do (not a Tailwind entry, or the order is already declared — so running this twice
 * is a no-op, and a consumer who wrote the line themselves is untouched).
 *
 * Pure, so the decision is testable without a bundler.
 */
export function injectLayerOrder(source: string): string | null {
  if (!declaresTailwindEntry(source)) return null
  if (declaresLayerOrder(source)) return null
  //`@charset` must stay the first thing in the file; the statement goes after it.
  //Anything else (comments included) is legal to push down.
  const charset = LEADING_CHARSET.exec(source)
  if (charset) {
    return `${charset[0]}\n${ADAPTV_LAYER_ORDER}\n${source.slice(charset[0].length).replace(/^\n/, "")}`
  }
  return `${ADAPTV_LAYER_ORDER}\n${source}`
}

/**
 * How long dev waits, after the first stylesheet goes through, before deciding that
 * none of them imports Tailwind.
 *
 * A build knows at `buildEnd`; a dev server never reaches one (Vite calls it on
 * shutdown), so the dev signal is "an app with stylesheets, none of which is a Tailwind
 * entry". The stylesheets of one page are transformed within milliseconds of each
 * other on the first request, so the window is enormous compared to the thing it
 * measures — and an app with NO stylesheets at all is never warned, because it has
 * nothing to fix.
 */
const DEV_VERDICT_MS = 5000

/**
 * Prepend the cascade-layer statement to the app's Tailwind entry stylesheet, and say
 * so loudly when there is no such stylesheet to prepend it to.
 */
export function adaptvCssLayerOrderPlugin(): PluginOption {
  let sawTailwindEntry = false
  let sawStylesheet = false
  let warned = false
  let devVerdict: (ReturnType<typeof setTimeout> & Unrefable) | null = null

  const cancelDevVerdict = () => {
    if (devVerdict === null) return
    clearTimeout(devVerdict)
    devVerdict = null
  }

  const verdict = () => {
    cancelDevVerdict()
    if (warned || sawTailwindEntry || !sawStylesheet) return
    warned = true
    //the channel every other adaptv vite plugin warns through (sw-build.ts)
    console.warn(`[adaptv] ${NO_TAILWIND_ENTRY_MESSAGE}`)
  }

  return {
    name: "adaptv:css-layer-order",
    //MUST be earlier than @tailwindcss/vite's own `pre` transform — see the header.
    enforce: "pre",
    transform(code, id) {
      if (!isTransformableCssId(id)) return null
      sawStylesheet = true

      if (declaresTailwindEntry(code)) {
        sawTailwindEntry = true
        cancelDevVerdict()
      } else if (devVerdict === null && !warned) {
        devVerdict = setTimeout(verdict, DEV_VERDICT_MS)
        //a warning must never be what holds a build process open
        devVerdict.unref?.()
      }

      const injected = injectLayerOrder(code)
      if (injected === null) return null
      //no source map: a whole-file offset of one line, on a stylesheet Tailwind is
      //about to compile from scratch anyway
      return { code: injected, map: null }
    },
    buildEnd() {
      //Only the CLIENT build's stylesheet reaches a browser, so it is the one whose
      //layer order matters — and giving the verdict per environment would let an SSR
      //build that legitimately saw no entry stylesheet warn before the client build
      //had transformed one.
      const environment = (this as { environment?: { name?: string } })
        .environment
      if (environment && environment.name !== "client") return
      verdict()
    },
  }
}

/** `setTimeout` returns a Node `Timeout` at runtime; the DOM lib types it as a number. */
type Unrefable = { unref?: () => void }
