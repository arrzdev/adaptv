import type {
  CSSProperties,
  HTMLAttributes,
  ImgHTMLAttributes,
  ReactNode,
  Ref,
  SyntheticEvent,
} from "react"
import {
  createContext,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
} from "react"
import { useReducedMotion } from "#adaptv/hooks/use-reduced-motion"
import { mergeStyles } from "#adaptv/utils/styles"

/**
 * What a statically-imported image resolves to.
 *
 * ```ts
 * import hero from "./hero.jpg?adaptv-image"
 * ```
 *
 * `width` and `height` are the product, not the blur — they are the entire CLS
 * mechanism, and `lqip` is decoration on top of it. → `docs/design/image.md` §1.
 * Produced by `adaptvImagePlugin()` (`src/vite/adaptv-image.ts`); the shape is
 * mirrored in `src/virtual-adaptv-image-asset.d.ts` for the ambient module
 * declaration, so the two must be changed together.
 */
export type AdaptvImageAsset = {
  /** The emitted asset URL — hashed and base-prefixed by Vite. */
  src: string
  /** Intrinsic width in CSS pixels, EXIF orientation already applied. */
  width: number
  /** Intrinsic height in CSS pixels, EXIF orientation already applied. */
  height: number
  /**
   * A 16 px WebP `data:` URL with the blur baked in. Absent for vectors,
   * animations and sources already smaller than the placeholder would be.
   */
  lqip?: string
}

/** Mirrors CSS `object-fit` verbatim — there is DOM underneath, so the names match. */
export type ImageFit = "cover" | "contain" | "fill" | "none" | "scale-down"

/** A CSS `aspect-ratio`: `1.7778`, or the `"16 / 9"` longhand. */
export type ImageAspectRatio = number | `${number} / ${number}`

/**
 * Reactive load/overlay state from {@link useImage} for Tier 2 slot paint.
 *
 * Branch with `isPlaceholderVisible`, `isErrorVisible`, etc. — not descendant
 * selectors on the `<img>`.
 */
export type ImageContextValue = {
  isLoading: boolean
  isImageVisible: boolean
  isPlaceholderVisible: boolean
  isInvalidVisible: boolean
  isErrorVisible: boolean
}

/**
 * The four ways an `<Image>` can reserve its box — and the reason
 * `<Image src={url} />` does not compile.
 *
 * The un-reservable call is a TYPE error rather than a dev-time throw, because
 * `VISION.md` principle 1 is that the wrong thing becomes impossible, and a
 * compile error is the only guardrail that cannot be scrolled past. The dev
 * guardrails below are a backstop for the callers who escape the types, not the
 * mechanism — see the block that defines them for which callers those are.
 *
 * | Written as | Reserves from |
 * |---|---|
 * | `<Image src={asset} />` | the build-supplied `width`/`height` |
 * | `<Image src={url} width={640} height={400} />` | the pair |
 * | `<Image src={url} aspectRatio={16 / 9} />` | the ratio — the remote-image case |
 * | `<Image src={url} fill />` | a positioned, sized parent |
 *
 * `src` may be `null`/`undefined` in the three string forms: an image whose URL
 * has not arrived still has a box, which is the whole point. It may not be
 * omitted in a form that reserves nothing.
 */
type ImageSizing =
  | {
      src: AdaptvImageAsset
      width?: number
      height?: number
      aspectRatio?: ImageAspectRatio
      fill?: boolean
    }
  | {
      src?: string | null
      width: number
      height: number
      aspectRatio?: ImageAspectRatio
      fill?: boolean
    }
  | {
      src?: string | null
      width?: number
      height?: number
      aspectRatio: ImageAspectRatio
      fill?: boolean
    }
  | {
      src?: string | null
      width?: number
      height?: number
      aspectRatio?: ImageAspectRatio
      fill: true
    }

type ImageOwnProps = Omit<
  ImgHTMLAttributes<HTMLImageElement>,
  | "src"
  | "width"
  | "height"
  | "loading"
  | "placeholder"
  | "children"
  | "ref"
