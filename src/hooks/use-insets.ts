import { useEffect, useState } from "react"

/* =============================================================================
 * TYPES
 * ============================================================================= */

/** Safe-area insets in **px**, one per edge. `0` where there is no inset. */
export type Insets = {
  top: number
  right: number
  bottom: number
  left: number
}

const ZERO_INSETS: Insets = { top: 0, right: 0, bottom: 0, left: 0 }

/** Edge order used by the probes below — must match the `Insets` assembly. */
const INSET_SIDES = ["top", "right", "bottom", "left"] as const

/* =============================================================================
 * MEASUREMENT
 * ============================================================================= */

/**
 * The safe-area insets as px numbers, measured once and outside React. Prefer
 * {@link useInsets} in a component; this is the imperative read for callers that want a
 * value without a subscription.
 *
 * Reads the four contract vars (styles/safe-area.css) as resolved px lengths.
 *
 * ⚠︎ NOT via the obvious spelling:
 *
 *     getComputedStyle(document.documentElement).getPropertyValue("--adaptv-inset-top")
 *
 * What a custom property's computed value serialises to is engine-dependent for a
 * `var()`/`env()` chain, and nothing guarantees it is an absolute length even when the
 * engine does substitute. Measured both ways: Chrome 141 returns `"0px"` (substituted),
 * happy-dom returns the literal `"var(--safe-area-inset-top, env(safe-area-inset-top,
 * 0px))"` → `parseFloat` → `NaN`. A read that works on the machine you develop on and
 * silently returns garbage elsewhere is the worst kind, and this hook exists precisely
 * for the engines that behave oddly here.
 *
 * So: hand the vars to a real property on a throwaway element and read THAT back. A
 * used value is always an absolute px length, on every engine, by definition.
 * `padding-top` is the right property — it cannot be negative, so nothing clamps.
 *
 * ONE PROBE PER EDGE, each setting only `padding-top`, rather than one probe carrying
 * all four sides. A block holding all four padding longhands serialises back as the
 * `padding` shorthand (happy-dom re-parses it as one), and a shorthand is a SINGLE
 * declaration — so ONE unresolvable var invalidates it and zeroes all four edges
 * together. Verified in Chrome: `padding: var(--a) var(--b) var(--undefined) var(--d)`
 * computes to `0px` on every edge. Separate elements keep the edges independent. The
 * four are appended together so only the first `getComputedStyle` pays a style flush.
 *
 * `getComputedStyle` rather than `getBoundingClientRect()` on a sized probe: the rect
 * path is what `use-keyboard-avoidance` used to do, and it reads 0 under happy-dom
 * (no layout engine), which makes every consumer of it untestable. Computed padding
 * is reported without layout.
 */
const PROBE_BASE_STYLE =
  "position:fixed;top:0;left:0;width:0;height:0;visibility:hidden;pointer-events:none;"

export function readSafeAreaInsets(): Insets {
  if (typeof document === "undefined") return ZERO_INSETS

  const root = document.documentElement
  const probes = INSET_SIDES.map((side) => {
    const probe = document.createElement("div")
    probe.style.cssText = `${PROBE_BASE_STYLE}padding-top:var(--adaptv-inset-${side})`
    root.appendChild(probe)
    return probe
  })

  const measured = probes.map((probe) =>
    toPx(getComputedStyle(probe).paddingTop),
  )
  for (const probe of probes) probe.remove()

  return {
    top: measured[0],
    right: measured[1],
    bottom: measured[2],
    left: measured[3],
  }
}

/** `"34px"` → `34`; anything unparseable (unsupported engine, var absent) → `0`. */
function toPx(value: string): number {
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function insetsAreEqual(a: Insets, b: Insets): boolean {
  return (
    a.top === b.top &&
    a.right === b.right &&
    a.bottom === b.bottom &&
    a.left === b.left
  )
}

/* =============================================================================
 * HOOK
 * ============================================================================= */

/**
 * Safe-area insets as **numbers in px** — `{ top, right, bottom, left }`.
 *
 * **This is an escape hatch, not the way to pad things.** For padding, margin, or
 * positioning, use the CSS utilities (`pb-safe`, `pt-safe-offset-2`,
 * `pb-safe-or-4`, …): they cost no re-render, apply before the first paint, and
 * follow a rotation with no JS involved. This hook is one React state update behind
 * all of that.
 *
 * Reach for it when the inset feeds **computation** rather than a box property:
 * a scroll offset, a gesture threshold, available-height maths, a number handed to
 * a native call. The API shape follows `react-native-safe-area-context`'s
 * `useSafeAreaInsets()` — the reference implementation, since Ionic does safe-area
 * purely in CSS and ships no hook at all.
 *
 * Reads the same four contract vars every utility reads (styles/safe-area.css), so
 * it inherits the Capacitor-injected Android values rather than re-deriving from a
 * bare `env()` that reads 0 on WebView < 140 (crbug/40699457). Returns zeros on the
 * server and on the first client render, then measures in an effect.
 *
 * @example
 * ```tsx
 * const insets = useInsets()
 * const snapPoint = window.innerHeight - insets.bottom - HANDLE_HEIGHT
 * ```
 */
export function useInsets(): Insets {
  const [insets, setInsets] = useState<Insets>(ZERO_INSETS)

  useEffect(() => {
    function measure() {
      const next = readSafeAreaInsets()
      setInsets((prev) => (insetsAreEqual(prev, next) ? prev : next))
    }

    measure()

    //Three independent sources, and all three are needed:
    //
    //1. `orientationchange` — landscape swaps which edges carry an inset entirely.
    //2. `visualViewport` resize — the browser-tab case (URL bar collapse, window
    //   resize) changes `env()` without an orientation change. `window.resize`
    //   double-fires with it, so subscribe to the visual viewport only, and fall
    //   back to `window` where it is unsupported.
    //3. A `MutationObserver` on `<html>`'s `style` attribute — Capacitor's
    //   `SystemBars` writes `--safe-area-inset-*` straight onto
    //   `document.documentElement` and emits NO event. Without this the very case
    //   the contract exists for (Android WebView < 140) never updates after mount.
    window.addEventListener("orientationchange", measure)

    const viewport = window.visualViewport
    if (viewport) viewport.addEventListener("resize", measure)
    else window.addEventListener("resize", measure)

    const observer = new MutationObserver(measure)
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["style"],
    })

    return () => {
      window.removeEventListener("orientationchange", measure)
      if (viewport) viewport.removeEventListener("resize", measure)
      else window.removeEventListener("resize", measure)
      observer.disconnect()
    }
  }, [])

  return insets
}
