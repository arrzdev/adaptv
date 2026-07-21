import type { MouseEvent } from "react"
import { useCallback } from "react"
import { haptics } from "#nativ/capabilities/haptics"

//A React convenience over the `haptics` API — the app-facing semantic aliases plus
//`hapticPointerHandlers` for tap feedback. For plain fire-and-forget feedback,
//import `haptics` from `@arrzdev/nativ/capabilities` directly (the hook-vs-API rule:
//imperative → API). This hook exists for the pointer-handler ergonomics.

type VibrateKind =
  | "ok"
  | "success"
  | "cancel"
  | "selection"
  | "impact"
  | "warning"
  | "error"

/** Kinds wired into pointer/tap feedback via {@link useVibrate} handlers. */
type PointerVibrateKind = Extract<VibrateKind, "ok" | "success" | "cancel">

//map the app's semantic taxonomy onto the `haptics` primitive
function fire(kind: VibrateKind): void {
  switch (kind) {
    case "success":
      haptics.notify("success")
      break
    case "warning":
      haptics.notify("warning")
      break
    case "error":
      haptics.notify("error")
      break
    case "selection":
      haptics.selection()
      break
    case "impact":
      haptics.impact("medium")
      break
    case "cancel":
      haptics.impact("light")
      break
    default:
      //ok — a light confirmation tap
      haptics.impact("light")
  }
}

/** Whether haptic feedback is available. Prefer `haptics.isSupported()`. */
export function canVibrate(): boolean {
  return haptics.isSupported()
}

function pointerTypeFromClick(e: MouseEvent<HTMLElement>): string {
  if ("pointerType" in e.nativeEvent) {
    return (e.nativeEvent as PointerEvent).pointerType
  }
  return "mouse"
}

export function useVibrate() {
  const vibrateOk = useCallback(() => fire("ok"), [])
  const vibrateSuccess = useCallback(() => fire("success"), [])
  const vibrateCancel = useCallback(() => fire("cancel"), [])
  const vibrateSelection = useCallback(() => fire("selection"), [])
  const vibrateImpact = useCallback(() => fire("impact"), [])
  const vibrateWarning = useCallback(() => fire("warning"), [])
  const vibrateError = useCallback(() => fire("error"), [])

  const hapticPointerHandlers = useCallback(
    (handler: () => void, kind: PointerVibrateKind) => ({
      onTouchEnd: () => fire(kind),
      onClick: (e: MouseEvent<HTMLElement>) => {
        if (pointerTypeFromClick(e) !== "touch") fire(kind)
        handler()
      },
    }),
    [],
  )

  return {
    vibrateOk,
    vibrateSuccess,
    vibrateCancel,
    vibrateSelection,
    vibrateImpact,
    vibrateWarning,
    vibrateError,
    canVibrate,
    hapticPointerHandlers,
  }
}
