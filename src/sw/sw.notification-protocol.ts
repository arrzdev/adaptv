//The one shape a tapped notification travels in, shared by the worker that
//sends it and the page that receives it.
//
//It lives in its own module because the two halves are in different bundles:
//`sw.notifications.ts` runs inside the worker and touches `self`, the
//capability runs in the page. A page that imported the worker module to read a
//string constant would pull a `ServiceWorkerGlobalScope` reference into the app
//bundle. Nothing here touches either global, so both sides can have it.

/** What the app learns when someone taps a notification. */
export interface OpenedNotification {
  id: number
  /** Whatever `notify` was given as `data`; `{}` when it was given none. */
  data: Record<string, string>
}

/** Worker to page: someone tapped one. */
export const NOTIFICATION_OPENED = "ADAPTV_NOTIFICATION_OPENED"

/**
 * Page to worker: was one tapped before I was listening?
 *
 * A tap on a notification with no window open starts the app, and the page
 * cannot subscribe until it has booted — by which time a plain broadcast is
 * long gone. So the worker holds the last tap and the page asks for it as its
 * first act. → `sw.notifications.ts`
 */
export const NOTIFICATION_OPENED_QUERY = "ADAPTV_NOTIFICATION_OPENED_QUERY"

/**
 * Message types adaptv's own worker broadcasts, filtered out of
 * `useServiceWorkerMessage` so an app handler never sees the framework's
 * traffic. The capability that owns each one delivers it instead.
 */
export const ADAPTV_BROADCAST_TYPES: ReadonlySet<string> = new Set([
  NOTIFICATION_OPENED,
])

/** The wire form of a tap. */
export function openedMessage(opened: OpenedNotification) {
  return {
    type: NOTIFICATION_OPENED,
    id: opened.id,
    data: opened.data,
  } as const
}

/**
 * Read a tap off the wire, or `null` if this is not one.
 *
 * Validating rather than casting: this listener sees every message any of the
 * app's own worker modules broadcasts, and one of them is free to send
 * `{ type: "ADAPTV_NOTIFICATION_OPENED" }` with a string id by accident.
 */
export function readOpenedMessage(
  message: unknown,
): OpenedNotification | null {
  if (!message || typeof message !== "object") return null
  const m = message as Record<string, unknown>
  if (m.type !== NOTIFICATION_OPENED) return null
  if (typeof m.id !== "number" || !Number.isFinite(m.id)) return null
  const data: Record<string, string> = {}
  if (m.data && typeof m.data === "object")
    for (const [key, value] of Object.entries(
      m.data as Record<string, unknown>,
    ))
      if (typeof value === "string") data[key] = value
  return { id: m.id, data }
}
