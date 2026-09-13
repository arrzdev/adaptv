import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { LiveReloadHot } from "#adaptv/shell/native-live-reload-client"
import {
  bootWhenNativeShellMatches,
  installNativeLiveReloadRecovery,
} from "#adaptv/shell/native-live-reload-client"

vi.mock("#adaptv/utils/platform", () => ({
  isNativePlatform: () => true,
  getOS: () => "ios",
}))

/** A fake `import.meta.hot` that records its listeners so a test can fire them. */
function fakeHot() {
  const listeners = new Map<string, Array<(data: unknown) => void>>()
  //the real `on` is generic over the event name; the fake records any name
  const hot = {
    on(event: string, cb: (data: unknown) => void) {
      listeners.set(event, [...(listeners.get(event) ?? []), cb])
    },
  } as unknown as LiveReloadHot
  return {
    hot,
    events: () => [...listeners.keys()],
    fire(event: string) {
      for (const cb of listeners.get(event) ?? []) cb(undefined)
    },
  }
}

const reload = vi.fn()
const replace = vi.fn()

beforeEach(() => {
  vi.useFakeTimers()
  reload.mockReset()
  replace.mockReset()
  vi.stubGlobal("location", {
    href: "http://192.168.1.5:41820/",
    host: "192.168.1.5:41820",
    protocol: "http:",
    reload,
    replace,
  })
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => "visible",
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

/** The token scrape fails (the served client has no readable token) and the server is reachable. */
function noTokenServerUp() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === "HEAD")
        return new Response(null, { status: 200 })
      return new Response("// no token in here", { status: 200 })
    }),
  )
}

describe("installNativeLiveReloadRecovery — the dev server's own disconnect event", () => {
  it("subscribes to the dev server's disconnect event, always, before any token is read", () => {
    noTokenServerUp()
    const fake = fakeHot()
    installNativeLiveReloadRecovery(fake.hot)
    //synchronously: the subscription must not wait on the (async) token fetch, or an
    //early drop would be missed the same way a late listener misses the first connect
    expect(fake.events()).toContain("vite:ws:disconnect")
  })

  it("recovers on the event with no token at all: probes the server, then reloads", async () => {
    noTokenServerUp()
    const fake = fakeHot()
    installNativeLiveReloadRecovery(fake.hot)
    await vi.runOnlyPendingTimersAsync()
    expect(reload).not.toHaveBeenCalled()

    fake.fire("vite:ws:disconnect")
    await vi.runOnlyPendingTimersAsync()
    //one HEAD probe of the current document, then the reload — never a blind reload
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    const heads = fetchMock.mock.calls.filter(
      (c) => (c[1] as RequestInit | undefined)?.method === "HEAD",
    )
    expect(heads).toHaveLength(1)
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it("hands off to the offline screen when the probe fails twice, on the local origin", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        if (init?.method === "HEAD") throw new TypeError("Load failed")
        return new Response("// no token", { status: 200 })
      }),
    )
    const fake = fakeHot()
    installNativeLiveReloadRecovery(fake.hot)
    await vi.runOnlyPendingTimersAsync()

    fake.fire("vite:ws:disconnect")
    //first probe fails on fire, second after the deciding poll
    await vi.advanceTimersByTimeAsync(300)
    await vi.runOnlyPendingTimersAsync()
    expect(reload).not.toHaveBeenCalled()
    expect(replace).toHaveBeenCalledWith(
      "capacitor://localhost/adaptv-offline.html",
    )
  })

  it("is idempotent: the event firing twice recovers once", async () => {
    noTokenServerUp()
    const fake = fakeHot()
    installNativeLiveReloadRecovery(fake.hot)
    await vi.runOnlyPendingTimersAsync()
    fake.fire("vite:ws:disconnect")
    fake.fire("vite:ws:disconnect")
    await vi.runOnlyPendingTimersAsync()
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it("does nothing without the dev hook — a production bundle has none", () => {
    noTokenServerUp()
    //`null`, not `undefined`: the parameter defaults to the module's own
    //`import.meta.hot`, which the test runner defines
    installNativeLiveReloadRecovery(null)
    expect(fetch).not.toHaveBeenCalled()
  })
})