> & {
  /** Forwarded to the `<img>`, not to the root. `null` while the image is unmounted. */
  ref?: Ref<HTMLImageElement>
  /** Empty string (decorative) by default, matching the previous behaviour. */
  alt?: string
  /**
   * CSS `object-fit`, mirrored onto the placeholder's `background-size`. A prop
   * rather than a `className` because those two must agree — see the note on
   * {@link Image}.
   */
  fit?: ImageFit
  /** CSS `object-position`, mirrored onto the placeholder's `background-position`. */
  position?: string
  /**
   * A `data:image/*` URL to paint under the image while it loads, or `false` to
   * paint nothing. Defaults to the `lqip` a static import carries.
   *
   * A BlurHash or ThumbHash string is rejected in dev: both need a JS decoder
   * that cannot paint before hydration, so they are database formats rather
   * than web placeholders. → `docs/design/image.md` §3.
   */
  placeholder?: string | false
  /** LCP intent: `loading="eager"` + `fetchpriority="high"`. */
  priority?: boolean
  /** Escape hatch under `priority`. Lazy is safe from iOS 15.4. */
  loading?: "lazy" | "eager"
  children?: ReactNode
}

/** @see {@link Image} */
export type ImageProps = ImageOwnProps & ImageSizing

/** Everything `ImageSizing` makes conditional, flattened for the implementation. */
type ImageResolvedProps = ImageOwnProps & {
  src?: string | AdaptvImageAsset | null
  width?: number
  height?: number
  aspectRatio?: ImageAspectRatio
  fill?: boolean
}

/** Props for `Image.Placeholder`. */
export interface ImagePlaceholderProps
  extends HTMLAttributes<HTMLDivElement> {
  children?: ReactNode
}

/** Props for `Image.Error`. */
export interface ImageErrorProps extends HTMLAttributes<HTMLDivElement> {
  children?: ReactNode
}

/** Props for `Image.Invalid`. */
export interface ImageInvalidProps extends HTMLAttributes<HTMLDivElement> {
  children?: ReactNode
}

//LOCKED: the root is the in-flow reserved box. `relative` is what makes every
//layer below it a card in one stack, and `isolate` is what keeps that stack out
//of the consumer's — without it the z-0/z-10/z-20 below participate in the
//nearest ancestor stacking context and can interleave with their own layers.
//`overflow-hidden` rather than `overflow: clip`, which is the better tool (no
//scroll container, no scrollport) but is Safari 16 — not a baseline while adaptv
//supports iOS 15. Revisit with contain-intrinsic-size at the same floor.
const IMAGE_ROOT_LOCKED_LAYOUT_CLASS = "relative isolate overflow-hidden"
//`fill` swaps the reservation for the parent's: the root stops being in-flow and
//stretches to a box somebody else owns. Same stack, no ratio.
const IMAGE_ROOT_FILL_LOCKED_LAYOUT_CLASS =
  "absolute inset-0 isolate size-full overflow-hidden"
const IMAGE_ROOT_BASE_LAYOUT_CLASS = "block w-full"
const IMAGE_SURFACE_CLASS = "bg-gray-50"

//LOCKED: a slot layer is one card in a stack over the same box as the `<img>`.
//`absolute inset-0` is what makes it that card rather than a sibling block, and the
//z-index is WHICH card — a placeholder that outranks the loaded image never goes
//away. `rounded-[inherit]` keeps the stack clipped to the root's own radius.
const IMAGE_SLOT_LAYER_LOCKED_LAYOUT_CLASS =
  "absolute inset-0 box-border size-full rounded-[inherit]"
