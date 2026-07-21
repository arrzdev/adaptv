import { useEffect, useRef } from "react"

export type ScreenLifecycle = {
  /** The screen became visible — mount. */
  onEnter?: () => void
  /** The screen went away — unmount. Return value ignored. */
  onLeave?: () => void
}

/**
 * Enter/leave hooks for a route component. → `COORDINATION.md §4`
 *
 * ## This is sugar, not a retention mechanism — and that is the decision
 *
 * React Navigation and Ionic both **keep popped pages in the DOM** until they are
 * popped from the stack, which is why both need an explicit lifecycle API: mount
 * and "enter" genuinely diverge there.
 *
 * nativ does not retain. It uses memory history plus client routing, so a React
 * **unmount is the natural leave** and a mount is the natural enter. That keeps
 * the model predictable and avoids the retained-DOM state bugs Ionic documents —
 * a stale screen still mounted, still holding timers, still subscribed.
 *
 * So this hook exists for symmetry with the mental model, and for a stable place
 * to hang the semantics if that ever changes. It deliberately adds no machinery.
 *
 * ⚠︎ It does **not** fire on background/resume — that is a different event and
 * fires none of React's lifecycle. Use `useOnResume` for that.
 */
export function useScreenLifecycle({
  onEnter,
  onLeave,
}: ScreenLifecycle): void {
  //refs so inline arrows don't retrigger the effect — an onLeave that re-ran on
  //every render would fire on ordinary state changes, not on leaving
  const enterRef = useRef(onEnter)
  const leaveRef = useRef(onLeave)
  enterRef.current = onEnter
  leaveRef.current = onLeave

  useEffect(() => {
    enterRef.current?.()
    return () => leaveRef.current?.()
  }, [])
}
