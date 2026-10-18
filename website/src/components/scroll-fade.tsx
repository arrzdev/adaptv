import { useEffect, useRef, useState } from "react"
import { cn } from "@/utils/cn"

/**
 * Whether a block that scrolls sideways has more to the right. A phone draws no
 * scrollbar until the reader scrolls, so a line cut at the edge gives no hint that it
 * goes on; `ScrollFade` is that hint. False on the server and until the first measure,
 * so the fade only ever appears, it never moves anything. Pass what the scroller shows
 * as `content` when it can change in place (a tab switch): the box may keep its size.
 */
export function useMoreToScroll<T extends HTMLElement>(content?: unknown) {
  const scroller = useRef<T>(null)
  const [more, setMore] = useState(false)
  // biome-ignore lint/correctness/useExhaustiveDependencies: content is the trigger, not an input
  useEffect(() => {
    const node = scroller.current
    if (!node) return
    //a pixel of slack: zoomed layouts report fractional widths
    const measure = () =>
      setMore(node.scrollLeft + node.clientWidth < node.scrollWidth - 1)
    measure()
    //the web font is wider or narrower than the fallback the first measure saw
    void document.fonts?.ready.then(measure)
    node.addEventListener("scroll", measure, { passive: true })
    const resize = new ResizeObserver(measure)
    resize.observe(node)
    return () => {
      node.removeEventListener("scroll", measure)
      resize.disconnect()
    }
  }, [content])
  return [scroller, more] as const
}

/**
 * The fade over the right edge of a scroller. Put it after the scroller in a `relative`
 * parent; `className` gives the colour it fades from (the scroller's background) and the
 * inset and rounding that keep it inside the scroller's border.
 */
export function ScrollFade({
  more,
  className,
}: {
  more: boolean
  className?: string
}) {
  return (
    <div
      aria-hidden
      data-testid="scroll-fade"
      data-more={more}
      className={cn(
        "pointer-events-none absolute w-12 bg-linear-to-l to-transparent transition-opacity",
        more ? "opacity-100" : "opacity-0",
        className,
      )}
    />
  )
}
