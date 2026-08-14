import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { NavigationRequestIO } from "#adaptv/sw/sw.navigation"
import {
  isDeniedPath,
  isFileLikePath,
  mayServeAppShell,
  serveNavigation,
} from "#adaptv/sw/sw.navigation"

const TIMEOUT_MS = 3000

function html(body: string): Response {
  return new Response(body, { headers: { "content-type": "text/html" } })
}

/** A navigation whose every input is explicit; override only what a test is about. */
function io(overrides: Partial<NavigationRequestIO> = {}) {
  const kept: Promise<unknown>[] = []
  const calls = { fetch: 0, shell: 0 }
  const base: NavigationRequestIO = {
    fetch: () => {
      calls.fetch += 1
      return Promise.resolve(html("network"))
    },
    shell: () => {
      calls.shell += 1
      return Promise.resolve(html("shell"))
    },
    keepAlive: (work) => {
      kept.push(work)
    },
    timeoutMs: TIMEOUT_MS,
  }
  return { input: { ...base, ...overrides }, kept, calls }
}

/** Resolve after `ms` of *fake* time — the deadline is the thing under test. */
function resolvesAfter<T>(ms: number, value: T): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms))
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe("isFileLikePath — a dotted last segment is a file", () => {
  it("is true for anything whose last segment has a dot", () => {
    //`mode: "navigate"` is what a browser sends for a plain LINK to a file, and
    //none of these is in the precache glob (§3.2), so there is nothing the SW
    //could honestly serve them from
    for (const path of [
      "/whitepaper.pdf",
      "/sitemap.xml",
      "/feed.rss",
      "/downloads/report.2024.xlsx",
    ]) {
      expect(isFileLikePath(path)).toBe(true)
    }
  })

  it("only looks at the LAST segment", () => {
    //the cost of the heuristic is bounded: a dot earlier in the path is still a
    //navigation, so a versioned prefix does not lose the SW
    expect(isFileLikePath("/v1.2/docs")).toBe(false)
    expect(isFileLikePath("/docs.old/getting-started")).toBe(false)
    expect(isFileLikePath("/")).toBe(false)
    expect(isFileLikePath("/settings")).toBe(false)
    //...and the acknowledged cost itself: a route ending in a dotted segment is
    //read as a file. Angular's ngsw makes the same trade.
    expect(isFileLikePath("/blog/hello.world")).toBe(true)
  })
})

describe("isDeniedPath — what the SW must not touch at all", () => {
  it("keeps the API, asset and server-function prefixes out", () => {
    expect(isDeniedPath("/api/session")).toBe(true)
    expect(isDeniedPath("/assets/chunk")).toBe(true)
    expect(isDeniedPath("/_serverFn/todos")).toBe(true)
    expect(isDeniedPath("/settings")).toBe(false)
  })

  it("lets an app replace the prefixes entirely", () => {
    expect(isDeniedPath("/api/session", ["/auth/"])).toBe(false)
    expect(isDeniedPath("/auth/callback", ["/auth/"])).toBe(true)
  })
})

describe("mayServeAppShell — the rule the two modes apply differently", () => {
  it("allows ordinary routes", () => {
    for (const path of ["/", "/settings", "/todos/42", "/v1.2/docs"]) {
      expect(mayServeAppShell(path)).toBe(true)
    }
  })

  it("refuses to answer a file link with the shell", () => {
    //in `spa` this is the whole route decision; in `ssr` it only removes the
    //fallback, because the network is tried first either way
    expect(mayServeAppShell("/whitepaper.pdf")).toBe(false)
    expect(mayServeAppShell("/sitemap.xml")).toBe(false)
  })

  it("refuses denied prefixes too", () => {
    expect(mayServeAppShell("/api/session")).toBe(false)
  })

  it("keeps the file rule even when an app replaces the prefixes", () => {
    //prefixes are a policy an app can hold differently; the file rule is a fact
    //about what `mode: "navigate"` means, so it is not negotiable
    expect(mayServeAppShell("/whitepaper.pdf", [])).toBe(false)
  })
})