describe("bootWhenNativeShellMatches — a stale native build never renders the app", () => {
  const IOS_UA =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 26_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 adaptv-shell/ios-3f9a1c2b"

  /** The dev server answering the shell check with `verdict`; records what was asked. */
  function serverSays(verdict: string) {
    const fetchMock = vi.fn(
      async (_url: string, _init?: RequestInit) =>
        new Response(JSON.stringify({ verdict }), { status: 200 }),
    )
    vi.stubGlobal("fetch", fetchMock)
    return fetchMock
  }

  beforeEach(() => {
    vi.stubGlobal("navigator", { userAgent: IOS_UA })
  })

  it("boots once the dev server confirms this build, asking with the id the WebView carries", async () => {
    const asked = serverSays("match")
    const boot = vi.fn()
    bootWhenNativeShellMatches(boot, fakeHot().hot)
    expect(boot).not.toHaveBeenCalled()
    await vi.runAllTimersAsync()
    expect(boot).toHaveBeenCalledTimes(1)
    expect(replace).not.toHaveBeenCalled()
    expect(asked.mock.calls[0]?.[0]).toBe(
      "/__adaptv/native-shell?id=ios-3f9a1c2b",
    )
  })

  it("never boots a stale build: it waits on the offline screen for the rebuilt app", async () => {
    serverSays("stale")
    const boot = vi.fn()
    bootWhenNativeShellMatches(boot, fakeHot().hot)
    await vi.runAllTimersAsync()
    expect(boot).not.toHaveBeenCalled()
    expect(replace).toHaveBeenCalledWith(
      "capacitor://localhost/adaptv-offline.html",
    )
  })

  it("never boots while the CLI is still deciding, either", async () => {
    serverSays("pending")
    const boot = vi.fn()
    bootWhenNativeShellMatches(boot, fakeHot().hot)
    await vi.runAllTimersAsync()
    expect(boot).not.toHaveBeenCalled()
    expect(replace).toHaveBeenCalledTimes(1)
  })

  it("goes to the offline screen when the server stops answering mid-check", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Load failed")
      }),
    )
    const boot = vi.fn()
    bootWhenNativeShellMatches(boot, fakeHot().hot)
    await vi.runAllTimersAsync()
    expect(boot).not.toHaveBeenCalled()
    expect(replace).toHaveBeenCalledTimes(1)
  })

  it("boots at once, asking nothing, without the dev hook — a production bundle has none", () => {
    const asked = serverSays("stale")
    const boot = vi.fn()
    bootWhenNativeShellMatches(boot, null)
    expect(boot).toHaveBeenCalledTimes(1)
    expect(asked).not.toHaveBeenCalled()
  })
})

describe("production bundle", () => {
  it("guards on the build-time constant before the parameter, so a build folds the client away", async () => {
    // A build replaces `import.meta.hot` with `undefined`; the first statement must be the
    // one that folds to a bare `return`, or the whole client (token regex, offline page,
    // event name) ships in the production assets. Measured 2026-09-02: 1 of 102 assets each
    // with the guard on the parameter alone, 0 with it on the constant.
    const { readFileSync } = await import("node:fs")
    const { resolve } = await import("node:path")
    const source = readFileSync(
      resolve(__dirname, "native-live-reload-client.ts"),
      "utf8",
    )
    const body = source.slice(
      source.indexOf("export function installNativeLiveReloadRecovery("),
    )
    const constantGuard = body.indexOf("if (!import.meta.hot) return")
    const parameterGuard = body.indexOf("if (!hot) return")
    expect(constantGuard).toBeGreaterThan(-1)
    expect(parameterGuard).toBeGreaterThan(constantGuard)
    const beforeGuard = body.slice(0, constantGuard)
    expect(beforeGuard).not.toMatch(
      /\bawait\b|\bfetch\(|\bnew WebSocket\(/,
    )
  })

  it("folds the boot gate to a bare boot() the same way", async () => {
    const { readFileSync } = await import("node:fs")
    const { resolve } = await import("node:path")
    const source = readFileSync(
      resolve(__dirname, "native-live-reload-client.ts"),
      "utf8",
    )
    const body = source.slice(
      source.indexOf("export function bootWhenNativeShellMatches("),
    )
    const constantGuard = body.indexOf("if (!import.meta.hot) {")
    const parameterGuard = body.indexOf("if (!hot ||")
    const request = body.indexOf("fetch(")
    expect(constantGuard).toBeGreaterThan(-1)
    expect(parameterGuard).toBeGreaterThan(constantGuard)
    expect(request).toBeGreaterThan(parameterGuard)
  })
})
