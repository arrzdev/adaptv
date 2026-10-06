import type {
  ComponentProps,
  CSSProperties,
  HTMLAttributes,
  ReactElement,
  ReactNode,
} from "react"
import { cloneElement } from "react"
import { usePressCore } from "#adaptv/components/press-core"
import type {
  GestureEvent,
  OmitGestureEngineHandlers,
} from "#adaptv/hooks/use-gesture-engine"
import { mergeStyles } from "#adaptv/utils/styles"

/**
 * The props {@link Pressable} hands to a `render` function — spread them onto whatever
 * element you return, or the press engine is not wired to anything.
 *
 * Typed against `HTMLElement` (not `HTMLDivElement`) precisely so `<button {...props}>`,
 * `<a {...props}>` and `<li {...props}>` all typecheck, which is the point of `render`.
 *
 * It declares no `ref`, for the same reason: a `Ref<HTMLElement>` is NOT assignable to
 * a `Ref<HTMLButtonElement>`, so declaring one would make the spread an error on every
 * element narrower than `HTMLElement`. Nothing is lost — the engine holds no ref of its
 * own (it reads `e.currentTarget`), and a `ref` the consumer passes to `<Pressable>`
 * still rides through in the forwarded props.
 */
export type PressableSlotProps = HTMLAttributes<HTMLElement> & {
  [attribute: `data-${string}`]: string | undefined
}

/**
 * State a `render` function can branch on.
 *
 * **`pressed` is deliberately absent.** The engine writes `data-pressed` straight to
 * the DOM with `setAttribute`, so press feedback costs zero React re-renders — putting
 * it in this object would mean a state update on every touch-down and touch-up, on the
 * one path that must never jank. Style it instead: `active:scale-95` — adaptv points
 * that variant at `[data-pressed]` on any gesture-engine element — or the bare
 * `data-pressed:` variant Tailwind v4 generates.
 */
export type PressableState = {
  disabled: boolean
}

export type PressableRender =
  | ReactElement<{
      className?: string
      style?: CSSProperties
      children?: ReactNode
    }>
  | ((props: PressableSlotProps, state: PressableState) => ReactNode)

/**
 * Native `<div>` props except the gesture handlers (the engine owns activation — see
 * {@link PressableProps.onPress}).
 */
export type PressableProps = OmitGestureEngineHandlers<
  ComponentProps<"div">
> & {
  /**
   * Fired on release inside the press region, and on Enter/Space when the target is
   * focusable. **Not `onClick`**: the engine swallows the browser's trailing click, so
   * a handler on that prop would silently never fire — which is why the type refuses it.
   */
  onPress?: (e: GestureEvent) => void
  /** Pointer/keyboard went down (the moment of contact), before any activation. */
  onPressDown?: (e: GestureEvent) => void
  /** Drop every gesture. Emits `data-disabled` + `aria-disabled` and locks the disabled interaction style inline. */
  disabled?: boolean
  /**
   * Margin (px) around the frame within which the press stays armed — larger forgives
   * more finger drift on small targets. Defaults to the engine's pointer-adaptive budget.
   */
  pressOutset?: number
  /**
   * Render something other than a `<div>` — an element to clone, or a function
   * `(props, state) => node`. → `docs/decisions/styling.md §3.3` (a prop, not `asChild`).
   */
  render?: PressableRender
}

/**
 * The `data-part` a node already carries — a consumer's prop or the `render` element's
 * own — which Pressable keeps rather than stamping its `root` over it.
 */
function ownDataPart(source: object | undefined): string | undefined {
  const part = (source as { "data-part"?: unknown } | undefined)?.[
    "data-part"
  ]
  return typeof part === "string" ? part : undefined
}

