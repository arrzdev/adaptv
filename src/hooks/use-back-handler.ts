import { useEffect, useRef } from "react"
import type { BackHandler } from "#nativ/capabilities/back-chain"
import {
  BackPriority,
  registerBackHandler,
} from "#nativ/capabilities/back-chain"

/**
 * Intercept the back press while this component is mounted.
 *
 * Return `true` to consume it, `false` to defer to the next handler down the
 * chain. Registration is scoped to the component's lifetime, so an overlay that
 * unmounts stops intercepting automatically.
 *
 * ```tsx
 * useBackHandler(() => {
 *   if (!open) return false      // defer — nothing to close
 *   setOpen(false)
 *   return true                  // consumed: back closed the drawer, not the route
 * }, BackPriority.Overlay)
 * ```
 *
 * The handler is held in a ref and the registration is **not** re-run when it
 * changes identity. That matters: re-registering on every render would move the
 * entry to the end of its priority band on each render, silently reordering
 * stacked overlays. The band's tie-break is *mount* order, and it has to stay
 * that way.
 */
export function useBackHandler(
  handler: BackHandler,
  priority: number = BackPriority.Transient,
): void {
  const handlerRef = useRef(handler)
  handlerRef.current = handler

  useEffect(
    () => registerBackHandler(() => handlerRef.current(), priority),
    [priority],
  )
}
