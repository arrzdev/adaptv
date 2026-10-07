import type {
  ComponentPropsWithRef,
  CSSProperties,
  ReactElement,
  ReactNode,
} from "react"
import { cloneElement, useRef } from "react"
import { useIsomorphicLayoutEffect } from "#adaptv/hooks/use-isomorphic-layout-effect"
import { useMergedRef } from "#adaptv/hooks/use-merged-ref"
import { composeStyles } from "#adaptv/utils/styles"
import { measureDynamicTypeScale } from "#adaptv/utils/text-scale"

/**
 * The element {@link Text} should render instead of its default `<span>` — a `<p>`, an
 * `<h1>`, a `<label>`, a `<figcaption>`. → `docs/decisions/styling.md §3.3` (a prop, not `asChild`).
 *
 * **Element-only, unlike {@link Pressable}'s.** The function form of `render` earns its
 * keep by rendering state-dependent *content*, and `Text` publishes no state to branch
 * on — every prop it takes is already expressible on the element you pass in.
 */
export type TextRender = ReactElement<{
  className?: string
  style?: CSSProperties
  children?: ReactNode
}>

/**
 * What {@link Text} hands to the element passed to `render`. The `data-*` index
 * signature is what lets the attributes below live in a plain object rather than only
 * in JSX.
 */
export type TextSlotProps = ComponentPropsWithRef<"span"> & {
  [attribute: `data-${string}`]: string | undefined
}

/**
 * Props for {@link Text}. Extends native `<span>` props, so it drops in anywhere a
 * `<span>` would. Behaviour is props; look is `className`.
 */
export interface TextProps extends ComponentPropsWithRef<"span"> {
  /**
   * Truncate to N lines with an ellipsis (RN parity name). `0`/omitted means no clamp.
   * Applied as **inline style** — see {@link textClampStyle} for the three reasons it
   * cannot be Tailwind's `line-clamp-N`.
   *
   * ⚠︎ Put vertical padding on a WRAPPER, not on the clamped element: `overflow`
   * clips at the padding box, so the line that was supposed to disappear stays
   * visible inside `pb-*`.
   */
  numberOfLines?: number
  /**
   * Let the user select this text even where adaptv's app-wide `user-select: none` is
   * live (`ui.noSelect`, default installed-PWA-and-native). Same prop name as React
   * Native's, and it writes the same declarations as the `selectable` utility a
   * consumer would write by hand — locked inline, so no class can cancel it.
   */
  selectable?: boolean
  /**
   * Scale this text with the iOS system text-size setting (Dynamic Type). **Opt-in,
   * default `false`** — it MULTIPLIES the element's built font-size by the user's
   * accessibility text-size factor, so `text-4xl` stays `text-4xl × factor` and every
   * sized class keeps its relative proportions. It never REPLACES the size, so it is
   * safe to leave on and does the right thing on any class.
   *
   * iOS-WebKit only: the factor is measured once at load (see
   * {@link measureDynamicTypeScale}) and is `1` everywhere else — non-iOS engines,
   * desktop Safari, SSR — where the element keeps exactly its className size with zero
   * inline sizing. WebKit resolves the setting at page load, so a change takes a reload.
   */
  scaleWithSystem?: boolean
  /** Render something other than a `<span>`. → `docs/decisions/styling.md §3.3`. */
  render?: TextRender
}

/**
 * The multi-line ellipsis, as an inline style. Exported for the same reason
 * `buttonHasFixedWidth` is: it is a pure function that the tests need to see directly
 * (happy-dom's CSS parser drops all three WebKit declarations, so the rendered DOM
 * cannot be asserted on), and a consumer clamping their own element gets the correct
 * incantation for free rather than re-deriving it.
 *
 * **The platform half.** The standard `line-clamp` shorthand is still not shippable in
 * 2026, and specifically not on either of adaptv's two targets. Per MDN's browser-compat
 * data: Chromium has it only behind `#enable-experimental-web-platform-features`, Safari
 * only in Technology Preview (18.2 exposed it by accident and 18.4 took it back out), and
 * both `webview_android` and `webview_ios` mirror those — so WKWebView and Android WebView
 * have nothing. The deprecated WebKit triad is therefore still mandatory, and it is three
 * co-dependent declarations plus an `overflow` that everyone forgets:
 * `display: -webkit-box` + `-webkit-box-orient: vertical` + `-webkit-line-clamp: N` +
 * `overflow: hidden`.
 *
 * **Why it is inline and not a class.** Three reasons, and each one alone is decisive:
 *
 * 1. **The class cannot exist.** Tailwind v4 discovers utilities by scanning source
 *    *text*, and adaptv's own sources are scanned (`@source` in `styles/index.css`). A
 *    template literal `line-clamp-${n}` is never a literal token, so no rule is ever
 *    generated — the class would reach the DOM and match nothing. Fails soft, exactly
 *    like the `@utility` trap in `styles/compile.test-helper.ts`.
 * 2. **`locked` would not hold.** `cn("line-clamp-2", "overflow-visible")` keeps BOTH —
 *    tailwind-merge has no conflict edge between the two groups — so which one applies
 *    is decided by the order Tailwind happened to emit them. That is the `WheelColumn`
 *    failure `docs/decisions/styling.md §5.5` documents, on a property the clamp depends on.
 * 3. **Inline style is its own cascade origin** (§2.1), so `lockedStyle` is the only
 *    tier that survives a consumer's `flex` or `overflow-auto` at all.
 */