/**
 * Any element, with adaptv's press engine on it.
 *
 * The engine was always available as `useGestureEngine({})` + spreading the handler
 * bag, but nobody would guess that. This is the same mechanics as {@link Button}'s
 * press track, minus the `<button>` semantics, the haptics and the slots — so reach for
 * it when the thing you are making press is a card, a row, or a tile rather than a
 * control.
 *
 * **Press state is a DOM attribute, not React state**: the engine sets `data-pressed`
 * while the pointer is down inside the press region and clears it the moment the finger
 * drags out (reentrant — it comes back when the finger slides in again), all with
 * `setAttribute` and zero re-renders. It is pointer-only, so keyboard activation never
 * animates.
 *
 * | Attribute | When |
 * |-----------|------|
 * | `data-adaptv="pressable"` | always — target it from global CSS with no imports |
 * | `data-part="root"` | always, unless the node already carries a `data-part` |
 * | `data-pressed` | pointer down within the press region |
 * | `data-disabled` | `disabled` |
 *
 * ⚠︎ **Pressable adds mechanics, not semantics.** A `<div>` that reacts to a tap is not
 * a button: it is not focusable, screen readers do not announce it, and Enter/Space
 * never reach it. If the thing is a control, use {@link Button} — or pass the semantics
 * yourself (`render={<button type="button" />}`, or `role` + `tabIndex`).
 *
 * @example
 * ```tsx
 * <Pressable className="rounded-xl bg-surface p-4 active:scale-95" onPress={open}>
 *   <Card />
 * </Pressable>
 *
 * // render something else, keeping the press engine
 * <Pressable render={<li className="flex" />} onPress={select}>{label}</Pressable>
 *
 * // …or decide the content from state
 * <Pressable render={(props, state) => <a {...props} aria-hidden={state.disabled} />} />
 * ```
 */
export function Pressable({
  render,
  className,
  style,
  children,
  disabled = false,
  onPress,
  onPressDown,
  pressOutset,
  ...props
}: PressableProps) {
  const { handlers, lockedStyle } = usePressCore({
    disabled,
    pressOutset,
    onPressDown,
    onPress,
  })

  //An element passed to `render` carries its own className/style, written at the same
  //call site as Pressable's own — so both are the CONSUMER tier, and neither may
  //outrank the lock. §3.3: the composition path joins the classes (render element
  //first) and merges the styles per property, Pressable's own props last so they win
  //the per-property tie — Base UI's order, and the more local of the two.
  //Pressable emits no class of its own and has no default rule: it adds mechanics,
  //not a look, so `className` is the consumer's alone.
  const slot = typeof render === "function" ? null : render
  const merged = mergeStyles({
    className: [slot?.props.className, className],
    style: { ...slot?.props.style, ...style },
    //structural, not styling — the press core's inline `touch-action` longhand
    //(`PRESS_TARGET_LOCKED_STYLE`, plus `user-select: none` when disabled) is what the
    //engine needs, and inline style is the one tier a consumer `touch-none` class or
    //`style={{ touchAction }}` cannot land on top of (docs/decisions/styling.md §2.0).
    lockedStyle,
  })

  const slotProps: PressableSlotProps = {
    ...props,
    ...handlers,
    //no consumer class, no attribute: an empty `class=""` is still a class adaptv wrote
    className: merged.className || undefined,
    style: merged.style,
    "data-adaptv": "pressable",
    //a `data-part` already on the node (a row rendering as a Pressable) is kept
    "data-part": ownDataPart(props) ?? ownDataPart(slot?.props) ?? "root",
    //`""`, not `true`: React stringifies a boolean data-* value to "true", and this
    //is a PRESENCE attribute (§3.1) — the same shape the engine writes data-pressed in
    "data-disabled": disabled ? "" : undefined,
    "aria-disabled": disabled || undefined,
  }

  if (typeof render === "function") {
    return render(slotProps, { disabled })
  }

  if (slot) {
    //`children` is passed as cloneElement's THIRD argument, never inside the config:
    //a `children: undefined` key is not "no opinion" to cloneElement, it overwrites
    //the element's own children with nothing.
    return children === undefined
      ? cloneElement(slot, slotProps)
      : cloneElement(slot, slotProps, children)
  }

  //`PressableSlotProps` is typed against `HTMLElement` so one object can be spread onto
  //whatever `render` returns; the default host is the narrower `<div>`, hence the cast.
  return <div {...(slotProps as ComponentProps<"div">)}>{children}</div>
}

Pressable.displayName = "Pressable"