const IMAGE_SLOT_LAYER_BASE_LAYOUT_CLASS = "overflow-hidden"
const IMAGE_LQIP_LAYER_CLASS = "z-0"
const IMAGE_SLOT_LAYER_UNDER_CLASS = "z-[1]"
const IMAGE_SLOT_LAYER_OVER_CLASS = "z-20"
const IMAGE_SLOT_LAYER_VISIBLE_CLASS = "opacity-100"
const IMAGE_SLOT_LAYER_HIDDEN_CLASS = "invisible"
const IMAGE_SLOT_LAYER_TRANSITION_CLASS =
  "transition-opacity duration-300 ease-out"
const IMAGE_IMG_LOCKED_LAYOUT_CLASS =
  "absolute inset-0 z-10 block size-full max-h-none max-w-none text-[0px] leading-0"
const IMAGE_IMG_TRANSITION_CLASS =
  "select-none transition-opacity duration-300 ease-out"
const IMAGE_IMG_VISIBLE_CLASS = "opacity-100"
const IMAGE_IMG_HIDDEN_CLASS = "-z-10 opacity-0"

/**
 * `object-fit` → `background-size`, so the LQIP occupies exactly the box the photo
 * will. Get this wrong and the blur→image swap is itself a visible jump, which is
 * the failure the whole component exists to prevent.
 *
 * `scale-down` maps to `contain` deliberately: it means `min(contain, none)`, and
 * a 16 px placeholder upscaled to a real box is always in the `contain` branch.
 */
const IMAGE_BACKGROUND_SIZE: Record<ImageFit, string> = {
  cover: "cover",
  contain: "contain",
  fill: "100% 100%",
  none: "auto",
  "scale-down": "contain",
}

/**
 * The three facts the runtime can actually establish about a `src`.
 *
 * There is deliberately no "does this string look fetchable" heuristic. The one
 * this replaced matched `not.a.url` and `README.md` and rejected a legitimate
 * `?query`-only relative reference — a guess that is wrong in both directions,
 * and being wrong towards `invalid` means a working URL is never attempted.
 * Everything that is not one of these two facts goes to the network, and a
 * failure lands in `error`. → `docs/design/image.md` §6.3.
 */
export function classifyImageSrc(src: string | undefined): {
  trimmed: string
  invalid: boolean
} {
  const trimmed = src?.trim() ?? ""
  const missing = trimmed.length === 0
  const badDataUrl =
    trimmed.startsWith("data:") && !trimmed.startsWith("data:image/")
  return { trimmed, invalid: missing || badDataUrl }
}

const ImageContext = createContext<ImageContextValue | null>(null)

/**
 * Reactive load and overlay visibility for {@link Image} compound trees.
 * Use in Tier 2 slot wrappers when chrome must track live load state.
 */
export function useImage(): ImageContextValue {
  const ctx = useContext(ImageContext)
  if (!ctx) {
    throw new Error("useImage must be used within <Image>.")
  }
  return ctx
}

function useImageSlotContext(): ImageContextValue {
  const ctx = useContext(ImageContext)
  if (!ctx) {
    throw new Error("Image composition slots must be used within <Image>.")
  }
  return ctx
}

function imageSlotHasContent(children: ReactNode): boolean {
  if (children == null || children === false) return false
  if (typeof children === "string") return children.trim().length > 0
  if (Array.isArray(children)) {
    return children.some((child) => imageSlotHasContent(child))
  }
  return true
}

/* =============================================================================
 * DEV GUARDRAILS
 *
 * Backstops, not mechanisms. `ImageSizing` already makes the unreserved call a
 * compile error; these catch the callers who got past the types — plain JS, an
 * `as string`, a spread props object — plus the one failure no type can see
 * (`fill` needs a parent adaptv cannot inspect at compile time).
 * ============================================================================= */

const warned = new Set<string>()

function warnOnce(key: string, message: string): void {
  if (warned.has(key)) return
  warned.add(key)
  console.error(`[adaptv] Image: ${message}`)
}