export function textClampStyle(
  numberOfLines: number | undefined,
): CSSProperties | undefined {
  if (!numberOfLines || numberOfLines < 1) return undefined
  return {
    display: "-webkit-box",
    WebkitBoxOrient: "vertical",
    WebkitLineClamp: numberOfLines,
    overflow: "hidden",
  }
}

/**
 * LOCKED, inline: `selectable` is per-instance selection over adaptv's app-wide
 * `user-select: none` reset (stamped on `<html>` from `ui.noSelect`, in
 * `adaptv.reset`). It is locked because the consumer ASKED for it via a prop — their own
 * stray `select-none` in the same className, or a `userSelect` in `style`, must not
 * cancel it — and inline style is the one tier no class reaches
 * (docs/decisions/styling.md §2.0). Same declarations as the `selectable` utility in
 * styles/utils.css, which a consumer can still write by hand.
 */
const TEXT_SELECTABLE_LOCKED_STYLE: CSSProperties = Object.freeze({
  WebkitUserSelect: "text",
  userSelect: "text",
})

/** The `data-part` a node already carries, which Text keeps rather than overwrite. */
function ownDataPart(source: object | undefined): string | undefined {
  const part = (source as { "data-part"?: unknown } | undefined)?.[
    "data-part"
  ]
  return typeof part === "string" ? part : undefined
}

/** The whole inline lock: the clamp and the selection opt-in, both prop-driven. */
function textLockedStyle(
  numberOfLines: number | undefined,
  selectable: boolean,
): CSSProperties | undefined {
  const clamp = textClampStyle(numberOfLines)
  if (!selectable) return clamp
  return clamp
    ? { ...clamp, ...TEXT_SELECTABLE_LOCKED_STYLE }
    : TEXT_SELECTABLE_LOCKED_STYLE
}

/**
 * A run of text, with the platform quirks a `<p>` does not get.
 *
 * The bar a primitive has to clear here is **two platform quirks it would own**
 * (`docs/research/component-surface.md §8.1`) — below that it is a styled element with an import
 * cost. `Text` clears it with three:
 *
 * | Quirk | Where it lives |
 * |-------|----------------|
 * | **iOS Dynamic Type**, measured as a scalar and multiplied into the element's built font-size so a rem-based layout is left untouched | {@link measureDynamicTypeScale} + a layout effect |
 * | **Line clamping**, whose standard property is still unavailable in both target webviews and whose WebKit fallback hides in `display` | {@link textClampStyle}, inline |
 * | **Per-instance selection** over the app-wide `ui.noSelect` reset | `user-select: text`, locked inline |
 *
 * **It renders a `<span>` by default**, not a `<p>`: a `<span>` nests inside another
 * `<Text>` without producing invalid markup (the parser auto-closes a `<p>` the moment
 * a block starts inside it), which is the same composability React Native's `Text` has.
 * Reach for `render={<p />}` when the thing genuinely is a paragraph.
 *
 * | Attribute | When |
 * |-----------|------|
 * | `data-adaptv="text"` | always — target every run of text from global CSS with no imports |
 * | `data-part="root"` | always, unless the node already carries a `data-part` |
 * | `data-scale-with-system` | `scaleWithSystem` (opt-in) — a marker only; the sizing is done in JS |
 *
 * ⚠︎ **It does not own the iOS text magnifier.** `useSuppressTextMagnifier` is mounted
 * app-wide by the shell and has to be: it is a document-level double-tap interceptor
 * that exempts editable hosts only — controls are deliberately NOT exempt — and the
 * loupe is not text-only.
 * (`docs/research/component-surface.md §8.2` — the whole invisible shell-mounted layer.)
 *
 * @example
 * ```tsx
 * <Text className="text-gray-500">Draft saved</Text>
 *
 * // clamp a preview, with the padding on the wrapper where it belongs
 * <View className="p-4">
 *   <Text numberOfLines={2}>{email.body}</Text>
 * </View>
 *
 * // a real paragraph the user can copy out of an installed app
 * <Text render={<p />} selectable>{error.message}</Text>
 * ```
 */
