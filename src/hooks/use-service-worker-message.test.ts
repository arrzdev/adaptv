import { cleanup, renderHook } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  sendToServiceWorker,
  useServiceWorkerMessage,
} from "#adaptv/hooks/use-service-worker-message"

//`navigator.serviceWorker` is an EventTarget in every browser; a real one here
//(rather than a record of calls) means the dispatch path is the browser's own.
function stubServiceWorker(
  controller: { postMessage: () => void } | null,
) {
  const container = Object.assign(new EventTarget(), { controller })
  vi.stubGlobal(
    "navigator",
    Object.assign(Object.create(navigator), { serviceWorker: container }),
  )
  return container
}

function post(container: EventTarget, data: unknown): void {
  container.dispatchEvent(new MessageEvent("message", { data }))
}

afterEach(() => {
  //unmount while the stub is still in place: the cleanup reads
  //`navigator.serviceWorker` again, which a browser keeps as one object for the
  //page's life but this file swaps out from under it
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("useServiceWorkerMessage", () => {
  it("delivers every typed message in a burst, and drops what has no string type", () => {
    const container = stubServiceWorker(null)
    const received: unknown[] = []
    renderHook(() => useServiceWorkerMessage((m) => received.push(m)))

    //two in the same tick — a handler, unlike a "last message" state, loses neither
    post(container, { type: "push", id: 1 })
    post(container, { type: "push", id: 2 })
    post(container, null)
    post(container, "push")
    post(container, { type: 7 })

    expect(received).toEqual([
      { type: "push", id: 1 },
      { type: "push", id: 2 },
    ])
  })

  it("calls the latest handler without re-adding, and removes the same listener on unmount", () => {
    const container = stubServiceWorker(null)
    const add = vi.spyOn(container, "addEventListener")
    const remove = vi.spyOn(container, "removeEventListener")
    const first = vi.fn()
    const latest = vi.fn()

    const { rerender, unmount } = renderHook(
      ({ handler }: { handler: (m: unknown) => void }) =>
        useServiceWorkerMessage(handler),
      { initialProps: { handler: first } },
    )
    rerender({ handler: latest })
    post(container, { type: "ping" })

    expect(add).toHaveBeenCalledTimes(1)
    expect(first).not.toHaveBeenCalled()
    expect(latest).toHaveBeenCalledWith({ type: "ping" })

    unmount()
    const [, listener] = add.mock.calls[0] ?? []
    expect(remove).toHaveBeenCalledWith("message", listener)
    post(container, { type: "ping" })
    expect(latest).toHaveBeenCalledTimes(1)
  })

  it("is a quiet no-op without a service worker container", () => {
    vi.stubGlobal(
      "navigator",
      Object.assign(Object.create(navigator), {
        serviceWorker: undefined,
      }),
    )
    const handler = vi.fn()
    const { unmount } = renderHook(() => useServiceWorkerMessage(handler))
    unmount()
    expect(() => sendToServiceWorker({ type: "x" })).not.toThrow()
  })
})

describe("sendToServiceWorker", () => {
  it("posts to the controller when there is one, and does nothing before activation", () => {
    const controller = { postMessage: vi.fn() }
    stubServiceWorker(controller)
    sendToServiceWorker({ type: "sync", tag: "outbox" })
    expect(controller.postMessage).toHaveBeenCalledWith({
      type: "sync",
      tag: "outbox",
    })

    stubServiceWorker(null)
    expect(() => sendToServiceWorker({ type: "sync" })).not.toThrow()
  })
})
