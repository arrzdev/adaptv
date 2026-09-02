import { afterEach, describe, expect, it, vi } from "vitest"
import {
  NOTIFICATION_OPENED,
  NOTIFICATION_OPENED_QUERY,
} from "#adaptv/sw/sw.notification-protocol"
import { registerNotificationOpenRoute } from "#adaptv/sw/sw.notifications"

type Listener = (event: unknown) => void

const SCOPE = "https://app.example/"

/** A worker scope whose every effect is observable. */
function workerScope(windows: number) {
  const listeners = new Map<string, Listener[]>()
  const opened: string[] = []
  const clients = Array.from({ length: windows }, () => ({
    focused: false,
    posted: [] as unknown[],
    focus() {
      this.focused = true
      return Promise.resolve(this)
    },
    postMessage(message: unknown) {
      this.posted.push(message)
    },
  }))

  vi.stubGlobal("self", {
    addEventListener(type: string, fn: Listener) {
      const list = listeners.get(type) ?? []
      list.push(fn)
      listeners.set(type, list)
    },
    clients: {
      matchAll: () => Promise.resolve(clients),
      openWindow: (url: string) => {
        opened.push(url)
        return Promise.resolve(null)
      },
    },
    registration: { scope: SCOPE },
  })

  registerNotificationOpenRoute()

  const fire = (type: string, event: unknown) => {
    for (const fn of listeners.get(type) ?? []) fn(event)
  }

  return {
    clients,
    opened,
    /** Tap a notification; resolves when the handler's own work is done. */
    async click(notification: { data?: unknown; tag?: string }) {
      const kept: Promise<unknown>[] = []
      let closed = false
      fire("notificationclick", {
        notification: {
          ...notification,
          close: () => {
            closed = true
          },
        },
        waitUntil: (work: Promise<unknown>) => kept.push(work),
      })
      await Promise.all(kept)
      return { closed }
    },
    /** Ask, as the page does on subscribe. Returns what the worker replied. */
    ask(type: string = NOTIFICATION_OPENED_QUERY) {
      const replies: unknown[] = []
      fire("message", {
        data: { type },
        source: { postMessage: (m: unknown) => replies.push(m) },
      })
      return replies
    },
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("registerNotificationOpenRoute — a window is open", () => {
  it("focuses it, hands over the payload, and closes the banner", async () => {
    const sw = workerScope(1)
    const { closed } = await sw.click({
      data: { id: 42, data: { route: "/inbox" } },
      tag: "42",
    })
    expect(closed).toBe(true)
    expect(sw.clients[0].focused).toBe(true)
    expect(sw.clients[0].posted).toEqual([
      { type: NOTIFICATION_OPENED, id: 42, data: { route: "/inbox" } },
    ])
    expect(sw.opened).toEqual([])
  })

  it("falls back to the tag when there is no payload", async () => {
    const sw = workerScope(1)
    await sw.click({ tag: "7" })
    expect(sw.clients[0].posted).toEqual([
      { type: NOTIFICATION_OPENED, id: 7, data: {} },
    ])
  })
})

describe("registerNotificationOpenRoute — nothing is open", () => {
  it("starts the app and holds the tap until the page asks", async () => {
    const sw = workerScope(0)
    await sw.click({ data: { id: 9, data: { route: "/x" } }, tag: "9" })
    expect(sw.opened).toEqual([SCOPE])
    expect(sw.ask()).toEqual([
      { type: NOTIFICATION_OPENED, id: 9, data: { route: "/x" } },
    ])
  })

  it("hands the same tap over once, never twice", async () => {
    const sw = workerScope(0)
    await sw.click({ data: { id: 9, data: {} }, tag: "9" })
    expect(sw.ask()).toHaveLength(1)
    //a later reload asks again; replaying would re-navigate an app the user
    //has since moved on from
    expect(sw.ask()).toEqual([])
  })

  it("answers nothing when no tap is held, and ignores other messages", async () => {
    const sw = workerScope(0)
    expect(sw.ask()).toEqual([])
    await sw.click({ data: { id: 3, data: {} }, tag: "3" })
    expect(sw.ask("SKIP_WAITING")).toEqual([])
  })
})