//Test seam, NOT consumer API — the dev warnings are once-per-message for the life
//of the module, and the suite needs them re-armable between cases. It carries the
//`unstable_` prefix because the barrels are `export *`: making image's barrel entry
//an explicit name list to hide one function would leave it the only primitive whose
//new exports must be wired by hand, which is a worse footgun than a visible seam.
export function unstable_resetImageWarnings(): void {
  warned.clear()
}

type ImageSlotLayerProps = HTMLAttributes<HTMLDivElement> & {
  visible: boolean
  stack: "under-image" | "over-image"
  /** `Image.Placeholder` is chrome over the LQIP, so it never gets a surface of its own. */
  surface: boolean
  decorative?: boolean
  part: "placeholder" | "invalid" | "error"
  children?: ReactNode
}

function ImageSlotLayer({
  visible,
  stack,
  surface,
  part,
  decorative = false,
  className,
  style,
  children,
  ...props
}: ImageSlotLayerProps) {
  const reducedMotion = useReducedMotion()

  return (
    <div
      {...props}
      data-part={part}
      aria-hidden={decorative ? true : visible ? undefined : true}
      //Only the HIDDEN half of the load state is locked, and the asymmetry is the
      //point: `visible` is derived from the `<img>`'s own load/error events, so a
      //consumer who could defeat `invisible` would leave a placeholder painted over
      //a successfully loaded photo — branch with `useImage()` instead. Fading a
      //layer that is legitimately showing (`opacity-70` on a scrim) is an ordinary
      //restyle, so the visible half stays base along with the transition.
      {...mergeStyles({
        base: [
          IMAGE_SLOT_LAYER_BASE_LAYOUT_CLASS,
          surface && IMAGE_SURFACE_CLASS,
          visible && IMAGE_SLOT_LAYER_VISIBLE_CLASS,
          visible && !reducedMotion && IMAGE_SLOT_LAYER_TRANSITION_CLASS,
        ],
        className,
        locked: [
          IMAGE_SLOT_LAYER_LOCKED_LAYOUT_CLASS,
          stack === "under-image"
            ? IMAGE_SLOT_LAYER_UNDER_CLASS
            : IMAGE_SLOT_LAYER_OVER_CLASS,
          !visible && IMAGE_SLOT_LAYER_HIDDEN_CLASS,
        ],
        style,
        //nothing about a slot layer is structural in INLINE style — the stack is
        //classes, and the one derived inline value (the LQIP's background-size)
        //belongs to the LQIP layer, which is not this. Named so it reads as a
        //decision.
        lockedStyle: undefined,
      })}
    >
      {children}
    </div>
  )
}

/**
 * adaptv's own layer, under everything, holding the build-time (or caller-supplied)
 * `data:` URL. Separate from `Image.Placeholder` because they answer different
 * questions: this one is the picture, the slot is the chrome a consumer puts over
 * it. Both are optional and neither is required for the box to be reserved.
 *
 * It is `data-part="lqip"`, NOT a second `data-part="placeholder"`. Two elements
 * sharing one (scope, part) coordinate is the Radix #602 failure in miniature —
 * `[data-adaptv="image"] [data-part="placeholder"]` would reach both, and a
 * consumer could not address the slot without also hitting the blur underneath it.
 * → docs/decisions/styling.md §3 / §3.1.
 *
 * ⚠︎ The blur is baked into the WebP at build time, so there is no runtime
 * `filter: blur()` here. A filter promotes the element and makes it a containing
 * block for every `fixed`/`absolute` descendant — one per on-screen image is not
 * free on a 4 GB Android. → `docs/design/performance-boost.md` §4.1.
 */
