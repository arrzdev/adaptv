import { motion, useReducedMotion } from "motion/react"
import type { ReactNode } from "react"
import { type RevealVariant, VARIANTS } from "@/components/motion"
import { cn } from "@/utils/cn"

/**
 * Shows a block once as it enters the viewport, with one of the landing's variants
 * (`components/motion.ts`). The observer's root is the viewport, which still works here
 * even though the DOCUMENT never scrolls: an element clipped by the page's own scroller is
 * not intersecting, so it reveals exactly when it scrolls in.
 *
 * The prerendered HTML ships the hidden state inline. A stylesheet rule draws it in its final
 * state without JS and under reduced motion (`[data-reveal]` in main.css), and under reduced
 * motion nothing is started either: the props stay the server's, so hydration matches, and
 * only the trigger is dropped.
 */
export function Reveal({
  children,
  className,
  variant = "text",
  delay = 0,
}: {
  children: ReactNode
  className?: string
  variant?: RevealVariant
  /** Seconds after it scrolls in (head and text). */
  delay?: number
}) {
  const reduce = useReducedMotion()
  return (
    <motion.div
      data-reveal
      className={cn(className)}
      variants={VARIANTS[variant]}
      custom={delay}
      initial="hidden"
      whileInView={reduce ? undefined : "shown"}
      viewport={{ once: true, margin: "0px 0px -12% 0px" }}
    >
      {children}
    </motion.div>
  )
}
