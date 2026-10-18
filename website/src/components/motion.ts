import type { Variants } from "motion/react"

/*
 * The landing's reveals (landing-v4 §3), after expo.dev's but shorter: every block fades in
 * once as it scrolls in, by opacity, transform and a short blur on small things only. None of
 * them changes a box's size, so none is a layout shift. A variant names its two states
 * `hidden` and `shown`; Motion passes the state down, so a diagram's tiles and wires follow
 * the card's visual without observers of their own.
 */
const EASE_OUT = [0.22, 1, 0.36, 1] as const
const EASE_HEAD = [0.16, 1, 0.3, 1] as const

/** Once the blur is gone, drop the filter instead of keeping `blur(0)` on a layer. */
const settled = { filter: "none" }

export const VARIANTS = {
  /** Section title and lede; the lede follows 0.12 s later. */
  head: {
    hidden: { opacity: 0, y: 16, filter: "blur(6px)" },
    shown: (delay = 0) => ({
      opacity: 1,
      y: 0,
      filter: "blur(0px)",
      transition: { duration: 0.9, ease: EASE_HEAD, delay },
      transitionEnd: settled,
    }),
  },
  /** A card's picture: a demo or a diagram. */
  visual: {
    hidden: { opacity: 0, scale: 0.96 },
    shown: {
      opacity: 1,
      scale: 1,
      transition: { duration: 1, ease: EASE_OUT },
    },
  },
  /** A card's title, body and link. */
  text: {
    hidden: { opacity: 0, y: 12 },
    shown: (delay = 0) => ({
      opacity: 1,
      y: 0,
      transition: { duration: 0.7, ease: EASE_OUT, delay },
    }),
  },
  /** A diagram tile or chip, the `index`-th of its diagram, after the visual has begun. */
  tile: {
    hidden: { opacity: 0, scale: 0.6, filter: "blur(8px)" },
    shown: (index = 0) => ({
      opacity: 1,
      scale: 1,
      filter: "blur(0px)",
      transition: { duration: 0.3, ease: EASE_HEAD, delay: 0.2 + index * 0.06 },
      transitionEnd: settled,
    }),
  },
  /** A diagram wire, drawn from its start. */
  wire: {
    hidden: { pathLength: 0 },
    shown: {
      pathLength: 1,
      transition: { duration: 0.9, ease: EASE_OUT, delay: 0.3 },
    },
  },
} satisfies Record<string, Variants>

export type RevealVariant = "head" | "visual" | "text"
