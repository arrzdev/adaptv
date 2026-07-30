import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import {
  compileAdaptvStyles,
  ruleFor,
} from "#adaptv/styles/compile.test-helper"

//These assert on the stylesheet text rather than on computed style: the rules
//below encode WebKit bug workarounds that are *indistinguishable from the naive
//spelling* in any DOM we can test against. happy-dom resolves both spellings
//identically, and so does every engine except the one that's broken. Locking the
//text is the only regression guard that actually fires.
//`import.meta.url` is not a file: URL under the happy-dom environment, so resolve
//from the project root instead.
const utilsCss = readFileSync(
  join(process.cwd(), "src/styles/utils.css"),
  "utf8",
)

describe("utils.css — clickable must not use the touch-action shorthand", () => {
  //WebKit 240917 (NEW, 2022): `pointercancel` is NOT dispatched when an element
  //has `touch-action: manipulation`. The expanded longhand is spec-identical and
  //does dispatch it. Ionic hit the same wall and ships the same workaround.
  //
  //This is not cosmetic: `pointercancel` is how a gesture learns that a scroll
  //took over. Any adaptv surface that is both tappable and gesture-driven — a
  //Button inside Swipeable, a drawer handle — strands its gesture state machine
  //on iOS if the shorthand comes back.
  it("spells touch-action as the longhand, never `manipulation`", async () => {
    /*
     * adaptv used to own a `clickable` utility that hard-coded this longhand. It is now
     * the three composable Tailwind classes, so the claim has to be checked on the
     * COMPILED result of all three together — each one alone only sets its own
     * `--tw-*` var, and reading one in isolation would say nothing.
     *
     * `manipulation` is the trap: it is what everyone reaches for and it is
     * spec-equivalent, but WebKit 240917 stops firing `pointercancel` under it, which
     * strands the press engine mid-gesture.
     */
    const css = await compileAdaptvStyles([
      "touch-pan-x",
      "touch-pan-y",
      "touch-pinch-zoom",
    ])
    expect(css).toContain(
      "touch-action: var(--tw-pan-x,) var(--tw-pan-y,) var(--tw-pinch-zoom,)",
    )
    for (const [cls, value] of [
      ["touch-pan-x", "--tw-pan-x: pan-x"],
      ["touch-pan-y", "--tw-pan-y: pan-y"],
      ["touch-pinch-zoom", "--tw-pinch-zoom: pinch-zoom"],
    ]) {
      expect(ruleFor(css, `.${cls}`)).toContain(value)
    }
    expect(css).not.toContain("touch-action: manipulation")
  })

  it("carries the bug reference so the shorthand is not 'simplified' back in", () => {
    expect(utilsCss).toContain("240917")
  })

  it("keeps the shorthand out of every other utility too", () => {
    //strip comments first: the rule above *names* the shorthand in prose to explain
    //why it's banned, and that must not read as a violation
    const declarations = utilsCss.replace(/\/\*[\s\S]*?\*\//g, "")
    expect(declarations).not.toContain("manipulation")
  })
})

/*
 * The `hover:` override (patches.css). Compiled, not text: a `@custom-variant` that
 * fails to parse silently falls back to Tailwind's built-in, and the difference is
 * invisible in the source.
 */
describe("hover: — the sticky-hover + focus-ring variant", () => {
  async function hoverSelector() {
    const css = await compileAdaptvStyles(["hover:bg-red-500"])
    const rule = css.slice(css.indexOf(".hover\\:bg-red-500"))
    return rule.slice(0, rule.indexOf("{", rule.indexOf("&:hover")))
  }

  //Overriding a built-in variant DISCARDS Tailwind v4's own definition, which already
  //wraps `hover:` in `@media (hover: hover)` (the sticky-hover-after-tap fix is theirs,
  //verified in tailwindcss@4.2.4 dist/chunk-3IR7ZFJX.mjs). Re-supplying it is required.
  it("keeps the (hover: hover) guard the override would otherwise discard", async () => {
    expect(await hoverSelector()).toContain("@media (hover: hover)")
  })

  //`:focus-visible` is BY SPEC a subset of `:focus`, so a `:not(:focus-visible)` clause
  //is dead weight; and `:not()` takes the specificity of its most specific argument, so
  //grouping the remainder in one `:is()` drops the variant from (0,4,0) to (0,2,0) —
  //two class-level points every consumer override used to have to out-specify.
  it("is (0,2,0): one :not(:is(…)), no redundant :focus-visible clause", async () => {
    const selector = await hoverSelector()
    expect(selector).toContain("&:hover:not(:is(:focus, :focus-within))")
    expect(selector).not.toContain(":focus-visible")
    //(0,2,0) = the `:hover` pseudo-class + the most specific `:not()` argument.
    //Count only what follows the class name, so the escaped `.hover\:bg-red-500`
    //selector itself is not read as a pseudo-class.
    const pseudoClasses =
      selector
        .slice(selector.indexOf("&"))
        .match(/:(?!not\b|is\b)[a-z-]+/g) ?? []
    expect(pseudoClasses).toEqual([":hover", ":focus", ":focus-within"])
  })

  it("names Tailwind as the owner of the media-query half", () => {
    const patchesCss = readFileSync(
      join(process.cwd(), "src/styles/patches.css"),
      "utf8",
    )
    expect(patchesCss).toContain("4.2.4")
  })
})

/*
 * The `active:` override (patches.css). Same reason as `hover:` for compiling rather
 * than reading the source: a `@custom-variant` that fails to parse falls back to
 * Tailwind's built-in silently, and here that fallback is precisely the bug — every
 * gesture-engine element would go back to a `:active` that cannot be cleared from JS.
 */
describe("active: — the press variant, patched rather than renamed", () => {
  async function activeRule() {
    const css = await compileAdaptvStyles(["active:scale-95"])
    const start = css.indexOf(".active\\:scale-95")
    expect(start, "active:scale-95 emitted no rule").toBeGreaterThan(-1)
    //the variant emits one rule per branch; take everything up to the next
    //unrelated selector by slicing to the end of the second branch's block
    return css.slice(
      start,
      css.indexOf("\n}", css.indexOf(":active", start)),
    )
  }

  //Branch 1. `data-pressed` is the reentrant, JS-owned state — the only thing that
  //survives a finger dragging off the target and sliding back in.
  it("routes a gesture-engine element to [data-pressed]", async () => {
    expect(await activeRule()).toContain("&[data-pressed]")
  })

  //Branch 2, and the whole reason the variant has two. Rewriting `active:` to
  //`&[data-pressed]` ALONE would silently kill a consumer's own
  //`<button className="active:scale-95">` — no error, no attribute, no style.
  it("does NOT regress a plain element: it still gets :active", async () => {
    const rule = await activeRule()
    expect(rule).toContain("&:active:not([data-press-engine])")
  })

  //…and the two branches must not overlap, or an engine element would ALSO light on
  //native :active — which is the stuck-highlight bug the engine exists to avoid,
  //since :active cannot be cleared from JS.
  it("excludes native :active on an engine element", async () => {
    const rule = await activeRule()
    const activeBranch = rule.slice(rule.indexOf("&:active"))
    expect(activeBranch).toContain(":not([data-press-engine])")
  })

  //Specificity, the same audit `hover:` gets. `[data-pressed]` is (0,1,0) and
  //`:active:not([attr])` is (0,2,0) — both cheap enough that an ordinary consumer
  //rule can out-specify them, which is the point of keeping the `:not()` to a
  //single attribute selector rather than a `:is()` list.
  it("keeps both branches at or below (0,2,0)", async () => {
    const rule = await activeRule()
    /** The selector of one branch — everything from `&` to its opening brace. */
    const selectorOf = (marker: string) => {
      const from = rule.indexOf(marker)
      return rule.slice(from, rule.indexOf("{", from))
    }

    //(0,1,0): one attribute selector, no pseudo-class at all
    const pressed = selectorOf("&[data-pressed]")
    expect(pressed.match(/\[[^\]]+\]/g)).toEqual(["[data-pressed]"])
    expect(pressed.match(/:[a-z-]+/g)).toBeNull()

    //(0,2,0): the `:active` pseudo-class + the single `:not()` argument
    const active = selectorOf("&:active")
    expect(active.match(/\[[^\]]+\]/g)).toEqual(["[data-press-engine]"])
    expect(active.match(/:(?!not\b)[a-z-]+/g)).toEqual([":active"])
  })

  //`pressed:` is GONE, not aliased. Keeping it would reinstate the two-ways problem
  //the fold exists to remove — and an alias is the version people keep writing.
  it("has no surviving `pressed:` variant", async () => {
    const css = await compileAdaptvStyles(["pressed:scale-95"])
    expect(css).not.toContain("pressed\\:scale-95")
  })
})

