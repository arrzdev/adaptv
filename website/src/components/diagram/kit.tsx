import { motion } from "motion/react"
import { type ReactNode, useEffect, useRef } from "react"
import { VARIANTS } from "@/components/motion"

/*
 * The diagram kit (landing-v4 §2): inline SVG with a fixed viewBox, hidden from assistive
 * tech because the card's text carries the meaning. Tiles and wires are Motion children of
 * the card's visual: they take its `hidden` → `shown` and need no observer of their own.
 * The styles are the `.dg` rules in main.css.
 */

/** The SVG. Its box comes from the viewBox and the width, so it is sized before it paints. */
export function Diagram({
  viewBox,
  maxWidth,
  children,
}: {
  viewBox: string
  /** CSS px: the width it is drawn for. */
  maxWidth: number
  children: ReactNode
}) {
  const ref = useRunWhileOnScreen()
  return (
    <svg
      ref={ref}
      className="dg"
      viewBox={viewBox}
      style={{ maxWidth }}
      aria-hidden="true"
    >
      {children}
    </svg>
  )
}

/** A tile or chip: pops in, the `index`-th of its diagram. */
export function Tile({
  index,
  children,
}: {
  index: number
  children: ReactNode
}) {
  return (
    <motion.g
      data-reveal
      variants={VARIANTS.tile}
      custom={index}
      style={{ transformBox: "fill-box", transformOrigin: "center" }}
    >
      {children}
    </motion.g>
  )
}

/** A solid wire, drawn from its start. Dashed wires are plain paths: they keep their dashes. */
export function Wire({
  d,
  accent = false,
}: {
  d: string
  /** The one path that matters: brand colour, with the light running along it. */
  accent?: boolean
}) {
  return (
    <>
      <motion.path
        data-reveal
        data-wire
        d={d}
        className={accent ? "accent" : "wire"}
        variants={VARIANTS.wire}
      />
      {accent ? <path d={d} className="run" pathLength={100} /> : null}
    </>
  )
}

/**
 * Plays the running light only while the diagram is on screen and the tab is visible: it
 * sets `data-running` on the SVG, which the CSS animation's play state reads. No state, so
 * no re-render.
 */
function useRunWhileOnScreen() {
  const ref = useRef<SVGSVGElement>(null)
  useEffect(() => {
    const svg = ref.current
    if (!svg || typeof IntersectionObserver === "undefined") return
    let onScreen = false
    const sync = () =>
      svg.toggleAttribute("data-running", onScreen && !document.hidden)
    const observer = new IntersectionObserver(([entry]) => {
      onScreen = entry.isIntersecting
      sync()
    })
    observer.observe(svg)
    document.addEventListener("visibilitychange", sync)
    return () => {
      observer.disconnect()
      document.removeEventListener("visibilitychange", sync)
    }
  }, [])
  return ref
}
