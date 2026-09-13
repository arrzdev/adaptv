/// <reference lib="webworker" />

import { vi } from "vitest"
import type { Route } from "workbox-routing"
import { Router } from "workbox-routing"

/*
 * A stand-in `ServiceWorkerGlobalScope` for the worker's unit tests.
 *
 * The same move `sw.lifecycle.test.ts` makes with `vi.stubGlobal("self", …)`,
 * grown to what the ROUTED code touches: Workbox reads `self.caches`, the bare
 * `caches`, `location`, `fetch`, and checks `instanceof ExtendableEvent` /
 * `FetchEvent` — none of which happy-dom provides in a worker's shape. Every
 * one of those is stubbed here and restored by `vi.unstubAllGlobals()`.
 *
 * What is deliberately REAL: Workbox's strategies, its `Route` and `Router`
 * (so `registerRoute`'s GET-only default is what decides a POST, not a mock),
 * and adaptv's own plugins. What is fake is only the platform underneath.
 */

export const ORIGIN = "https://app.example"

type Listener = (event: Event) => void

/** Records `waitUntil` so a test can await the work a handler left behind. */
export class TestExtendableEvent extends Event {
  readonly pending: Promise<unknown>[] = []
  waitUntil(work: Promise<unknown>): void {
    this.pending.push(work)
  }
  /** Settle everything handed to `waitUntil`, including work added later. */
  async settled(): Promise<void> {
    let seen = -1
    while (seen !== this.pending.length) {
      seen = this.pending.length
      await Promise.allSettled(this.pending)
    }
  }
}

export class TestFetchEvent extends TestExtendableEvent {
  readonly request: Request
  constructor(request: Request, preloadResponse?: Promise<unknown>) {
    super("fetch")
    this.request = request
    //only DEFINED when the browser has preload — `sw.navigation.ts` tests
    //`"preloadResponse" in event`, which is how Firefox is told apart
    if (preloadResponse !== undefined) {
      Object.defineProperty(this, "preloadResponse", {
        value: preloadResponse,
      })
    }
  }
}

export class TestExtendableMessageEvent extends TestExtendableEvent {
  readonly data: unknown
  constructor(data: unknown) {
    super("message")
    this.data = data
  }
}

/**
 * Cache Storage keyed by URL, honouring `cacheName` in `caches.match` the way
 * the spec does: a named cache that does not exist matches nothing.
 */
export class MemoryCacheStorage {
  readonly buckets = new Map<string, Map<string, Response>>()

  seed(cacheName: string, url: string, response: Response): void {
    this.bucket(cacheName).set(new URL(url, ORIGIN).href, response)
  }

  urlsIn(cacheName: string): string[] {
    return [...(this.buckets.get(cacheName)?.keys() ?? [])]
  }

  private bucket(name: string): Map<string, Response> {
    let bucket = this.buckets.get(name)
    if (!bucket) {
      bucket = new Map()
      this.buckets.set(name, bucket)
    }
    return bucket
  }

  private cacheFor(name: string): Cache {
    const bucket = this.bucket(name)
    const key = (request: RequestInfo | URL) =>
      new URL(
        typeof request === "string" || request instanceof URL
          ? request
          : request.url,
        ORIGIN,
      ).href
    return {
      match: async (request: RequestInfo | URL) =>
        bucket.get(key(request))?.clone(),
      put: async (request: RequestInfo | URL, response: Response) => {
        bucket.set(key(request), response)
      },
      delete: async (request: RequestInfo | URL) =>
        bucket.delete(key(request)),
      keys: async () => [...bucket.keys()].map((url) => new Request(url)),
    } as unknown as Cache
  }

  open = async (name: string): Promise<Cache> => this.cacheFor(name)

  has = async (name: string): Promise<boolean> => this.buckets.has(name)

  keys = async (): Promise<string[]> => [...this.buckets.keys()]

  delete = async (name: string): Promise<boolean> =>
    this.buckets.delete(name)

