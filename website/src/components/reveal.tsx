import { cn } from "@arrzdev/adaptv/utils"
import { motion } from "motion/react"
import type { ReactNode } from "react"

/**
 * Fades a block up as it enters the viewport. The observer's root is the viewport, which
 * still works here even though the DOCUMENT never scrolls: an element clipped by the
 * page's own scroller is not intersecting, so it reveals exactly when it scrolls in.
 * Under reduced motion a stylesheet rule pins it in place (`[data-reveal]` in main.css):
 * CSS wins over the inline style the prerendered HTML ships, before and after hydration.
 */
export function Reveal({
  children,
  className,
  delay = 0,
  duration = 0.7,
}: {
  children: ReactNode
  className?: string
  delay?: number
  /** Seconds. A recording's frame rises in 0.2: it is the result, not a reveal. */
  duration?: number
}) {
  return (
    <motion.div
      data-reveal
      className={cn(className)}
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "0px 0px -12% 0px" }}
      transition={{ duration, delay, ease: [0.2, 0.7, 0.2, 1] }}
    >
      {children}
    </motion.div>
  )
}
