import type {
  HTMLAttributes,
  ImgHTMLAttributes,
  ReactNode,
  Ref,
  SyntheticEvent,
} from "react"
import {
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
} from "react"
import { useReducedMotion } from "#nativ/hooks/use-reduced-motion"
import { cn } from "#nativ/utils/cn"

/* =============================================================================
 * TYPES
 * ============================================================================= */

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

type ImageSlotClaim = "placeholder" | "invalid" | "error"

type ImageSlotContextValue = ImageContextValue & {
  claimSlot: (slot: ImageSlotClaim) => () => void
}

/**
 * Root {@link Image} — layered placeholder, invalid, and error slots over an
 * `<img>`. Pass `width` / `height` to reserve space via an in-flow layout anchor.
 *
 * @example
 * ```tsx
 * <Image src={url} alt="Hero" width={640} height={400}>
 *   <Image.Placeholder />
 *   <Image.Error>Could not load</Image.Error>
 * </Image>
 * ```
 */
export interface ImageProps
  extends Omit<ImgHTMLAttributes<HTMLImageElement>, "src"> {
  src?: string | null
  children?: React.ReactNode
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

/* =============================================================================
 * CLASSES
 * ============================================================================= */

const IMAGE_SLOT_LAYER_LAYOUT_CLASS =
  "absolute inset-0 box-border size-full overflow-hidden rounded-[inherit]"
const IMAGE_SLOT_LAYER_SURFACE_CLASS = "bg-gray-50"
const IMAGE_SLOT_LAYER_UNDER_CLASS = "z-[1]"
const IMAGE_SLOT_LAYER_OVER_CLASS = "z-20"
const IMAGE_SLOT_LAYER_VISIBLE_CLASS = "opacity-100"
const IMAGE_SLOT_LAYER_HIDDEN_CLASS = "invisible"
const IMAGE_SLOT_LAYER_TRANSITION_CLASS =
  "transition-opacity duration-300 ease-out"
const IMAGE_LAYOUT_ANCHOR_LAYOUT_CLASS = "block w-full"
const IMAGE_COMPOSED_SHELL_LAYOUT_CLASS =
  "relative size-full min-h-0 overflow-hidden rounded-[inherit]"
const IMAGE_COMPOSED_IMG_LAYOUT_CLASS =
  "absolute inset-0 block size-full min-h-full min-w-full max-h-none max-w-none text-[0px] leading-0"
const IMAGE_COMPOSED_IMG_TRANSITION_CLASS =
  "select-none transition-opacity duration-300 ease-out"
const IMAGE_COMPOSED_IMG_VISIBLE_CLASS = "z-10 opacity-100"
const IMAGE_COMPOSED_IMG_HIDDEN_CLASS = "-z-10 overflow-hidden opacity-0"
const IMAGE_COMPOSED_IMG_TRANSFORM_CLASS =
  "origin-center [transform:translateZ(0)_scale(1.008)]"
const IMAGE_STANDALONE_LAYOUT_CLASS = "block size-full object-cover"

const ABSOLUTE_URL_PROTOCOL = /^(https?|file|blob|data):/i

const RELATIVE_PATH = /^(?:\.\.\/|\.\/|\/)(?:[^\s#?]+(?:\/[^\s#?]+)*)?$/

const SIMPLE_RELATIVE_PATH =
  /^[^\s#?]+(?:\/[^\s#?]+)+$|^[^\s#?]+\.[^\s#?]+$/

/* =============================================================================
 * SRC VALIDATION
 * ============================================================================= */

function isLoadableImageSrc(src: string): boolean {
  const trimmed = src.trim()
  if (!trimmed) return false

  if (trimmed.startsWith("//")) {
    try {
      new URL(`https:${trimmed}`)
      return true
    } catch {
      return false
    }
  }

  if (ABSOLUTE_URL_PROTOCOL.test(trimmed)) {
    try {
      const url = new URL(trimmed)
      if (url.protocol === "data:") {
        return url.pathname.startsWith("image/")
      }
      return true
    } catch {
      return false
    }
  }

  if (RELATIVE_PATH.test(trimmed)) return true

  return SIMPLE_RELATIVE_PATH.test(trimmed)
}

/* =============================================================================
 * CONTEXT
 * ============================================================================= */

const ImageContext = createContext<ImageSlotContextValue | null>(null)

/**
 * Reactive load and overlay visibility for {@link Image} compound trees.
 * Use in Tier 2 slot wrappers when chrome must track live load state.
 */
export function useImage(): ImageContextValue {
  const ctx = useContext(ImageContext)
  if (!ctx) {
    throw new Error("useImage must be used within <Image>.")
  }
  return {
    isLoading: ctx.isLoading,
    isImageVisible: ctx.isImageVisible,
    isPlaceholderVisible: ctx.isPlaceholderVisible,
    isInvalidVisible: ctx.isInvalidVisible,
    isErrorVisible: ctx.isErrorVisible,
  }
}

function useImageSlotContext(): ImageSlotContextValue {
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

function assignRef<T>(ref: Ref<T> | undefined, value: T | null) {
  if (typeof ref === "function") {
    ref(value)
    return
  }
  if (ref) {
    ref.current = value
  }
}

/* =============================================================================
 * SLOT LAYER
 * ============================================================================= */

type ImageSlotLayerProps = HTMLAttributes<HTMLDivElement> & {
  mounted: boolean
  visible: boolean
  stack: "under-image" | "over-image"
  decorative?: boolean
  children?: ReactNode
}

function ImageSlotLayer({
  mounted,
  visible,
  stack,
  decorative = false,
  className,
  children,
  ...props
}: ImageSlotLayerProps) {
  const reducedMotion = useReducedMotion()

  if (!mounted) return null

  return (
    <div
      {...props}
      aria-hidden={decorative ? true : visible ? undefined : true}
      className={cn(
        IMAGE_SLOT_LAYER_LAYOUT_CLASS,
        IMAGE_SLOT_LAYER_SURFACE_CLASS,
        stack === "under-image"
          ? IMAGE_SLOT_LAYER_UNDER_CLASS
          : IMAGE_SLOT_LAYER_OVER_CLASS,
        visible
          ? cn(
              IMAGE_SLOT_LAYER_VISIBLE_CLASS,
              !reducedMotion && IMAGE_SLOT_LAYER_TRANSITION_CLASS,
            )
          : IMAGE_SLOT_LAYER_HIDDEN_CLASS,
        className,
      )}
    >
      {children}
    </div>
  )
}

function ImageLayoutAnchor({
  width,
  height,
  className,
}: {
  width?: number | string
  height?: number | string
  className?: string
}) {
  const w = width != null ? Number(width) : null
  const h = height != null ? Number(height) : null
  const aspectRatio =
    w != null && h != null && w > 0 && h > 0 ? `${w} / ${h}` : undefined

  return (
    <div
      aria-hidden
      className={cn(IMAGE_LAYOUT_ANCHOR_LAYOUT_CLASS, className)}
      style={aspectRatio ? { aspectRatio } : undefined}
    />
  )
}

/* =============================================================================
 * COMPOUND SLOTS
 * ============================================================================= */

function ImageError({ className, children, ...props }: ImageErrorProps) {
  const { isErrorVisible, claimSlot } = useImageSlotContext()
  const hasContent =
    children === undefined || imageSlotHasContent(children)

  useLayoutEffect(() => {
    if (!hasContent) return
    return claimSlot("error")
  }, [claimSlot, hasContent])

  if (!hasContent) return null

  return (
    <ImageSlotLayer
      {...props}
      mounted
      visible={isErrorVisible}
      stack="over-image"
      className={className}
    >
      {children}
    </ImageSlotLayer>
  )
}

ImageError.displayName = "Image.Error"

function ImageInvalid({
  className,
  children,
  ...props
}: ImageInvalidProps) {
  const { isInvalidVisible, claimSlot } = useImageSlotContext()
  const hasContent =
    children === undefined || imageSlotHasContent(children)

  useLayoutEffect(() => {
    if (!hasContent) return
    return claimSlot("invalid")
  }, [claimSlot, hasContent])

  if (!hasContent) return null

  return (
    <ImageSlotLayer
      {...props}
      mounted
      visible={isInvalidVisible}
      stack="over-image"
      className={className}
    >
      {children}
    </ImageSlotLayer>
  )
}

ImageInvalid.displayName = "Image.Invalid"

function ImagePlaceholder({
  className,
  children,
  ...props
}: ImagePlaceholderProps) {
  const { isPlaceholderVisible, claimSlot } = useImageSlotContext()
  const hasContent =
    children === undefined || imageSlotHasContent(children)

  useLayoutEffect(() => {
    if (!hasContent) return
    return claimSlot("placeholder")
  }, [claimSlot, hasContent])

  if (!hasContent) return null

  return (
    <ImageSlotLayer
      {...props}
      mounted
      visible={isPlaceholderVisible}
      stack="under-image"
      decorative
      className={className}
    >
      {children}
    </ImageSlotLayer>
  )
}

ImagePlaceholder.displayName = "Image.Placeholder"

/* =============================================================================
 * IMAGE ROOT
 * ============================================================================= */

const Image = forwardRef<HTMLImageElement, ImageProps>(function Image(
  {
    src,
    className,
    alt = "",
    width,
    height,
    children,
    onLoad,
    onError,
    ...props
  },
  forwardedRef,
) {
  const imgRef = useRef<HTMLImageElement>(null)
  const reducedMotion = useReducedMotion()
  const resolvedSrc = src ?? undefined
  const [loaded, setLoaded] = useState(false)
  const [errored, setErrored] = useState(false)
  const [mountedSlots, setMountedSlots] = useState({
    placeholder: false,
    invalid: false,
    error: false,
  })

  const claimSlot = useCallback((slot: ImageSlotClaim) => {
    setMountedSlots((prev) => ({ ...prev, [slot]: true }))
    return () => {
      setMountedSlots((prev) => ({ ...prev, [slot]: false }))
    }
  }, [])

  const hasSrc = Boolean(resolvedSrc)
  const missingSrc = !hasSrc
  const invalidSrc =
    typeof resolvedSrc === "string" && !isLoadableImageSrc(resolvedSrc)
  const isInvalidVisible = mountedSlots.invalid && invalidSrc
  const isErrorVisible =
    mountedSlots.error &&
    (errored ||
      (invalidSrc && !mountedSlots.invalid) ||
      (missingSrc && !mountedSlots.placeholder))
  const isImageVisible = hasSrc && loaded && !errored && !invalidSrc
  const canLoad = hasSrc && !invalidSrc
  const isLoading = canLoad && !loaded && !errored
  const awaitingSrc = !hasSrc
  const isPlaceholderVisible =
    mountedSlots.placeholder &&
    !isImageVisible &&
    !isInvalidVisible &&
    !isErrorVisible &&
    (isLoading || awaitingSrc)
  const mountImg = hasSrc && !invalidSrc && !errored
  const screenReaderAlt = isImageVisible ? alt : ""
  const needsCompositionShell =
    Boolean(children) || width != null || height != null

  function setImgRef(node: HTMLImageElement | null) {
    imgRef.current = node
    assignRef(forwardedRef, node)
  }

  useLayoutEffect(() => {
    setLoaded(false)
    setErrored(false)
    if (!resolvedSrc || invalidSrc) return
    const img = imgRef.current
    if (!img) return
    if (!img.complete) return
    if (img.naturalWidth > 0) {
      setLoaded(true)
      return
    }
    setErrored(true)
  }, [resolvedSrc, invalidSrc])

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

  const imgNode = mountImg && (
    <img
      ref={setImgRef}
      draggable={false}
      src={resolvedSrc}
      alt={screenReaderAlt}
      width={width}
      height={height}
      aria-hidden={isImageVisible ? undefined : true}
      className={cn(
        needsCompositionShell && IMAGE_COMPOSED_IMG_LAYOUT_CLASS,
        !reducedMotion && IMAGE_COMPOSED_IMG_TRANSITION_CLASS,
        isImageVisible
          ? IMAGE_COMPOSED_IMG_VISIBLE_CLASS
          : IMAGE_COMPOSED_IMG_HIDDEN_CLASS,
        isImageVisible && IMAGE_COMPOSED_IMG_TRANSFORM_CLASS,
        !needsCompositionShell && IMAGE_STANDALONE_LAYOUT_CLASS,
        className,
      )}
      onLoad={handleLoad}
      onError={handleError}
      {...props}
    />
  )

  if (!needsCompositionShell) {
    return imgNode
  }

  const contextValue: ImageSlotContextValue = {
    isLoading,
    isImageVisible,
    isPlaceholderVisible,
    isInvalidVisible,
    isErrorVisible,
    claimSlot,
  }

  return (
    <div
      className={IMAGE_COMPOSED_SHELL_LAYOUT_CLASS}
      aria-busy={isLoading || undefined}
    >
      <ImageLayoutAnchor width={width} height={height} />
      <ImageContext.Provider value={contextValue}>
        {children}
      </ImageContext.Provider>
      {imgNode}
    </div>
  )
})

Image.displayName = "Image"

/* =============================================================================
 * COMPOUND EXPORT
 * ============================================================================= */

const ImageCompound = Object.assign(Image, {
  Placeholder: ImagePlaceholder,
  Error: ImageError,
  Invalid: ImageInvalid,
})

export { ImageCompound as Image }
