/// <reference lib="webworker" />

import { serviceWorkerScope } from "#adaptv/sw/sw.scope"

/**
 * The worker ⇄ app channel, for modules listed in `serviceWorkers: []`.
 *
 * This exists instead of an "update prompt" API, and the distinction is the whole
 * point. adaptv's own update is invisible and needs no UI (`docs/design/rendering.md §3.4`).
 * What an app's worker actually needs is to *tell the app something* — a push
 * arrived, a background sync finished — and then let React decide what to render,
 * with the app's design system, theme and safe areas. Mechanisms at the JS layer;
 * the platform layer stays dumb.
 */

/** Anything sent across the channel. `type` is required so handlers can switch. */
export type ServiceWorkerMessage = {
  type: string
  [key: string]: unknown
}

/**
 * Message types adaptv reserves for its own worker↔shell protocol, filtered out
 * of {@link onAppMessage} so an app handler never has to know they exist.
 */
const ADAPTV_INTERNAL_TYPES: ReadonlySet<string> = new Set([
  "SKIP_WAITING",
])

/**
 * Broadcast a message to every open window of this app.
 *
 * `includeUncontrolled` is on because the interesting moment is usually the
 * first load, when the page is open but not yet controlled by this worker —
 * excluding it silently drops exactly the messages someone is debugging.
 *
 * @returns how many windows received it
 */
export async function sendToApp(
  message: ServiceWorkerMessage,
): Promise<number> {
  const sw = serviceWorkerScope()
  const clients = await sw.clients.matchAll({
    type: "window",
    includeUncontrolled: true,
  })
  for (const client of clients) client.postMessage(message)
  return clients.length
}

/**
 * Handle messages the app sends with `sendToServiceWorker`.
 *
 * @returns an unsubscribe function
 */
export function onAppMessage(
  handler: (
    message: ServiceWorkerMessage,
    event: ExtendableMessageEvent,
  ) => void,
): () => void {
  const sw = serviceWorkerScope()

  const listener = (event: ExtendableMessageEvent) => {
    const data = event.data as ServiceWorkerMessage | null | undefined
    if (!data || typeof data.type !== "string") return
    if (ADAPTV_INTERNAL_TYPES.has(data.type)) return
    handler(data, event)
  }

  sw.addEventListener("message", listener)
  return () => sw.removeEventListener("message", listener)
}
