import type { GestureState } from "@arrzdev/adaptv/hooks"
import { useGestureEngine } from "@arrzdev/adaptv/hooks"
import { cn } from "@arrzdev/adaptv/utils"
import type { ReactNode } from "react"
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react"
import { useHaptics } from "@/hooks/use-haptics"

const DEFAULT_HOLD_DURATION_MS = 3000

const HOLD_BUTTON_CLASSNAME = cn(
  "clickable relative w-full overflow-hidden rounded-md border border-error bg-transparent",
  "py-3.5 text-base font-semibold leading-none",
  "focus:outline-none",
  "select-none",
  "disabled:opacity-50",
  "[-webkit-tap-highlight-color:transparent]",
)

type FillPhase = "idle" | "filling" | "complete"

export type HoldToConfirmButtonProps = {
  children: ReactNode
  /** Milliseconds the control must be held before {@link onConfirm} fires. */
  holdDurationMs?: number
  disabled?: boolean
  busy?: boolean
  onConfirm: () => void
  /** Fired when the hold ends before confirmation (release early or pointer leaves). */
  onHoldCancel?: () => void
  /**
   * Fired with `true` while a pointer is held down on the control and `false` once it lifts
   * (release or platform cancel). Stays `true` for the whole touch even if the finger drifts off
   * the button — so one continuous gesture can't switch from "holding" to "dragging" partway.
   * Wire to the surrounding Drawer's `disableDrag` so finger drift during the hold can't drag the
   * sheet.
   */
  onHoldActiveChange?: (active: boolean) => void
  className?: string
}

/**
 * Destructive-action control: press and hold until the progress fill completes.
 * Uses {@link useGestureEngine} with a long-press threshold equal to the hold duration.
 *
 * Fill visual: double-layer clip-mask — red base text, expanding red mask, foreground
 * duplicate text locked to the button width so the label color tracks the fill edge.
 */
export function HoldToConfirmButton({
  children,
  holdDurationMs = DEFAULT_HOLD_DURATION_MS,
  disabled = false,
  busy = false,
  onConfirm,
  onHoldCancel,
  onHoldActiveChange,
  className,
}: HoldToConfirmButtonProps) {
  const haptic = useHaptics()
  const buttonRef = useRef<HTMLButtonElement>(null)
  const [canvasWidth, setCanvasWidth] = useState(0)
  const [fillPhase, setFillPhase] = useState<FillPhase>("idle")
  const fillFrame = useRef<number | null>(null)
  const fillPhaseRef = useRef<FillPhase>("idle")
  const isInteractionDisabled = disabled || busy

  useLayoutEffect(() => {
    const el = buttonRef.current
    if (!el) return

    function measure() {
      const node = buttonRef.current
      if (!node) return
      setCanvasWidth(node.offsetWidth)
    }

    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const setFillPhaseSafe = useCallback((phase: FillPhase) => {
    fillPhaseRef.current = phase
    setFillPhase(phase)
  }, [])

  const resetFillAnimation = useCallback(() => {
    if (fillFrame.current !== null) {
      cancelAnimationFrame(fillFrame.current)
      fillFrame.current = null
    }
    setFillPhaseSafe("idle")
  }, [setFillPhaseSafe])

  const startFillAnimation = useCallback(() => {
    resetFillAnimation()
    fillFrame.current = requestAnimationFrame(() => {
      fillFrame.current = requestAnimationFrame(() => {
        fillFrame.current = null
        setFillPhaseSafe("filling")
      })
    })
  }, [resetFillAnimation, setFillPhaseSafe])

  const handleReject = useCallback(() => {
    haptic.impact("light")
    onHoldCancel?.()
  }, [onHoldCancel, haptic])

  const handleLongPressDown = useCallback(() => {
    haptic.notify("success")
    onConfirm()
  }, [onConfirm, haptic])

  const handleStateChange = useCallback(
    (state: GestureState) => {
      //pointer down on the button → lock the surrounding drawer's drag for the WHOLE touch, kept
      //locked until the finger actually lifts (idle/cancelled below). drifting off the button
      //mid-press is still the same gesture, so we must NOT re-accept drag there — doing so is the
      //"let go of the hold and the sheet starts dragging under my finger" bug.
      if (state === "pressing") {
        onHoldActiveChange?.(true)
        return
      }

      if (state === "longpress") {
        setFillPhaseSafe("complete")
        return
      }

      if (state === "outside") {
        //hold feel is cancelled, but the finger is still down — leave the drag lock ON
        resetFillAnimation()
        handleReject()
        return
      }

      //finger lifted (or a platform cancel): the gesture is over, so release the drag lock and
      //reject the fill if it was still mid-hold
      if (state === "idle" || state === "cancelled") {
        onHoldActiveChange?.(false)
        if (fillPhaseRef.current === "filling") {
          handleReject()
        }
        resetFillAnimation()
      }
    },
    [
      handleReject,
      resetFillAnimation,
      setFillPhaseSafe,
      onHoldActiveChange,
    ],
  )

  //if the button unmounts mid-hold (e.g. the drawer closes right after a confirm, before the
  //finger lifts) no idle/cancelled state fires — release the lock on unmount so a reopened drawer
  //can't come up with its drag still disabled
  useEffect(() => {
    return () => onHoldActiveChange?.(false)
  }, [onHoldActiveChange])

  const gestureEngineHandlers = useGestureEngine({
    disabled: isInteractionDisabled,
    longPressThreshold: holdDurationMs,
    slopMode: "leave",
    onPressDown: startFillAnimation,
    onLongPressDown: handleLongPressDown,
    onStateChange: handleStateChange,
  })

  const isMaskExpanded =
    fillPhase === "filling" || fillPhase === "complete"

  return (
    <button
      ref={buttonRef}
      type="button"
      disabled={isInteractionDisabled}
      aria-busy={busy || undefined}
      {...gestureEngineHandlers}
      className={cn(HOLD_BUTTON_CLASSNAME, className)}
    >
      {/* In-flow sizer — button dimensions come from label + py-3.5, not the spec's w-56 */}
      <span className="invisible block text-center" aria-hidden>
        {children}
      </span>

      {/* Fill reveal layers (clip-mask) — absolute over the sized canvas */}
      <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
        {/* Layer 1 — idle base text */}
        <span aria-hidden className="text-error">
          {children}
        </span>
      </span>

      {/* Layer 2 — animated fill mask (w-0 → w-full) */}
      <span
        aria-hidden
        className={cn(
          "pointer-events-none absolute inset-y-0 left-0 overflow-hidden bg-error",
          isMaskExpanded ? "w-full" : "w-0",
          fillPhase === "filling" && "transition-[width] ease-out",
        )}
        style={{
          transitionDuration:
            fillPhase === "filling" ? `${holdDurationMs}ms` : undefined,
        }}
      >
        {/* Layer 3 — mask text locked to canvas width */}
        <span
          className="absolute inset-y-0 left-0 flex items-center justify-center font-semibold text-primary-foreground"
          style={canvasWidth > 0 ? { width: canvasWidth } : undefined}
        >
          {children}
        </span>
      </span>

      <span className="sr-only">{children}</span>
    </button>
  )
}