/*
 * The utilities that used to carry a cascade-only `!important` (STYLING.md §6.0.1).
 * They now win on LAYER order — `utilities` is declared after `adaptv.*` — so the
 * declarations must be plain, or the important-inversion trap comes straight back.
 */
describe("utils.css — no !important survives in the utilities", () => {
  it("emits `selectable` without !important", async () => {
    //`non-clickable` used to be checked here too; it is plain `touch-none select-none`
    //now, so there is no adaptv rule left for it to smuggle an !important into
    const css = await compileAdaptvStyles(["selectable"])
    expect(ruleFor(css, ".selectable")).toBe(
      "-webkit-user-select: text; user-select: text;",
    )
  })
})

/*
 * The `gpuBoost` patch — a rAF sentinel that flipped `will-change` / `translate3d` /
 * `perspective` / `backface-visibility` on the app frame and every scroller when it
 * decided frames were scarce — is DELETED, and must not come back. → PERFORMANCE-BOOST.md
 *
 * Three findings, each sufficient on its own:
 *   1. The remedy mutates layout. Every one of those four declarations independently
 *      makes the element a containing block for its `position: fixed` and `absolute`
 *      descendants (css-transforms-1 §3, css-transforms-2 §8/§10, css-will-change §2).
 *      Toggling them at runtime re-anchors fixed children mid-session.
 *   2. It never latched. `wake()` reset the frame counter but NOT `consecutiveDropsRef`,
 *      and `wake()` was bound to `pointerdown` / `scroll` / `touchmove` — so two ordinary
 *      scroll gestures, minutes apart, tripped it on any hardware, and the next good
 *      window cleared it. The observable behaviour was a global promote/demote
 *      oscillation during scrolling, on fast devices included.
 *   3. It promoted what was already promoted. WebKit accelerates every
 *      `overflow: scroll` since iOS 13; Chromium's scroll unification composites all
 *      scrollers. The layer was already there; only the containing-block change was new.
 *
 * Compiled, not text: an `@utility` that fails to parse emits nothing silently, so
 * reading utils.css could not tell "deleted" from "broken" — and it is the shipped
 * stylesheet, not the source, that has to be clean.
 */