  match = async (
    request: RequestInfo | URL,
    options: MultiCacheQueryOptions = {},
  ): Promise<Response | undefined> => {
    const names =
      options.cacheName === undefined
        ? [...this.buckets.keys()]
        : this.buckets.has(options.cacheName)
          ? [options.cacheName]
          : []
    for (const name of names) {
      const hit = await this.cacheFor(name).match(request)
      if (hit) return hit
    }
    return undefined
  }
}

export type TestServiceWorkerScope = ReturnType<
  typeof installServiceWorkerScope
>

/** Stub every global the worker reads. Undo with `vi.unstubAllGlobals()`. */
export function installServiceWorkerScope() {
  const listeners = new Map<string, Listener[]>()
  const caches = new MemoryCacheStorage()
  const windows: Array<{ postMessage: ReturnType<typeof vi.fn> }> = []
  const fetch = vi.fn<(input: RequestInfo | URL) => Promise<Response>>(
    () => Promise.reject(new TypeError("no network in this test")),
  )

  const scope = {
    //Workbox's dev-build logger prints route tables on every request
    __WB_DISABLE_DEV_LOGS: true,
    location: new URL(`${ORIGIN}/`),
    caches,
    registration: {
      scope: `${ORIGIN}/`,
      navigationPreload: {
        enable: vi.fn(async () => {}),
        disable: vi.fn(async () => {}),
      },
    },
    clients: {
      claim: vi.fn(async () => {}),
      matchAll: vi.fn(async (_options?: ClientQueryOptions) => [
        ...windows,
      ]),
    },
    skipWaiting: vi.fn(async () => {}),
    addEventListener: (type: string, listener: Listener) => {
      listeners.set(type, [...(listeners.get(type) ?? []), listener])
    },
    removeEventListener: (type: string, listener: Listener) => {
      listeners.set(
        type,
        (listeners.get(type) ?? []).filter((l) => l !== listener),
      )
    },
  }

  vi.stubGlobal("self", scope)
  vi.stubGlobal("caches", caches)
  vi.stubGlobal("location", scope.location)
  vi.stubGlobal("fetch", fetch)
  vi.stubGlobal("ExtendableEvent", TestExtendableEvent)
  vi.stubGlobal("FetchEvent", TestFetchEvent)

  return {
    scope,
    caches,
    fetch,
    listenerCount: (type: string) => listeners.get(type)?.length ?? 0,
    /** Open a window the worker can `postMessage` to. */
    openWindow() {
      const client = { postMessage: vi.fn() }
      windows.push(client)
      return client
    },
    /** Dispatch like the browser: every listener, in registration order. */
    dispatch<E extends Event>(event: E): E {
      for (const listener of listeners.get(event.type) ?? []) {
        listener(event)
      }
      return event
    },
  }
}

/** A real `Request`, with the fields a page cannot set but a browser does. */
export function browserRequest(
  path: string,
  init: {
    method?: string
    mode?: RequestMode
    destination?: RequestDestination
  } = {},
): Request {
  const request = new Request(new URL(path, ORIGIN).href, {
    method: init.method ?? "GET",
  })
  //`mode: "navigate"` is refused by the constructor, and `destination` is not
  //settable at all — both are only ever set by the browser itself
  Object.defineProperty(request, "mode", {
    value: init.mode ?? "cors",
  })
  Object.defineProperty(request, "destination", {
    value: init.destination ?? "",
  })
  return request
}

/**
 * Route `request` through the routes a module registered, with Workbox's real
 * `Router` — including its per-method route table.
 *
 * @returns the response, or `undefined` when no route claimed the request (the
 *   browser would have handled it)
 */
export async function routeThrough(
  routes: readonly Route[],
  event: TestFetchEvent,
): Promise<Response | undefined> {
  const router = new Router()
  for (const route of routes) router.registerRoute(route)
  const response = router.handleRequest({
    request: event.request,
    event: event as unknown as FetchEvent,
  })
  return response
}
