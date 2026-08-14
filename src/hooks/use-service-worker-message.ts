import { useEffect, useRef } from "react"

/** Mirrors `ServiceWorkerMessage` on the worker side. */
export type ServiceWorkerMessage = {
  type: string
  [key: string]: unknown
}

/**
 * Send a message to the app's service worker.
 *
 * A no-op when there is no controller — before the first activation, on native,
 * and in dev, where adaptv never registers one. Callers get "nothing happened"
 * rather than a thrown error, because every one of those is a normal state.
 */
export function sendToServiceWorker(message: ServiceWorkerMessage): void {
  if (typeof navigator === "undefined") return
  navigator.serviceWorker?.controller?.postMessage(message)
}

/**
 * Receive messages from the app's own service-worker modules — the ones listed in
 * `serviceWorkers: []` calling `sendToApp`.
 *
 * A handler rather than a returned value, deliberately: messages are **events**,
 * and a "last message" state variable silently drops a burst (two pushes in the
 * same tick render once, and the first is gone).
 *
 * ```tsx
 * useServiceWorkerMessage((message) => {
 *   if (message.type === "push") setBanner(message)
 * })
 * ```
 *
 * Nothing is filtered: adaptv's own worker never broadcasts, so everything that
 * arrives here came from the app's own modules.
 */
export function useServiceWorkerMessage(
  handler: (message: ServiceWorkerMessage) => void,
): void {
  //Held in a ref so an inline arrow — the normal way to call this — does not
  //tear down and re-add the listener on every render.
  const handlerRef = useRef(handler)
  handlerRef.current = handler

  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.serviceWorker)
      return

    const listener = (event: MessageEvent) => {
      const data = event.data as ServiceWorkerMessage | null | undefined
      if (!data || typeof data.type !== "string") return
      handlerRef.current(data)
    }

    navigator.serviceWorker.addEventListener("message", listener)
    return () =>
      navigator.serviceWorker.removeEventListener("message", listener)
  }, [])
}
