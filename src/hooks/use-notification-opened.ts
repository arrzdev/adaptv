import { useEffect, useRef } from "react"
import type { OpenedNotification } from "#adaptv/capabilities/notifications"
import { onNotificationOpened } from "#adaptv/capabilities/notifications"

/**
 * Run something when a notification is tapped.
 *
 * A handler, not a state value: taps are events, and "the last one tapped" as
 * state re-runs whatever the app did with it on every later render. The
 * callback is held in a ref, so passing an inline arrow — the normal way to
 * call this — does not tear the subscription down and build it again each
 * render, which on the web would re-ask the worker for the held tap every time.
 *
 * ```tsx
 * useNotificationOpened(({ data }) => navigate({ to: data.route }))
 * ```
 */
export function useNotificationOpened(
  handler: (opened: OpenedNotification) => void,
): void {
  const handlerRef = useRef(handler)
  handlerRef.current = handler

  useEffect(
    () => onNotificationOpened((opened) => handlerRef.current(opened)),
    [],
  )
}