describe("serveNavigation — the preload half of Navigation Preload", () => {
  it("serves the preload the browser already started, and never re-fetches", async () => {
    //this is the entire point: the request left before the worker booted, so
    //fetching again would throw away the parallelism AND double the load
    const { input, calls } = io({
      preload: Promise.resolve(html("preloaded")),
    })
    const response = await serveNavigation(input)
    await expect(response.text()).resolves.toBe("preloaded")
    expect(calls.fetch).toBe(0)
    expect(calls.shell).toBe(0)
  })

  it("fetches normally when the preload resolves undefined", async () => {
    //`preloadResponse` resolves undefined whenever the browser did NOT preload
    //this navigation — no support, or `enable()` has not applied yet. Reading
    //that as "the network failed" would serve a cold shell boot to an ONLINE
    //user with a working server, on the first navigation after every install.
    const { input, calls } = io({ preload: Promise.resolve(undefined) })
    const response = await serveNavigation(input)
    await expect(response.text()).resolves.toBe("network")
    expect(calls.fetch).toBe(1)
    expect(calls.shell).toBe(0)
  })

  it("fetches normally on a browser with no preload at all", async () => {
    const { input, calls } = io()
    const response = await serveNavigation(input)
    await expect(response.text()).resolves.toBe("network")
    expect(calls.fetch).toBe(1)
  })

  it("does not hold the event open when the network wins", async () => {
    const { input, kept } = io({
      preload: Promise.resolve(html("preloaded")),
    })
    await serveNavigation(input)
    expect(kept).toEqual([])
  })
})

describe("serveNavigation — falling back to the shell", () => {
  it("serves the shell when the preload rejects", async () => {
    const { input, calls } = io({
      preload: Promise.reject(new Error("net::ERR_INTERNET_DISCONNECTED")),
    })
    const response = await serveNavigation(input)
    await expect(response.text()).resolves.toBe("shell")
    //a preload rejection IS the network attempt failing — retrying it offline
    //only delays the boot the user is waiting for
    expect(calls.fetch).toBe(0)
  })

  it("serves the shell when the plain fetch rejects", async () => {
    const { input } = io({
      fetch: () => Promise.reject(new Error("offline")),
    })
    const response = await serveNavigation(input)
    await expect(response.text()).resolves.toBe("shell")
  })

  it("gives up on the deadline rather than hanging on a live-but-dead network", async () => {
    const { input, calls } = io({
      fetch: () => resolvesAfter(TIMEOUT_MS + 1000, html("far too late")),
    })
    const pending = serveNavigation(input)
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS)
    await expect((await pending).text()).resolves.toBe("shell")
    expect(calls.shell).toBe(1)
  })

  it("holds the event open for the preload it abandoned", async () => {
    //dropping the FetchEvent while `preloadResponse` is still in flight cancels
    //the browser's request and logs "the service worker navigation preload
    //request was cancelled before 'preloadResponse' settled" — on a slow
    //navigation that is behaving exactly as designed
    const { input, kept } = io({
      preload: resolvesAfter(TIMEOUT_MS + 1000, html("far too late")),
    })
    const pending = serveNavigation(input)
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS)
    await pending
    expect(kept).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(2000)
    await expect(kept[0]).resolves.toBeInstanceOf(Response)
  })

  it("swallows a network failure that arrives after the shell was served", async () => {
    //the race is already settled by then, so nothing is listening — an unhandled
    //rejection inside a service worker is not recoverable from the page
    const { input } = io({
      fetch: () =>
        new Promise((_, reject) =>
          setTimeout(
            () => reject(new Error("late failure")),
            TIMEOUT_MS + 500,
          ),
        ),
    })
    const pending = serveNavigation(input)
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS)
    await expect((await pending).text()).resolves.toBe("shell")
    await vi.advanceTimersByTimeAsync(1000)
  })

  it("returns a network error when even the shell is gone", async () => {
    //storage evicted mid-session: there is genuinely nothing to serve, and the
    //browser's own error page is the honest outcome
    const { input } = io({
      fetch: () => Promise.reject(new Error("offline")),
      shell: () => Promise.resolve(undefined),
    })
    const response = await serveNavigation(input)
    expect(response.type).toBe("error")
  })
})