function ImageLqipLayer({
  url,
  visible,
  fit,
  position,
}: {
  url: string
  visible: boolean
  fit: ImageFit
  position: string
}) {
  const reducedMotion = useReducedMotion()

  return (
    <div
      aria-hidden
      data-part="lqip"
      {...mergeStyles({
        base: [
          IMAGE_SLOT_LAYER_BASE_LAYOUT_CLASS,
          IMAGE_SURFACE_CLASS,
          visible && IMAGE_SLOT_LAYER_VISIBLE_CLASS,
          visible && !reducedMotion && IMAGE_SLOT_LAYER_TRANSITION_CLASS,
        ],
        locked: [
          IMAGE_SLOT_LAYER_LOCKED_LAYOUT_CLASS,
          IMAGE_LQIP_LAYER_CLASS,
          !visible && IMAGE_SLOT_LAYER_HIDDEN_CLASS,
        ],
        baseStyle: {
          backgroundImage: `url(${JSON.stringify(url)})`,
          backgroundRepeat: "no-repeat",
        },
        //LOCKED for the same reason `fit` is a prop at all: these two declarations
        //are the placeholder's half of a pair, and the `<img>` holds the other. If
        //either side could drift the blur→image swap jumps.
        lockedStyle: imageFitStyle(fit, position, true),
      })}
    />
  )
}

/**
 * The one pair of declarations that must be identical on two elements.
 *
 * `background` for the placeholder layer, `object` for the `<img>` — same fit,
 * same position, one source of truth.
 */
function imageFitStyle(
  fit: ImageFit,
  position: string,
  asBackground: boolean,
): CSSProperties {
  return asBackground
    ? {
        backgroundSize: IMAGE_BACKGROUND_SIZE[fit],
        backgroundPosition: position,
      }
    : { objectFit: fit, objectPosition: position }
}

function ImageError({ children, ...props }: ImageErrorProps) {
  const { isErrorVisible } = useImageSlotContext()
  if (children !== undefined && !imageSlotHasContent(children)) return null

  return (
    <ImageSlotLayer
      {...props}
      part="error"
      visible={isErrorVisible}
      stack="over-image"
      surface
    >
      {children}
    </ImageSlotLayer>
  )
}

ImageError.displayName = "Image.Error"

function ImageInvalid({ children, ...props }: ImageInvalidProps) {
  const { isInvalidVisible } = useImageSlotContext()
  if (children !== undefined && !imageSlotHasContent(children)) return null

  return (
    <ImageSlotLayer
      {...props}
      part="invalid"
      visible={isInvalidVisible}
      stack="over-image"
      surface
    >
      {children}
    </ImageSlotLayer>
  )
}

ImageInvalid.displayName = "Image.Invalid"

function ImagePlaceholder({ children, ...props }: ImagePlaceholderProps) {
  const { isPlaceholderVisible } = useImageSlotContext()
  if (children !== undefined && !imageSlotHasContent(children)) return null

  return (
    <ImageSlotLayer
      {...props}
      part="placeholder"
      visible={isPlaceholderVisible}
      stack="under-image"
      //transparent by default so the LQIP underneath still shows through — this
      //slot is for a shimmer, a logo or a spinner ON the placeholder, not instead
      //of it. `className="bg-…"` if you want it opaque.
      surface={false}
      decorative
    >
      {children}
    </ImageSlotLayer>
  )
}

ImagePlaceholder.displayName = "Image.Placeholder"