describe("the gpu boost is gone and cannot be reintroduced by accident", () => {
  it("emits no `.hardware-boosted` rule, so the class is not a utility any more", async () => {
    const css = await compileAdaptvStyles(["hardware-boosted"])
    expect(ruleFor(css, ".hardware-boosted")).toBeNull()
  })

  //`scrollable-*` used to `@apply hardware-boosted`. A promotion hint here is the
  //worst case of finding 1: a `position: fixed` child inside a scroller stops being
  //fixed and scrolls with the content.
  it("ships no promotion hint anywhere in the stylesheet", async () => {
    /*
     * This used to check the two `scrollable-*` utilities specifically. adaptv no
     * longer owns them — scroll surfaces are spelled in raw Tailwind at the call site —
     * so the guard is now the broader and stronger claim: nothing adaptv ships promotes
     * a layer. `PERFORMANCE-BOOST.md` is the measurement behind it; the short version is
     * that a blanket `will-change`/`translateZ` costs memory on every one of these
     * elements and buys nothing, and it is the kind of thing that gets pasted back in
     * because it "feels faster".
     */
    const css = await compileAdaptvStyles([
      "selectable",
      "scrollbar-hidden",
      "scrollbar-visible",
    ])
    for (const hint of [
      "will-change",
      "translateZ",
      "translate3d",
      "perspective",
      "backface-visibility",
    ]) {
      expect(
        css,
        `${hint} is back in the shipped stylesheet`,
      ).not.toContain(hint)
    }
  })
  it("ships a stylesheet with no trace of the boost", async () => {
    const css = await compileAdaptvStyles([])
    expect(css).not.toContain("data-gpu-boost")
    expect(css).not.toContain("--adaptv-gpu-boost")
    expect(css).not.toContain("hardware-boosted")
  })

  //The JS half: the sampler, its `patches.gpuBoost` gate, and the public export that
  //let a consumer mount a SECOND sampler fighting the shell's over one `<html>` attribute.
  it("carries no sentinel, no config flag and no export in src/", () => {
    expect(
      existsSync(
        join(process.cwd(), "src/hooks/use-global-fps-sentinel.ts"),
      ),
    ).toBe(false)

    //tests are excluded because THIS one has to spell the dead names to look for them
    const sources = readdirSync(join(process.cwd(), "src"), {
      recursive: true,
      withFileTypes: true,
    }).filter(
      (entry) =>
        entry.isFile() &&
        /\.tsx?$/.test(entry.name) &&
        !/\.test\.tsx?$/.test(entry.name),
    )

    for (const entry of sources) {
      const path = join(entry.parentPath, entry.name)
      const source = readFileSync(path, "utf8")
      for (const dead of [
        "useGlobalFpsSentinel",
        "use-global-fps-sentinel",
        "gpuBoost",
        "data-gpu-boost",
      ]) {
        expect(source, `${path} still mentions \`${dead}\``).not.toContain(
          dead,
        )
      }
    }
  })
})
