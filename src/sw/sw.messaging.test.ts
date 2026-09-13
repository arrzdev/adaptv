/// <reference lib="webworker" />

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { registerServiceWorkerLifecycle } from "#adaptv/sw/sw.lifecycle"
import type { ServiceWorkerMessage } from "#adaptv/sw/sw.messaging"
import { onAppMessage, sendToApp } from "#adaptv/sw/sw.messaging"
import type { TestServiceWorkerScope } from "#adaptv/sw/sw.test-helper"
import {
  installServiceWorkerScope,
  TestExtendableMessageEvent,
} from "#adaptv/sw/sw.test-helper"
import { adaptvPwaRegisterPlugin } from "#adaptv/vite/virtuals"

/*
 * The worker ⇄ app channel for modules in `serviceWorkers: []`, and the one
 * message adaptv reserves on the same channel for itself.
 * → `docs/design/rendering.md §3` ("The worker side talks to React with
 *   `sendToApp` / `onAppMessage`") and §3.4 (the SKIP_WAITING apply path)
 */

let sw: TestServiceWorkerScope

beforeEach(() => {
  sw = installServiceWorkerScope()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function receive(data: unknown) {
  return sw.dispatch(new TestExtendableMessageEvent(data))
}

/** The message the shell posts to apply a waiting worker, read from its source. */
function shellApplyMessageType(): string {
  const plugin = adaptvPwaRegisterPlugin(true)
  // biome-ignore lint/suspicious/noExplicitAny: calling Vite hooks outside Vite
  const hooks = plugin as any
  const resolved = hooks.resolveId.call({}, "virtual:adaptv/pwa-register")
  const source = hooks.load.call({}, resolved) as string
  const posted = /worker\.postMessage\(\{ type: "([^"]+)" \}\)/.exec(
    source,
  )
  if (!posted)
    throw new Error("the shell no longer posts an apply message")
  return posted[1]
}

describe("sendToApp — worker to every window", () => {
  it("posts to every window and reports how many got it", async () => {
    const first = sw.openWindow()
    const second = sw.openWindow()
    const message = { type: "push", title: "Hi" }

    await expect(sendToApp(message)).resolves.toBe(2)
    expect(first.postMessage).toHaveBeenCalledWith(message)
    expect(second.postMessage).toHaveBeenCalledWith(message)
  })

  it("includes windows this worker does not control yet", async () => {
    //the first load is open but not yet controlled — excluding it silently
    //drops exactly the messages someone is debugging
    await sendToApp({ type: "push" })
    expect(sw.scope.clients.matchAll).toHaveBeenCalledWith({
      type: "window",
      includeUncontrolled: true,
    })
  })

  it("reports 0 with no window open, rather than failing", async () => {
    await expect(sendToApp({ type: "push" })).resolves.toBe(0)
  })
})

describe("onAppMessage — app to worker", () => {
  it("hands the handler the message and the event it came on", () => {
    const handler = vi.fn()
    onAppMessage(handler)
    const event = receive({ type: "sync-now", id: 7 })
    expect(handler).toHaveBeenCalledOnce()
    expect(handler).toHaveBeenCalledWith(
      { type: "sync-now", id: 7 },
      event,
    )
  })

  it("delivers message types adaptv has never heard of", () => {
    //the channel is the app's: nothing is an "unknown" type to it
    const seen: ServiceWorkerMessage[] = []
    onAppMessage((message) => seen.push(message))
    receive({ type: "a" })
    receive({ type: "totally-unknown", payload: [1, 2] })
    expect(seen.map((m) => m.type)).toEqual(["a", "totally-unknown"])
  })

  it("ignores anything without a string `type`", () => {
    //the handler is typed as receiving a `type`; anything else would reach a
    //`switch (message.type)` as a lie
    const handler = vi.fn()
    onAppMessage(handler)
    for (const data of [
      null,
      undefined,
      "SKIP_WAITING",
      42,
      {},
      { type: 1 },
    ]) {
      receive(data)
    }
    expect(handler).not.toHaveBeenCalled()
  })

  it("never shows the app adaptv's own SKIP_WAITING", () => {
    const handler = vi.fn()
    onAppMessage(handler)
    receive({ type: "SKIP_WAITING" })
    expect(handler).not.toHaveBeenCalled()
  })

  it("stops delivering after unsubscribe", () => {
    const handler = vi.fn()
    const unsubscribe = onAppMessage(handler)
    receive({ type: "one" })
    unsubscribe()
    receive({ type: "two" })
    expect(handler).toHaveBeenCalledOnce()
    expect(sw.listenerCount("message")).toBe(0)
  })
})

describe("the shared channel — adaptv's apply message and the app's own", () => {
  it("the shell's apply message is the one the worker obeys and the app never sees", () => {
    //three files spell this string: the shell that posts it, the lifecycle
    //that obeys it, and the filter that hides it. If any one drifts, a waiting
    //worker is never applied — the one update failure no later deploy can fix
    const type = shellApplyMessageType()
    registerServiceWorkerLifecycle()
    const handler = vi.fn()
    onAppMessage(handler)

    receive({ type })

    expect(sw.scope.skipWaiting).toHaveBeenCalledOnce()
    expect(handler).not.toHaveBeenCalled()
  })

  it("an app message does not apply the waiting worker", () => {
    registerServiceWorkerLifecycle()
    const handler = vi.fn()
    onAppMessage(handler)

    receive({ type: "skip-waiting" })
    receive({ type: "PING" })
    receive(null)

    expect(sw.scope.skipWaiting).not.toHaveBeenCalled()
    expect(handler).toHaveBeenCalledTimes(2)
  })
})