/**
 * An `<img>` that reserves its box before the bytes arrive.
 *
 * Layout shift is `VISION.md` §2.1's named enemy and this is where it is fought,
 * so the reservation is not a feature of the component — it is the precondition
 * for constructing one. `ImageSizing` admits exactly four calls, and
 * `<Image src={url} />` is not one of them: it does not compile.
 *
 * ```tsx
 * import hero from "./hero.jpg?adaptv-image"
 *
 * <Image src={hero} alt="Hero" />                       // reserved, blurred, lazy
 * <Image src={user.avatar} aspectRatio={1} alt="" />    // the remote case
 * <Image src={url} width={640} height={400} alt="…">
 *   <Image.Placeholder><Shimmer /></Image.Placeholder>
 *   <Image.Error>Could not load</Image.Error>
 * </Image>
 * ```
 *
 * | Attribute | When |
 * |-----------|------|
 * | `data-adaptv="image"`, `data-part="…"` | always |
 * | `data-image-loading` | a `src` exists and has neither loaded nor errored |
 * | `data-image-loaded` | the image is showing |
 * | `data-image-error` | the load failed |
 * | `data-image-invalid` | no `src`, or a non-image `data:` URL |
 * | `data-image-unreserved` | the backstop fired — greppable in the DOM, assertable in E2E |
 *
 * ## Three things that are decisions rather than oversights
 *
 * **`className` and `style` land on the ROOT, not the `<img>`.** The root is the
 * in-flow box now, so a `rounded-xl` or an `h-48` has to reach it to mean
 * anything; the `<img>` is absolutely positioned inside and owns nothing a
 * consumer would want to restyle. `fit` / `position` are how you change how the
 * photo sits in the box.
 *
 * **`fit` and `position` are props, and they are `lockedStyle` on both layers.**
 * The placeholder's `background-size`/`background-position` must agree with the
 * `<img>`'s `object-fit`/`object-position`, or the blur→image swap visibly jumps —
 * and adaptv cannot read a class name off the `<img>` to keep the other side in
 * step. Same argument `Checkbox.Box` makes for its derived box size: a value two
 * elements are derived from is broken by a partial override, not restyled by one.
 * With the default `cover`, a *wrong* `aspectRatio` crops instead of distorting,
 * which is a real protection for anyone who had to guess a remote ratio.
 *
 * **No `decoding` attribute is emitted.** WebKit honours `decoding="async"` only
 * for animated images — `RenderBoxModelObject::decodingModeForImageDraw` falls
 * through to the default policy for everything else, which is Synchronous for a
 * static on-screen image. Emitting it would be a mitigation that shows up in
 * DevTools and does nothing on the platform adaptv cares most about. Pass
 * `decoding` yourself if you have measured something adaptv has not.
 *
 * ⚠︎ **`fill` is the one form with a runtime failure mode.** It reserves nothing
 * itself — it stretches to a parent that must be positioned and sized, which no
 * type can check. Dev checks the positioning half; the sizing half is on you.
 *
 * ⚠︎ **The `<img>`'s `src` is only ever the final URL.** adaptv never renders a
 * placeholder into `src` and swaps it later, and that is why the placeholder is a
 * separate layer: with `loading="lazy"`, a `src` that starts as a data URI and is
 * replaced keeps the old URL in `ImageLoader::updateFromElement()` and **never
 * loads** (WebKit 237703, fixed 2022-09-14 — live on any iOS 15.4–16.0 device).
 */
