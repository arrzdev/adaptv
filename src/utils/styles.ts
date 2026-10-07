import type { CSSProperties } from "react"

/**
 * What {@link joinClasses} accepts: a class string, a falsy value to skip (so
 * `on && "x"` reads naturally), or a nested list of either — the render element's
 * classes and the `className` prop arrive as a pair.
 */
export type ClassValue =
  | string
  | false
  | null
  | undefined
  | 0
  | ClassValue[]

/**
 * Join class lists in order, skipping falsy values. **No conflict resolution**: nothing
 * in a primitive's class attribute is adaptv's — the default look is a rule in
 * `@layer adaptv.components` and the locks are inline style — so there is nothing of
 * adaptv's for a consumer class to fight, and two conflicting *consumer* classes are the
 * consumer's tool's job (docs/decisions/styling.md §2, §3.3).
 */
export function joinClasses(...values: ClassValue[]): string {
  let out = ""
  for (const value of values) {
    if (!value) continue
    const part = Array.isArray(value)
      ? joinClasses(...value)
      : value.trim()
    if (part === "") continue
    out = out === "" ? part : `${out} ${part}`
  }
  return out
}

export type InlineStyleLayers = {
  /** Default inline style computed in JS (the LQIP's `background-image`). Overridable. */
  baseStyle?: CSSProperties
  /** Consumer-provided inline style — overrides `baseStyle`, never `lockedStyle`. */
  style?: CSSProperties
  /** Structural inline style — wins over both, per property. */
  lockedStyle?: CSSProperties
}

/**
 * The inline-style tier, merged per property (docs/decisions/styling.md §2.1):
 *
 * ```
 * baseStyle  <  style  <  lockedStyle
 * ```
 *
 * Inline `style` is its own cascade origin and beats every author stylesheet, at any
 * layer or specificity, which is why it carries `locked`. Object spread is exact
 * last-wins per property, so there is no conflict registry to keep in step.
 *
 * `undefined` rather than `{}` when nothing was declared — don't hand React a new
 * object per render.
 *
 * ## Two honest limits
 *
 * 1. **This is not a security boundary.** A consumer holding a `ref` can always assign
 *    `el.style.color` after paint — exactly as they can always write an unlayered
 *    `!important` rule. The contract makes the *accidental* case impossible (a `style`
 *    prop passed in good faith cannot silently defeat a structural declaration), not
 *    the deliberate one.
 * 2. **It does not arbitrate against per-frame writes.** For properties a gesture
 *    engine writes directly to the node every frame (`transform` during a drag), a
 *    consumer's inline value loses to a RACE, not to this contract. The clean channel
 *    there is docs/decisions/styling.md §3.2: the engine writes a custom property and a
 *    layer rule consumes it, which leaves the property itself free for the consumer.
 */
export function mergeInlineStyles(
  layers: InlineStyleLayers,
): CSSProperties | undefined {
  const style = {
    ...layers.baseStyle,
    ...layers.style,
    ...layers.lockedStyle,
  }
  return Object.keys(style).length > 0 ? style : undefined
}

export type StyleLayers = InlineStyleLayers & {
  /** Consumer classes — joined, never merged. */
  className?: ClassValue
}

/** What {@link composeStyles} returns once any inline-style layer is in play. */
export type ComposedStyles = {
  className: string
  style: CSSProperties | undefined
}

const INLINE_STYLE_KEYS = [
  "baseStyle",
  "style",
  "lockedStyle",
] as const satisfies readonly (keyof InlineStyleLayers)[]

/**
 * A primitive's `className` and `style` in one call: the classes joined
 * ({@link joinClasses}), the inline tiers merged ({@link mergeInlineStyles}).
 *
 * The return type is decided by which keys the CALLER passed: `string` for a
 * classes-only call, `{ className, style }` the moment any inline layer is named —
 * including naming it as `undefined`, which is how a primitive that always forwards
 * `style` gets a stable shape. Same runtime rule (`in`), so the type never disagrees
 * with the value.
 *
 * Internal. `./utils` exports no merge helper: an app that wants its own Tailwind
 * classes merged brings `tailwind-merge` (docs/decisions/styling.md §0.1, §8).
 */
export function composeStyles<T extends StyleLayers>(
  layers: T,
): ComposeStylesResult<T> {
  const className = joinClasses(layers.className)
  if (!INLINE_STYLE_KEYS.some((key) => key in layers)) {
    return className as ComposeStylesResult<T>
  }
  return {
    className,
    style: mergeInlineStyles(layers),
  } as ComposeStylesResult<T>
}

/**
 * `string` for a classes-only call, `{ className, style }` once any inline layer is
 * named. Wrapped in tuples so the check is "no inline keys at all" rather than a
 * conditional that distributes over the union of keys.
 */
type ComposeStylesResult<T> = [
  Extract<keyof T, keyof InlineStyleLayers>,
] extends [never]
  ? string
  : ComposedStyles
