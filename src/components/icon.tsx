import type {
  ComponentPropsWithRef,
  CSSProperties,
  ReactElement,
  ReactNode,
  Ref,
} from "react"
import {
  Children,
  cloneElement,
  isValidElement,
  useEffect,
  useRef,
} from "react"
import { useIsomorphicLayoutEffect } from "#adaptv/hooks/use-isomorphic-layout-effect"
import { useMergedRef } from "#adaptv/hooks/use-merged-ref"
import { mergeStyles } from "#adaptv/utils/styles"
import { measureDynamicTypeScale } from "#adaptv/utils/text-scale"
import { createWarnOnce } from "#adaptv/utils/warn-once"

const iconWarnings = createWarnOnce("Icon")

/**
 * The glyph {@link Icon} exposes and sizes — an `<svg>` element, usually from an icon
 * set: `render={<ArrowLeft />}`. → `docs/decisions/styling.md §3.3` (a prop, not
 * `asChild`).
 *
 * **Element-only, like {@link Text}'s.** Icon publishes no state to branch on, so the
 * function form would earn nothing. The element's own props, `className`, `style` and
 * `ref` all survive; the exposure attributes do not, because Icon owns them (below).
 */
export type IconRender = ReactElement<{
  className?: string
  style?: CSSProperties
  ref?: Ref<SVGSVGElement>
  children?: ReactNode
  tabIndex?: number
  role?: string
  "aria-label"?: string
  "aria-labelledby"?: string
  "aria-hidden"?: boolean | "true" | "false"
}>

/**
 * What {@link Icon} hands to the element passed to `render`. The `data-*` index
 * signature lets the identity attributes live in a plain object.
 */
export type IconSlotProps = ComponentPropsWithRef<"svg"> & {
  [attribute: `data-${string}`]: string | undefined
}

/**
 * Props for {@link Icon}. Native `<svg>` props pass through to the rendered element,
 * except the three exposure attributes and `children`: how an icon reaches assistive
 * technology is `label`, and what it draws is the element in `render`.
 */
export interface IconProps
  extends Omit<
    ComponentPropsWithRef<"svg">,
    "children" | "role" | "aria-label" | "aria-labelledby" | "aria-hidden"
  > {
  /** The `<svg>` to render — `render={<ArrowLeft />}`. There is no wrapper node. */
  render: IconRender
  /**
   * What the icon MEANS, for an icon that carries meaning on its own (a status glyph,
   * an icon-only affordance whose control has no other name). Present → `role="img"`
   * + `aria-label`. Absent (or blank) → `aria-hidden="true"`: the icon is decoration,
   * and the text beside it — or the control's own `aria-label` — is the name.
   *
   * ⚠︎ Inside a `<button>` that has no text, name the BUTTON (`aria-label` on it) and
   * leave the icon decorative — the pattern Scott O'Hara recommends over a named svg
   * inside the control, whose name some reader/browser pairings did not pass up.
   *
   * ⚠︎ A labelled svg with a `<title>` inside gets the title as a DESCRIPTION too
   * (Chromium: `role=image name="Sync failed" description="Alert triangle"`), so a
   * reader says both. Development reports it; drop the `<title>` or the label.
   */
  label?: string
  /**
   * Scale this icon with the iOS system text-size setting (Dynamic Type). **Opt-in,
   * default `false`** — it MULTIPLIES the icon's built width and height by the same
   * factor `<Text scaleWithSystem>` multiplies its font-size by
   * ({@link measureDynamicTypeScale}), so `size-6` stays `size-6 × factor`.
   *
   * Reach for it on an icon that sits BESIDE a scaled `Text` at a fixed size. An icon
   * INSIDE a scaled `Text` at the default `1em` already follows the text's font-size —
   * opting in there scales it twice.
   *
   * ⚠︎ The scaled size is written as fixed px, so a scaled icon — `1em` or not — stops
   * following font-size changes made after it was measured (a responsive text class, a
   * parent whose size changes). It re-measures when its own `className` or inline
   * width/height changes, or when the element passed to `render` changes type or key;
   * a component that swaps its svg internally under the same type is not re-measured.
   * `<Text scaleWithSystem>` has the same limit.
   *
   * iOS-WebKit only: the factor is `1` everywhere else (non-iOS engines, desktop
   * Safari, SSR), where the element keeps exactly its built size with no inline
   * sizing. WebKit resolves the setting at page load, so a change takes a reload.
   */
  scaleWithSystem?: boolean
}