function ImageRoot(props: ImageProps) {
  const {
    src,
    width,
    height,
    aspectRatio,
    fill = false,
    alt = "",
    fit = "cover",
    position = "center",
    placeholder,
    priority = false,
    loading,
    className,
    style,
    children,
    onLoad,
    onError,
    ref,
    ...rest
  } = props as ImageResolvedProps

  const rootRef = useRef<HTMLDivElement>(null)
  const imgRef = useRef<HTMLImageElement>(null)
  const reducedMotion = useReducedMotion()

  const asset = typeof src === "object" && src !== null ? src : null
  const { trimmed, invalid } = classifyImageSrc(
    asset ? asset.src : typeof src === "string" ? src : undefined,
  )
  const intrinsicWidth = width ?? asset?.width
  const intrinsicHeight = height ?? asset?.height

  //`aspectRatio` wins over the pair when both are given: it is the prop that
  //exists for the case the pair cannot serve, so a caller who wrote it meant it.
  const ratio =
    aspectRatio != null
      ? String(aspectRatio)
      : intrinsicWidth != null &&
          intrinsicHeight != null &&
          intrinsicWidth > 0 &&
          intrinsicHeight > 0
        ? `${intrinsicWidth} / ${intrinsicHeight}`
        : undefined
  const reserved = fill || ratio != null

  const [prevSrc, setPrevSrc] = useState(trimmed)
  const [loaded, setLoaded] = useState(false)
  const [errored, setErrored] = useState(false)

  //Derived during render, NOT in a layout effect. An effect is one frame late:
  //React commits the new `src` onto the `<img>` while `loaded` is still true from
  //the previous image, so for one paint the component claims the NEW image is
  //loaded and the placeholder is already gone. → the "adjusting state when props
  //change" pattern; React discards this render pass and re-runs immediately.
  if (prevSrc !== trimmed) {
    setPrevSrc(trimmed)
    setLoaded(false)
    setErrored(false)
  }

  const state = invalid
    ? "invalid"
    : errored
      ? "error"
      : loaded
        ? "loaded"
        : "loading"

  const isPlaceholderVisible = state === "loading"
  const isImageVisible = state === "loaded"
  const isInvalidVisible = state === "invalid"
  const isErrorVisible = state === "error"

  const placeholderUrl =
    placeholder === false
      ? undefined
      : typeof placeholder === "string"
        ? placeholder
        : asset?.lqip

  if (import.meta.env.DEV) {
    if (!reserved) {
      warnOnce(
        "unreserved",
        `an <Image> reserved no box, so it will shift when the image decodes. ` +
          `Give it one of: a "?adaptv-image" static import, width + height, ` +
          `aspectRatio, or fill (inside a positioned, sized parent). ` +
          `The root carries data-image-unreserved so it is greppable in the DOM.`,
      )
    }
    if (
      typeof placeholder === "string" &&
      !placeholder.startsWith("data:image/")
    ) {
      warnOnce(
        "placeholder-format",
        `placeholder must be a "data:image/*" URL. A BlurHash or ThumbHash ` +
          `string needs a JS decoder that cannot paint until the bundle has ` +
          `downloaded, parsed and run — convert it to a data URL on your ` +
          `server instead. → docs/design/image.md §3.`,
      )
    }
  }

  //`fill` is the only form whose precondition lives outside the component, so it
  //is the only one with a runtime check. Positioning is the half that is knowable
  //without layout — and it is the half that fails SILENTLY, by escaping to the
  //nearest positioned ancestor instead of stretching to the intended parent. The
  //sizing half needs a real layout pass, which no test environment adaptv runs in
  //performs, so it is documented rather than asserted.
  useLayoutEffect(() => {
    if (!import.meta.env.DEV) return
    if (!fill) return
    const parent = rootRef.current?.parentElement
    if (!parent) return
    if (getComputedStyle(parent).position !== "static") return
    warnOnce(
      "fill-parent",
      `<Image fill> is stretching to a parent with position: static, so it ` +
        `escaped to the nearest positioned ancestor. Give the parent ` +
        `"relative" and a height.`,
    )
  }, [fill])

  //Promotes only, never resets — the reset is the render-time derivation above.
  //This exists for a CACHED image, which is already `complete` by the time React
  //attaches the handlers and therefore fires no `load` event at all.
  useLayoutEffect(() => {
    if (!trimmed || invalid) return
    const img = imgRef.current
    if (!img || !img.complete) return
    if (img.naturalWidth > 0) setLoaded(true)
    else setErrored(true)
  }, [trimmed, invalid])

  function setImgRef(node: HTMLImageElement | null) {
    imgRef.current = node
    if (typeof ref === "function") ref(node)
    else if (ref) ref.current = node
  }

  function handleLoad(event: SyntheticEvent<HTMLImageElement>) {
    setLoaded(true)
    setErrored(false)
    onLoad?.(event)
  }

  function handleError(event: SyntheticEvent<HTMLImageElement>) {
    setErrored(true)
    setLoaded(false)
    onError?.(event)
  }

  const rootStyles = mergeStyles({
    base: [
      !fill && IMAGE_ROOT_BASE_LAYOUT_CLASS,
      //the "grey placeholder underneath" is the DEFAULT, not an opt-in: it is the
      //root's own surface, so an Image with no slots and no LQIP still shows a
      //neutral box for exactly as long as the load takes.
      IMAGE_SURFACE_CLASS,
    ],
    className,
    locked: fill
      ? IMAGE_ROOT_FILL_LOCKED_LAYOUT_CLASS
      : IMAGE_ROOT_LOCKED_LAYOUT_CLASS,
    style,
    //THE reservation, and therefore locked. A consumer inline `height` that
    //reached the root first would defeat the entire component. Locking costs
    //nothing anyone legitimately wants: `className="h-48"` still works — with a
    //definite height AND a ratio the ratio simply governs the width instead, and
    //the box is still reserved. The only thing made impossible is an unreserved
    //one, and `aspectRatio={n}` is the supported way to change it.
    lockedStyle: ratio ? { aspectRatio: ratio } : undefined,
  })

  const imgStyles = mergeStyles({
    base: [
      !reducedMotion && IMAGE_IMG_TRANSITION_CLASS,
      isImageVisible && IMAGE_IMG_VISIBLE_CLASS,
    ],
    locked: [
      IMAGE_IMG_LOCKED_LAYOUT_CLASS,
      !isImageVisible && IMAGE_IMG_HIDDEN_CLASS,
    ],
    lockedStyle: imageFitStyle(fit, position, false),
  })

  const context: ImageContextValue = {
    isLoading: state === "loading",
    isImageVisible,
    isPlaceholderVisible,
    isInvalidVisible,
    isErrorVisible,
  }

  return (
    <div
      ref={rootRef}
      data-adaptv="image"
      data-part="root"
      //presence attributes, per docs/decisions/styling.md §3.1 — `""`, never `true`, which React
      //would stringify to the string "true" and make `[data-image-loading]` match
      //in every state.
      data-image-loading={state === "loading" ? "" : undefined}
      data-image-loaded={state === "loaded" ? "" : undefined}
      data-image-error={state === "error" ? "" : undefined}
      data-image-invalid={state === "invalid" ? "" : undefined}
      //Emitted in production too. A dev-only guarantee that evaporates at build
      //time is a dev-only guarantee; this is what makes the backstop assertable
      //in an E2E run against a real bundle.
      data-image-unreserved={reserved ? undefined : ""}
      aria-busy={state === "loading" || undefined}
      className={rootStyles.className}
      style={rootStyles.style}
    >
      {placeholderUrl ? (
        <ImageLqipLayer
          url={placeholderUrl}
          visible={isPlaceholderVisible}
          fit={fit}
          position={position}
        />
      ) : null}
      <ImageContext.Provider value={context}>
        {children}
      </ImageContext.Provider>
      {invalid || errored ? null : (
        <img
          {...rest}
          ref={setImgRef}
          data-part="image"
          draggable={false}
          src={trimmed}
          alt={isImageVisible ? alt : ""}
          //Emitted alongside the wrapper's `aspect-ratio`, not instead of it. The
          //attributes are free and survive a stylesheet that fails to load; the
          //wrapper ratio is author-origin on an element adaptv owns outright, so
          //it survives the cases the presentational hint loses (author CSS setting
          //both dimensions, `h-full` from a flex parent, an author `aspect-ratio`
          //rule on `img`). They cover each other's failure modes.
          width={intrinsicWidth}
          height={intrinsicHeight}
          loading={priority ? "eager" : (loading ?? "lazy")}
          //Honoured from iOS 17.2, an inert unknown attribute below it — the right
          //shape for a hint: it degrades to nothing on a known version floor.
          fetchPriority={priority ? "high" : undefined}
          aria-hidden={isImageVisible ? undefined : true}
          className={imgStyles.className}
          style={imgStyles.style}
          onLoad={handleLoad}
          onError={handleError}
        />
      )}
    </div>
  )
}

ImageRoot.displayName = "Image"

const ImageCompound = Object.assign(ImageRoot, {
  Placeholder: ImagePlaceholder,
  Error: ImageError,
  Invalid: ImageInvalid,
})

export { ImageCompound as Image }