export function Text({
  numberOfLines,
  selectable = false,
  scaleWithSystem = false,
  render,
  className,
  style,
  children,
  ref,
  ...props
}: TextProps) {
  //An element passed to `render` carries its own className/style, written at the same
  //call site as Text's own — so both are the CONSUMER tier, and neither may outrank
  //`locked`. §3.3: the composition path routes through composeStyles instead of
  //concatenating and letting stylesheet source order decide. Text's own props go last,
  //so they win the per-property tie — Base UI's order, and the more local of the two.
  //
  //No default look: a run of text has nothing to override, so adaptv ships no rule for
  //it. Size, colour, weight and leading are className, all of them (VISION.md
  //principle 2) — a `size` prop here would be pure presentation wearing a prop's clothes.
  const merged = composeStyles({
    className: [render?.props.className, className],
    style: { ...render?.props.style, ...style },
    lockedStyle: textLockedStyle(numberOfLines, selectable),
  })

  //One ref, whichever element ships. `measureRef` is what the layout effect reads to
  //scale; merging it with the consumer's `ref` (and putting the merged callback in
  //`slotProps`) is what makes `scaleWithSystem` work identically on BOTH the `<span>`
  //path and the `cloneElement(render, …)` path — the same node the consumer's ref sees.
  const measureRef = useRef<HTMLSpanElement | null>(null)
  const mergedRef = useMergedRef(measureRef, ref ?? null)

  //iOS Dynamic Type as a MULTIPLY, not a replace. `useLayoutEffect` (isomorphic so SSR
  //stays quiet) runs before paint, so there is no flash from the built size to the
  //scaled one. Off iOS the scalar is 1 and this does nothing — the element keeps exactly
  //its className size with no inline sizing at all (the whole point of the opt-in default).
  useIsomorphicLayoutEffect(() => {
    if (!scaleWithSystem) return
    const el = measureRef.current
    if (!el) return

    const scale = measureDynamicTypeScale()

    //Start every run from the class-computed size: drop any inline size a previous run —
    //or a previous `className` — left on the element, so `getComputedStyle` reads the
    //BUILT size and not our own last answer.
    el.style.fontSize = ""
    el.style.lineHeight = ""

    if (scale !== 1) {
      const built = getComputedStyle(el)
      const baseFontSize = Number.parseFloat(built.fontSize)
      //Scale the line-height too, or the taller glyphs collide at the big sizes.
      const baseLineHeight = Number.parseFloat(built.lineHeight)
      if (baseFontSize > 0) {
        el.style.fontSize = `${baseFontSize * scale}px`
      }
      //`normal` parses to NaN — leave leading to the cascade rather than pinning a number.
      if (!Number.isNaN(baseLineHeight)) {
        el.style.lineHeight = `${baseLineHeight * scale}px`
      }
    }

    //Opting back out (or unmounting) must not strand a scaled size on the element.
    return () => {
      el.style.fontSize = ""
      el.style.lineHeight = ""
    }
    //`merged.className` IS the built size — re-measure whenever it (or the opt-in) changes.
  }, [scaleWithSystem, merged.className])

  const slotProps: TextSlotProps = {
    ...props,
    //Only wire the measurement ref when the opt-in is on, so a plain `<Text>` forwards
    //the consumer's ref exactly as before and carries zero scaling machinery.
    ref: scaleWithSystem ? mergedRef : ref,
    //no consumer class, no attribute: Text writes no class of its own
    className: merged.className || undefined,
    style: merged.style,
    "data-adaptv": "text",
    //a `data-part` already on the node (the consumer's, or the render element's) is kept
    "data-part":
      ownDataPart(props) ?? ownDataPart(render?.props) ?? "root",
    //`""`, not `true`: React stringifies a boolean data-* value to "true", and this is
    //a PRESENCE attribute (§3.1) — a marker the opt-out has to REMOVE, not set to "false".
    "data-scale-with-system": scaleWithSystem ? "" : undefined,
  }

  if (render) {
    //`children` is passed as cloneElement's THIRD argument, never inside the config:
    //a `children: undefined` key is not "no opinion" to cloneElement, it overwrites
    //the element's own children with nothing.
    return children === undefined
      ? cloneElement(render, slotProps)
      : cloneElement(render, slotProps, children)
  }

  return <span {...slotProps}>{children}</span>
}

Text.displayName = "Text"