/** A React inline length as the DOM spells it — React appends `px` to a bare number. */
function cssLength(value: CSSProperties["width"]): string {
  if (value === undefined || value === null) return ""
  return typeof value === "number" ? `${value}px` : String(value)
}

/**
 * An `<svg>` glyph, exposed to assistive technology correctly on every engine and
 * sized with the text around it. adaptv ships **no icon set** and depends on none:
 * bring your own (`lucide-react`, a hand-written `<svg>`, an SVGR import) and pass
 * the element to `render`.
 *
 * The bar a primitive has to clear is **two platform quirks it would own**
 * (`docs/research/component-surface.md §8.1`). `Icon` owns these two:
 *
 * | Quirk | Where it lives |
 * |-------|----------------|
 * | **Screen readers expose `<svg>` differently per engine**, and the two obvious attributes each fail somewhere | `label` → `role="img"` + `aria-label`; no label → `aria-hidden="true"` |
 * | **iOS Dynamic Type reaches an icon only by measurement** — a text-size setting grows a `<Text scaleWithSystem>` label, but a sibling `size-6` icon stays put | a `1em` default, plus the opt-in `scaleWithSystem` multiply |
 *
 * **Exposure, with the evidence.** A decorative icon is hidden with `aria-hidden`,
 * never `role="none"`/`"presentation"`: those remove the ROLE, not the node, and an
 * svg that carries a name is announced through them anyway — "all screen readers I
 * tested, except JAWS, announce the SVG regardless" (Manuel Matuzović, 2026-02-27,
 * VoiceOver on macOS 26.3 reading "Download, group", NVDA 2025.3 "graphic, download",
 * TalkBack on Android 16 among those tested:
 * https://www.matuzo.at/blog/2026/role-presentation-no-alternative-for-aria-hidden).
 * An svg with text or a `<title>` inside and no `aria-hidden` is read too
 * (https://www.matuzo.at/blog/2026/put-aria-hidden-on-presentational-svgs). A
 * meaningful icon gets `role="img"` WITH its name, "so that the SVG is not traversed by
 * browsers that map the SVG to the group role" (Heather Migliorisi, 2016) — the
 * `role="img"` + name pattern is the one Scott O'Hara found announced
 * as an image "in all tested screen reader and browser pairings"
 * (https://www.scottohara.me/blog/2019/05/22/contextual-images-svgs-and-a11y.html), and
 * Heather Migliorisi's tests found a bare svg "not always acknowledged" by VoiceOver
 * on macOS (https://css-tricks.com/accessible-svgs/). The common icon sets do not do
 * this for you: `lucide-react` 0.544.0 hides an unlabelled icon but never sets a role,
 * and `ion-icon` stamps `role="img"` even when it has no name.
 *
 * **Icon owns exposure, so the element's own `role`, `aria-label` and
 * `aria-labelledby` are dropped** (`aria-hidden` next to a name is a contradiction the
 * engines resolve differently; `aria-labelledby` would outrank `label`). In
 * development the drop is reported with `console.error`, once per message, rather
 * than done in silence (`docs/decisions/register.md` L7), and so are two combinations
 * that pass through
 * but expose the icon wrongly: a `tabIndex` of 0 or more on a decorative icon (Tab
 * lands on a hidden node, which Chromium then exposes as an unnamed image) and a
 * `<title>` child under a `label` (read as a description after the name).
 *
 * **Size is `1em` on both axes**, as `w-[1em] h-[1em]` rather than `size-[1em]`:
 * tailwind-merge lets a later `size-*` replace an earlier `w-*`/`h-*` but not the other
 * way round, so a `size-[1em]` base kept a consumer's `w-6` AND itself in the DOM and
 * left the winner to stylesheet order (§5.5). A consumer `size-6` still replaces both
 * axes. `shrink-0` keeps a flex row from squeezing the glyph. Both are `base`, and
 * nothing is `locked`: size is the consumer's to change. An icon set's own `size` prop
 * writes `width`/`height` ATTRIBUTES, which any CSS width beats — size an icon with
 * `className` (`size-6`) or with the font-size around it.
 *
 * **No mirroring prop.** `rtl:-scale-x-100` on `className` flips a directional glyph
 * under `dir="rtl"`; Tailwind 4.2.4 compiles `rtl:` to
 * `:where(:dir(rtl), [dir="rtl"], [dir="rtl"] *)`. Which glyphs are directional is the
 * icon set's knowledge, and adaptv ships no set.
 *
 * **No sprite `href`, deliberately.** An `<svg><use href="sprite.svg#id"/></svg>` path
 * would carry two quirks of its own that this component does not take on yet:
 *
 * - a `data:` URL in `<use href>` renders nothing — WebKit never supported it and
 *   Chromium removed it (https://developer.chrome.com/blog/migrate-way-from-data-urls-in-svg-use)
 *   — and Vite inlines an imported sprite under `build.assetsInlineLimit` (4 KB) as
 *   exactly such a URL in the production build only, so a sprite that works in
 *   `dev` is blank once deployed (vitejs/vite#15453);
 * - a sprite hidden with `display: none` drops its gradients in both engines
 *   (Chromium 41337331, WebKit 243341) — it has to be hidden with a zero-size box.
 *
 * | Attribute | When |
 * |-----------|------|
 * | `data-adaptv="icon"` | always — target every icon from global CSS with no imports |
 * | `data-scale-with-system` | `scaleWithSystem` (opt-in) — a marker only; the sizing is done in JS |
 *
 * @example
 * ```tsx
 * import { ArrowLeft, CircleAlert } from "lucide-react"
 *
 * // decorative: the text next to it is the name
 * <Text className="text-sm"><Icon render={<ArrowLeft />} /> Back</Text>
 *
 * // meaningful: nothing else says it
 * <Icon render={<CircleAlert />} label="Sync failed" className="size-5 text-error" />
 *
 * // an icon-only button: name the button, not the icon
 * <Button aria-label="Back"><Icon render={<ArrowLeft />} className="rtl:-scale-x-100" /></Button>
 * ```
 */
