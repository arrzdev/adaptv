import { useEffect } from "react"

/**
 * How far you must scroll away from an edge before its fade reaches full strength.
 *
 * Android computes the same ramp from the fade length itself
 * (`getTopFadingEdgeStrength()` = offset / fadingEdgeLength). adaptv uses a fixed
 * distance instead, because the length lives in CSS as `--fade-length` and may be a
 * percentage or a `rem` — reading it back would mean a `getComputedStyle` per resize
 * to gain nothing perceptible. 24px is short enough that the fade feels instant and
 * long enough that it does not pop on the first pixel of a rubber-band.
 */
const FADE_RAMP_PX = 24

const START_VAR = "--fade-start"
const END_VAR = "--fade-end"

export interface ScrollEdgeFadeOptions {
  /** Fade the near edge (top, or inline-start when horizontal). */
  start: boolean
  /** Fade the far edge (bottom, or inline-end when horizontal). */
  end: boolean
  /** Read `scrollLeft` instead of `scrollTop`. */
  horizontal: boolean
}

/**
 * Drive a scroll container's edge-fade strengths from its scroll position.
 *
 * Writes `--fade-start` / `--fade-end` (0→1) straight onto the node, never through
 * React state — same reason `data-pressed` is written with `setAttribute`: a value
 * that changes on every scroll frame must not cost a render, and the consumer's tree
 * has no business re-rendering because a gradient moved.
 *
 * The strengths are what make a tall fade usable: parked at the top, the top fade is
 * 0 and the first line of content is fully crisp; scroll 24px and it is at full
 * strength. A container whose content does not overflow reports 0 at both ends, so
 * turning fades on unconditionally costs nothing on short content.
 *
 * @param ref the scroll node
 * @param enabled skip all observers when no edge is faded
 */
export function useScrollEdgeFade(
  ref: React.RefObject<HTMLElement | null>,
  enabled: boolean,
  { start, end, horizontal }: ScrollEdgeFadeOptions,
) {
  useEffect(() => {
    const node = ref.current
    if (!node || !enabled) return

    let frame = 0

    const measure = () => {
      frame = 0
      const offset = horizontal ? node.scrollLeft : node.scrollTop
      const extent = horizontal
        ? node.scrollWidth - node.clientWidth
        : node.scrollHeight - node.clientHeight

      /*
       * Both distances are FLOORED AT ZERO, not made absolute. iOS rubber-band
       * overscroll drives `scrollTop` negative at the top and past `extent` at the
       * bottom; unclamped, the strength goes negative mid-bounce, the mask stops are
       * emitted out of order, and the edge flickers opaque for the length of the
       * bounce.
       *
       * ⚠︎ `Math.abs` was the original clamp here and it is the WRONG function: it
       * does not floor, it MIRRORS. Pull the top down 30px and `abs(-30)` is 30, so
       * the top fade ramps to full strength during an overscroll where there is by
       * definition nothing above the first line — the gradient appears exactly when
       * it should be absent. The bottom half always used `Math.max` and was always
       * right; only the top carried the mirror.
       */
      const fromStart = Math.max(0, offset)
      const fromEnd = Math.max(0, extent - offset)

      const startStrength = start
        ? Math.min(1, fromStart / FADE_RAMP_PX)
        : 0
      const endStrength = end ? Math.min(1, fromEnd / FADE_RAMP_PX) : 0

      node.style.setProperty(START_VAR, String(startStrength))
      node.style.setProperty(END_VAR, String(endStrength))
    }

    /*
     * Coalesce to one write per frame: scroll fires far more often than paint, and a
     * mutation burst (a list rendering 200 rows) would otherwise measure 200 times.
     *
     * Cancel-and-reschedule rather than `if (frame) return`. Both coalesce — the
     * browser still runs the surviving callback at the next frame boundary — but the
     * early-return version WEDGES if a queued callback never runs. A hidden tab
     * suspends rAF entirely (this is reproducible: background the page, scroll, come
     * back), and any path where that callback is dropped instead of deferred leaves
     * `frame` non-zero forever, so every later scroll short-circuits and the fades
     * freeze at whatever strength they last held. Silent, permanent, and invisible
     * until someone notices a fade over content that has nothing beyond it.
     */
    const schedule = () => {
      if (frame !== 0) cancelAnimationFrame(frame)
      frame = requestAnimationFrame(measure)
    }

    measure()
    node.addEventListener("scroll", schedule, { passive: true })

    //the viewport changing size changes what overflows…
    const resizeObserver = new ResizeObserver(schedule)
    resizeObserver.observe(node)

    /*
     * …and so does the CONTENT changing, which no ResizeObserver on this node can
     * see: `scrollHeight` grows while the node's own box stays identical. A list that
     * loads its second page while parked at the top would keep an end-fade strength
     * of 0 and look like it had reached the bottom. The observer is idle until the
     * DOM actually changes, and every notification lands in the same rAF as scroll.
     */
    const mutationObserver = new MutationObserver(schedule)
    mutationObserver.observe(node, {
      childList: true,
      subtree: true,
      characterData: true,
    })

    return () => {
      if (frame !== 0) cancelAnimationFrame(frame)
      node.removeEventListener("scroll", schedule)
      resizeObserver.disconnect()
      mutationObserver.disconnect()
      //leave nothing behind: a re-render that turns fades off must not strand the
      //element at whatever strength it happened to hold
      node.style.removeProperty(START_VAR)
      node.style.removeProperty(END_VAR)
    }
  }, [ref, enabled, start, end, horizontal])
}
