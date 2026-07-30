import type {
  ComponentPropsWithRef,
  CSSProperties,
  ReactElement,
  ReactNode,
} from "react"
import { cloneElement } from "react"
import { mergeStyles } from "#adaptv/utils/styles"

/* =============================================================================
 * TYPES
 * ============================================================================= */

/**
 * The element {@link Text} should render instead of its default `<span>` — a `<p>`, an
 * `<h1>`, a `<label>`, a `<figcaption>`. → `STYLING.md §3.3` (a prop, not `asChild`).
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
   * Native's, and it drives the same `selectable` utility a consumer would write by
   * hand — not a second mechanism.
   */
  selectable?: boolean
  /**
   * Participate in the iOS system text-size setting. **Default `true`** — the fix is
   * worth nothing if it has to be opted into, since the app that needs it is the one
   * whose author has never heard of `-apple-system-body`.
   *
   * Reaches text you have not given an explicit size: a `className` font-size lands in
   * a later cascade layer and wins, which cuts the link to the setting. `styles/text.css`
   * has the mechanism, the `@supports` gate and both bounds written out.
   */
  dynamicType?: boolean
  /** Render something other than a `<span>`. → `STYLING.md §3.3`. */
  render?: TextRender
}

/* =============================================================================
 * LINE CLAMP
 * ============================================================================= */

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
 *    failure `STYLING.md §5.5` documents, on a property the clamp depends on.
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

/* =============================================================================
 * ROOT
 * ============================================================================= */

/**
 * A run of text, with the platform quirks a `<p>` does not get.
 *
 * The bar a primitive has to clear here is **two platform quirks it would own**
 * (`COMPONENT-SURFACE.md §8.1`) — below that it is a styled element with an import
 * cost. `Text` clears it with three:
 *
 * | Quirk | Where it lives |
 * |-------|----------------|
 * | **iOS Dynamic Type**, which only the `font` *shorthand* can reach and which the root element cannot own in a rem-based layout | `styles/text.css` |
 * | **Line clamping**, whose standard property is still unavailable in both target webviews and whose WebKit fallback hides in `display` | {@link textClampStyle}, inline |
 * | **Per-instance selection** over the app-wide `ui.noSelect` reset | the `selectable` utility |
 *
 * **It renders a `<span>` by default**, not a `<p>`: a `<span>` nests inside another
 * `<Text>` without producing invalid markup (the parser auto-closes a `<p>` the moment
 * a block starts inside it), which is the same composability React Native's `Text` has.
 * Reach for `render={<p />}` when the thing genuinely is a paragraph.
 *
 * | Attribute | When |
 * |-----------|------|
 * | `data-adaptv="text"` | always — target every run of text from global CSS with no imports |
 * | `data-dynamic-type` | `dynamicType` (the default) |
 *
 * ⚠︎ **It does not own the iOS text magnifier.** `useSuppressTextMagnifier` is mounted
 * app-wide by the shell and has to be: it is a document-level double-tap interceptor
 * that skips `.clickable` controls, and the loupe is not text-only.
 * (`COMPONENT-SURFACE.md §8.2` — the whole invisible shell-mounted layer.)
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
  dynamicType = true,
  render,
  className,
  style,
  children,
  ...props
}: TextProps) {
  //An element passed to `render` carries its own className/style, written at the same
  //call site as Text's own — so both are the CONSUMER tier, and neither may outrank
  //`locked`. §3.3: the composition path routes through mergeStyles instead of
  //concatenating and letting stylesheet source order decide. Text's own props go last,
  //so they win the per-property tie — Base UI's order, and the more local of the two.
  //
  //No `base`: a run of text has no default look to override. Size, colour, weight and
  //leading are className, all of them (VISION.md principle 2) — a `size` prop here
  //would be pure presentation wearing a prop's clothes.
  const merged = mergeStyles({
    className: [render?.props.className, className],
    //`selectable` is the EXISTING opt-in from styles/utils.css, deliberately not a
    //second mechanism: the reset is `user-select: none` stamped on <html> from
    //`ui.noSelect`, and the utility beats it on layer order alone (`utilities` is
    //later than `adaptv.reset`). It is `locked` because the consumer ASKED for it via
    //a prop — their own stray `select-none` in the same className must not cancel it.
    //
    //That guarantee is real rather than incidental: `selectable` is registered in
    //`utils/cn.ts` as `pwa-select-behavior`, conflicting with Tailwind's `select`
    //group. Before it was, `cn("select-none", "selectable")` emitted BOTH and the
    //compiled source order silently decided the winner — the same failure the
    //`scrollable-y` comment in that file documents.
    locked: selectable && "selectable",
    style: { ...render?.props.style, ...style },
    lockedStyle: textClampStyle(numberOfLines),
  })

  const slotProps: TextSlotProps = {
    ...props,
    className: merged.className,
    style: merged.style,
    "data-adaptv": "text",
    //`""`, not `true`: React stringifies a boolean data-* value to "true", and this is
    //a PRESENCE attribute (§3.1) — `[data-dynamic-type]` in text.css matches on
    //existence, so the opt-out has to remove it rather than set it to "false".
    "data-dynamic-type": dynamicType ? "" : undefined,
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