export function Icon({
  render,
  label,
  scaleWithSystem = false,
  className,
  style,
  ref,
  ...props
}: IconProps) {
  const own = render.props

  //The element passed to `render` carries its own className/style, written at the same
  //call site as Icon's — both are the CONSUMER tier, and Icon's own prop, the more
  //local of the two, wins the per-property tie (Text's order, §3.3).
  const merged = mergeStyles({
    base: "h-[1em] w-[1em] shrink-0",
    className: [own.className, className],
    //nothing structural: the size is the consumer's, and exposure is attributes, not
    //classes — so there is no class a consumer could strand. Explicit, so the omission
    //reads as a decision (styling.md §2).
    locked: undefined,
    style: { ...own.style, ...style },
  })

  //a blank label names nothing: it would be an image announced with no name
  const name = label?.trim() || undefined
  const named = name !== undefined

  //What the element brought that Icon is about to overrule. `aria-hidden` on its own
  //agrees with a decorative icon, so it only conflicts once a label says otherwise.
  const conflict =
    own.role !== undefined ||
    own["aria-label"] !== undefined ||
    own["aria-labelledby"] !== undefined ||
    (named && own["aria-hidden"] !== undefined)
  //Two that pass through untouched but expose the icon wrongly.
  const tabIndex = props.tabIndex ?? own.tabIndex
  const focusableWhileHidden =
    !named && tabIndex !== undefined && tabIndex >= 0
  const titleBesideLabel =
    named &&
    Children.toArray(own.children).some(
      (child) => isValidElement(child) && child.type === "title",
    )

  //Once per message for the page, not per icon: a list of a hundred misused icons logs
  //one line, not a hundred (or two hundred on a StrictMode mount).
  useEffect(() => {
    if (!import.meta.env.DEV) return
    if (conflict) {
      iconWarnings.warn(
        "exposure-conflict",
        "the element passed to render carries role, aria-label, " +
          "aria-labelledby or aria-hidden, and Icon owns those — they were dropped. " +
          'Name a meaningful icon with the label prop (<Icon label="…" />) and leave ' +
          "a decorative one unlabelled.",
      )
    }
    if (focusableWhileHidden) {
      iconWarnings.warn(
        "focusable-while-hidden",
        "a decorative icon (no label) has a tabIndex of 0 or more. " +
          "It is aria-hidden, so keyboard focus would land on a node screen readers " +
          "cannot see. Put the tabIndex on the control around it, or give the icon " +
          "a label.",
      )
    }
    if (titleBesideLabel) {
      iconWarnings.warn(
        "title-beside-label",
        "a labelled icon has a <title> inside its svg. Screen readers " +
          "announce the label as the name and the title as a description after it. " +
          "Remove the <title>, or drop the label and let the text beside the icon " +
          "name it.",
      )
    }
  }, [conflict, focusableWhileHidden, titleBesideLabel])

  //One callback for every ref that must see the node: the measurement, Icon's `ref`,
  //and the element's own, with React 19 callback-ref cleanups kept. Wired only when
  //Icon needs a ref at all, so a plain Icon leaves the element's own ref on it as it
  //came (cloneElement keeps the element's ref for a config with no `ref`, or with
  //`ref: undefined`).
  const measureRef = useRef<SVGSVGElement | null>(null)
  const setRef = useMergedRef(measureRef, ref, own.ref)

  const builtWidth = cssLength(merged.style?.width)
  const builtHeight = cssLength(merged.style?.height)
  //The inline size React has rendered MOST RECENTLY, assigned during render rather than
  //in an effect: an older run's cleanup reads it, and when one render both changes the
  //inline size and turns the opt-in off, that cleanup is the only thing that puts the
  //node back — it must see this render's size, not the one its own run closed over.
  //A render that never commits can leave it ahead of the DOM; the reset at the start of
  //the next run covers that.
  const built = useRef({ width: builtWidth, height: builtHeight })
  built.current = { width: builtWidth, height: builtHeight }

  //iOS Dynamic Type as a MULTIPLY of the built box, the way Text multiplies its
  //font-size: same measurement, same "factor 1 means no write at all". Before paint,
  //so there is no frame at the unscaled size.
  useIsomorphicLayoutEffect(() => {
    if (!scaleWithSystem) return
    const el = measureRef.current
    if (!el) return
    const scale = measureDynamicTypeScale()
    if (scale === 1) return

    //Start from the built size, whatever a previous run left. An engine stores a written
    //length ROUNDED ("32.94117647058823px" reads back "32.9412px" in Chromium,
    //"32.941176px" in WebKit), so nothing may read our own write back; and a Suspense
    //fallback or <Activity mode="hidden"> runs the cleanup below WITHOUT re-rendering
    //Icon, so it can restore a size from a render that never committed. This run,
    //reconnecting, is what puts the committed size back.
    el.style.width = builtWidth
    el.style.height = builtHeight
    const computed = getComputedStyle(el)
    const width = Number.parseFloat(computed.width)
    const height = Number.parseFloat(computed.height)
    //a detached node computes "" (NaN): leave the built size alone
    if (width > 0) el.style.width = `${width * scale}px`
    if (height > 0) el.style.height = `${height * scale}px`

    return () => {
      el.style.width = built.current.width
      el.style.height = built.current.height
    }
    //the built size is the className and the inline width/height, and a render element
    //of a new type or key is a new node that has never been scaled — re-measure on any
    //of them. A component that swaps its svg internally under the same type is not
    //re-measured.
  }, [
    scaleWithSystem,
    merged.className,
    builtWidth,
    builtHeight,
    render.type,
    render.key,
  ])

  const slotProps: IconSlotProps = {
    ...props,
    className: merged.className,
    style: merged.style,
    role: named ? "img" : undefined,
    "aria-label": name,
    "aria-labelledby": undefined,
    "aria-hidden": named ? undefined : "true",
    "data-adaptv": "icon",
    //a PRESENCE attribute (§3.1): "" when opted in, absent otherwise
    "data-scale-with-system": scaleWithSystem ? "" : undefined,
  }
  if (scaleWithSystem || ref !== undefined) slotProps.ref = setRef

  return cloneElement(render, slotProps)
}

Icon.displayName = "Icon"
