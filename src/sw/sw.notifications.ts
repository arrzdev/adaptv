/// <reference lib="webworker" />

import type { OpenedNotification } from "#adaptv/sw/sw.notification-protocol"
import {
  NOTIFICATION_OPENED_QUERY,
  openedMessage,
} from "#adaptv/sw/sw.notification-protocol"
import { serviceWorkerScope } from "#adaptv/sw/sw.scope"

/**
 * The tap half of the web notification path.
 *
 * A notification the page showed is not the page: it outlives it. The tap
 * arrives at the **worker**, as `notificationclick`, and the browser will
 * happily leave it unhandled — the banner closes and nothing else happens,
 * which is the default every app has to undo by hand. adaptv's own worker
 * handles it, because a notification nobody can act on is not a capability.
 *
 * Two cases, and the second is the one that is usually skipped:
 *
 *  • a window is open → focus it and post the payload. The app is already
 *    listening, so the callback fires in the same breath.
 *  • no window is open → the tap has to START the app, and the page cannot
 *    subscribe until it has booted. A broadcast at click time would be sent
 *    into an empty room. So the tap is held here and handed over when the page
 *    asks for it, which `onNotificationOpened` does as its first act.
 *
 * The held tap is worker memory, and a worker is allowed to be killed between
 * the click and the page's question. In practice it is alive: the click is what
 * woke it. If it is not, the app starts and hears nothing, which is exactly
 * what would have happened without any of this.
 */

//The last tap, waiting for a page to ask. Cleared once handed over so a later
//reload does not replay a tap the app already acted on.
let pending: OpenedNotification | null = null

function readNotification(notification: Notification): OpenedNotification {
  const raw = (notification.data ?? {}) as Record<string, unknown>
  const data: Record<string, string> = {}
  const carried = raw.data
  if (carried && typeof carried === "object")
    for (const [key, value] of Object.entries(
      carried as Record<string, unknown>,
    ))
      if (typeof value === "string") data[key] = value
  //`notify` sets both; the tag is the fallback because a notification shown by
  //an app's own worker module still deserves to be tappable.
  const id =
    typeof raw.id === "number" ? raw.id : Number(notification.tag || 0)
  return { id: Number.isFinite(id) ? id : 0, data }
}

async function deliver(opened: OpenedNotification): Promise<void> {
  const sw = serviceWorkerScope()
  const clients = await sw.clients.matchAll({
    type: "window",
    includeUncontrolled: true,
  })
  const focused = clients[0]
  if (focused) {
    //Focus first: the postMessage lands either way, but a tap that does not
    //bring the app forward reads as a tap that did nothing.
    if (typeof focused.focus === "function") {
      try {
        await focused.focus()
      } catch {}
    }
    focused.postMessage(openedMessage(opened))
    return
  }
  pending = opened
  try {
    await sw.clients.openWindow(sw.registration.scope)
  } catch {}
}

/**
 * Handle taps on notifications this app showed. Registered by adaptv's worker;
 * an app's own worker modules need not know it exists.
 */
export function registerNotificationOpenRoute(): void {
  const sw = serviceWorkerScope()

  sw.addEventListener("notificationclick", (event) => {
    const opened = readNotification(event.notification)
    //Closing is on us: a handled click leaves the banner up otherwise, and the
    //user taps a second time into an app that is already open.
    event.notification.close()
    event.waitUntil(deliver(opened))
  })

  sw.addEventListener("message", (event) => {
    const data = event.data as { type?: unknown } | null | undefined
    if (!data || data.type !== NOTIFICATION_OPENED_QUERY) return
    const held = pending
    pending = null
    if (!held) return
    const source = event.source
    if (source && "postMessage" in source)
      source.postMessage(openedMessage(held))
  })
}
