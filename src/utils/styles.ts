import type { ClassValue } from "clsx"
import type { CSSProperties } from "react"
import { cn } from "#adaptv/utils/cn"

export type StyleLayers = {
  /** Base / default look — the primitive's neutral styling. Overridable. */
  base?: ClassValue
  /** Consumer-provided classes — override `base`, never `locked`. */
  className?: ClassValue
  /**
   * Structural / cross-platform-correctness classes — win over BOTH `base` and the
   * consumer `className`. Applied last so tailwind-merge resolves conflicts in their
   * favour. (For behaviour the consumer must not touch AT ALL — e.g. scroll — prefer
   * a prop → data-attribute → CSS so there's no class to fight; `locked` covers the
   * soft-structural look. See VISION.md.)
   */
  locked?: ClassValue
}

export type InlineStyleLayers = {
  /** Base / default inline style — the same tier as {@link StyleLayers.base}. */
  baseStyle?: CSSProperties
  /** Consumer-provided inline style — overrides `baseStyle`, never `lockedStyle`. */
  style?: CSSProperties
  /** Structural inline style — wins over both, per property. */
  lockedStyle?: CSSProperties
}

/** What {@link mergeStyles} returns once any inline-style layer is in play. */
export type MergedStyles = {
  className: string
  /** `undefined` rather than `{}` when nothing was declared — don't hand React a new object per render. */
  style: CSSProperties | undefined
}

const INLINE_STYLE_KEYS = [
  "baseStyle",
  "style",
  "lockedStyle",
] as const satisfies readonly (keyof InlineStyleLayers)[]

function hasInlineStyleTier(layers: object): boolean {
  return INLINE_STYLE_KEYS.some((key) => key in layers)
}

/**
 * Compose a primitive's classes — and, when asked, its inline style — with correct
 * precedence:
 *
 * ```
 * base       <  className  <  locked
 * baseStyle  <  style      <  lockedStyle
 * ```
 *
 * The consumer can restyle the neutral defaults, but can't break the structural
 * styling the primitive owns. On the class tier precedence rides on tailwind-merge's
 * last-wins conflict resolution (including adaptv's custom `scrollable-*` / `clickable`
 * groups).
 *
 * ## Why the inline tier exists at all
 *
 * Inline `style` is its own cascade origin: it beats every author stylesheet, at any
 * specificity, in any cascade layer. So a primitive that forwards a consumer's `style`
 * straight to the node has already lost — `locked` classes included. Routing it through
 * here restores the same three tiers the class path has.
 *
 * ## The inline tier is the more reliable of the two, and that is worth knowing
 *
 * Object spread is exact last-wins **per property**, so there is nothing to keep in
 * step: `{ ...baseStyle, ...style, ...lockedStyle }` cannot silently stop resolving.
 * The class path can — a Tailwind `@utility` that expands to four properties conflicts
 * with nothing tailwind-merge has not been told about, which is exactly how
 * `cn("scrollable-y", "overflow-hidden")` once kept BOTH (see the conflict registry in
 * `cn.ts`). Every new `@utility` has to be registered there or `locked` quietly stops
 * being a guarantee for that property; `lockedStyle` has no such registry.
 *
 * ## Two honest limits
 *
 * 1. **This is not a security boundary.** A consumer holding a `ref` can always assign
 *    `el.style.color` after paint — exactly as they can always write an unlayered
 *    `!important` rule against the class tiers. The contract makes the *accidental*
 *    case impossible (a `style` prop passed in good faith cannot silently defeat a
 *    structural declaration), not the deliberate one.
 * 2. **It does not arbitrate against per-frame writes.** For properties a gesture
 *    engine writes directly to the node every frame (`transform` during a drag), a
 *    consumer's inline value loses to a RACE, not to this contract — whoever wrote
 *    last wins, and that is not a precedence anyone declared. The clean channel there
 *    is STYLING.md §3.2: the engine writes a custom property and a layer rule consumes
 *    it, which leaves the property itself free for the consumer.
 *
 * ## The signature, and why old call sites are untouched
 *
 * The return type is decided by which keys the CALLER passed: `string` when the call
 * is classes-only (every existing call site), `{ className, style }` the moment any
 * inline layer is named — including naming it as `undefined`, which is how a primitive
 * that always forwards `style` gets a stable shape. Same runtime rule (`in`), so the
 * type never disagrees with the value.
 *
 * @example
 * ```ts
 * mergeStyles({ base: "flex", className, locked: "clickable" })
 * // → "flex clickable"
 * mergeStyles({ base: "flex", className, locked: "clickable", style })
 * // → { className: "flex clickable", style }
 * ```
 */
export function mergeStyles<T extends StyleLayers & InlineStyleLayers>(
  layers: T,
): MergeStylesResult<T> {
  const className = cn(layers.base, layers.className, layers.locked)
  if (!hasInlineStyleTier(layers)) {
    return className as MergeStylesResult<T>
  }
  const style = {
    ...layers.baseStyle,
    ...layers.style,
    ...layers.lockedStyle,
  }
  return {
    className,
    style: Object.keys(style).length > 0 ? style : undefined,
  } as MergeStylesResult<T>
}

/**
 * `string` for a classes-only call, `{ className, style }` once any inline layer is
 * named. Wrapped in tuples so the check is "no inline keys at all" rather than a
 * conditional that distributes over the union of keys.
 */
type MergeStylesResult<T> = [
  Extract<keyof T, keyof InlineStyleLayers>,
] extends [never]
  ? string
  : MergedStyles
