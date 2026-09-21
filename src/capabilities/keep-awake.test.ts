import { afterEach, describe, expect, it, vi } from "vitest"
import {
  getKeepAwakeCaveat,
  isKeepAwakeActive,
  isKeepAwakeSupported,
  releaseKeepAwake,
  requestKeepAwake,
  subscribeKeepAwake,
} from "#adaptv/capabilities/keep-awake"

const restores: Array<() => void> = []

function forceNative(native: boolean): void {
  vi.stubGlobal(
    "Capacitor",
    native ? { isNativePlatform: () => true } : undefined,
  )
}

function stubNavigatorProp(key: string, value: unknown): void {
  const prev = Object.getOwnPropertyDescriptor(navigator, key)
  Object.defineProperty(navigator, key, { value, configurable: true })
  restores.push(() => {
    if (prev) Object.defineProperty(navigator, key, prev)
    else delete (navigator as unknown as Record<string, unknown>)[key]
  })
}

type FakeSentinel = {
  released: boolean
  release: () => Promise<void>
  addEventListener: (type: "release", listener: () => void) => void
  /** Simulate the platform dropping the lock (tab switch, screen off). */
  drop: () => void
}

function fakeSentinel(): FakeSentinel {
  const handlers: Array<() => void> = []
  const sentinel: FakeSentinel = {
    released: false,
    release: () => {
      sentinel.released = true
      return Promise.resolve()
    },
    addEventListener: (_type, listener) => handlers.push(listener),
    drop: () => {
      sentinel.released = true
      for (const handler of handlers) handler()
    },
  }
  return sentinel
}

/** Install a wake-lock API. `null` ⇒ the API is absent entirely. */
function stubWakeLock(
  request: (() => Promise<FakeSentinel>) | null,
): void {
  stubNavigatorProp("wakeLock", request ? { request } : undefined)
}

afterEach(async () => {
  await releaseKeepAwake()
  for (const r of restores.splice(0)) r()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe("keep-awake — no API at all", () => {
  it("reports unsupported and returns a value instead of throwing", async () => {
    forceNative(false)
    stubWakeLock(null)
    expect(isKeepAwakeSupported()).toBe(false)
    await expect(requestKeepAwake()).resolves.toBe("unsupported")
    expect(isKeepAwakeActive()).toBe(false)
  })

  it("has no caveat when it is already reporting unsupported", () => {
    //the probe has said everything there is to say; a second warning next to a
    //control that isn't rendered would be noise
    forceNative(false)
    stubWakeLock(null)
    expect(getKeepAwakeCaveat()).toBeNull()
  })
})

describe("keep-awake — the silent-failure caveat", () => {
  it("warns on iOS below 18.4, where the lock resolves but the screen dims", () => {
    //WebKit 254545 — a Home Screen Web App got a WakeLockSentinel and dimmed
    //anyway. JS cannot observe that, so the caveat is the only honest channel.
    forceNative(false)
    stubNavigatorProp(
      "userAgent",
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X)",
    )
    stubWakeLock(() => Promise.resolve(fakeSentinel()))
    expect(getKeepAwakeCaveat()).toMatch(/254545/)
  })

  it("drops the warning once iOS is new enough", () => {
    forceNative(false)
    stubNavigatorProp(
      "userAgent",
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_4 like Mac OS X)",
    )
    stubWakeLock(() => Promise.resolve(fakeSentinel()))
    expect(getKeepAwakeCaveat()).toBeNull()
  })

  it("has no caveat in the native Android app, where the lock holds the screen", () => {
    //2026-09-02, Pixel 10 emulator API 36, WebView Chrome/149: `dumpsys power`
    //shows the SCREEN_BRIGHT_WAKE_LOCK row while held and none after release
    forceNative(true)
    stubNavigatorProp(
      "userAgent",
      "Mozilla/5.0 (Linux; Android 16; Pixel 10) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.7827.5 Mobile Safari/537.36",
    )
    stubWakeLock(() => Promise.resolve(fakeSentinel()))
    expect(getKeepAwakeCaveat()).toBeNull()
  })

  it("has no caveat in the native iOS app, even below 18.4", () => {
    //WebKit 254545 is a Home Screen web app bug (a ViewService with no
    //UIApplication). A Capacitor app has one and takes WebCore's own
    //ScreenSleepDisabler exactly as Safari does, so the version branch is
    //web-only and must not fire here.
    forceNative(true)
    stubNavigatorProp(
      "userAgent",
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X)",
    )
    stubWakeLock(() => Promise.resolve(fakeSentinel()))
    expect(getKeepAwakeCaveat()).toBeNull()
  })
})

describe("keep-awake — holding and releasing", () => {
  it("holds, reports active, and releases", async () => {
    forceNative(false)
    const sentinel = fakeSentinel()
    stubWakeLock(() => Promise.resolve(sentinel))

    await expect(requestKeepAwake()).resolves.toBe("held")
    expect(isKeepAwakeActive()).toBe(true)

    await releaseKeepAwake()
    expect(isKeepAwakeActive()).toBe(false)
    expect(sentinel.released).toBe(true)
  })

  it("returns 'rejected' — not 'unsupported' — when the platform refuses", async () => {
    //power-save mode / low battery / hidden document: the API is there and a
    //retry can succeed, which is a different UI from "your device can't do this"
    forceNative(false)
    stubWakeLock(() => Promise.reject(new Error("NotAllowedError")))
    await expect(requestKeepAwake()).resolves.toBe("rejected")
    expect(isKeepAwakeActive()).toBe(false)
  })

  it("notifies subscribers when the platform drops the lock itself", async () => {
    forceNative(false)
    const sentinel = fakeSentinel()
    stubWakeLock(() => Promise.resolve(sentinel))
    const cb = vi.fn()
    const unsub = subscribeKeepAwake(cb)

    await requestKeepAwake()
    cb.mockClear()

    sentinel.drop()
    expect(cb).toHaveBeenCalled()
    expect(isKeepAwakeActive()).toBe(false)
    unsub()
  })

  it("re-acquires when the app comes back to the foreground", async () => {
    //the platform releases the lock on every hide and never restores it, so
    //without this "keep the screen on" silently expires on the first tab switch
    forceNative(false)
    const issued: FakeSentinel[] = []
    const request = vi.fn(() => {
      const next = fakeSentinel()
      issued.push(next)
      return Promise.resolve(next)
    })
    stubWakeLock(request)

    await requestKeepAwake()
    expect(request).toHaveBeenCalledTimes(1)

    //hiding the document drops the lock — exactly what the platform does
    issued[0].drop()
    expect(isKeepAwakeActive()).toBe(false)

    document.dispatchEvent(new Event("visibilitychange"))
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2))
  })

  it("does not re-acquire after an explicit release", async () => {
    forceNative(false)
    const request = vi.fn(() => Promise.resolve(fakeSentinel()))
    stubWakeLock(request)

    await requestKeepAwake()
    await releaseKeepAwake()
    document.dispatchEvent(new Event("visibilitychange"))

    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(request).toHaveBeenCalledTimes(1)
  })
})

describe("keep-awake — a request that resolves late", () => {
  /** A wake-lock API whose every request waits for the test to answer it. */
  function deferredWakeLock(): {
    request: ReturnType<typeof vi.fn>
    resolvers: Array<(sentinel: FakeSentinel) => void>
  } {
    const resolvers: Array<(sentinel: FakeSentinel) => void> = []
    const request = vi.fn(
      () =>
        new Promise<FakeSentinel>((resolve) => {
          resolvers.push(resolve)
        }),
    )
    stubWakeLock(request)
    return { request, resolvers }
  }

  it("lets go of a sentinel that arrives after the release", async () => {
    //request, then release before the platform answers: the intent is gone,
    //so the late sentinel must not become a lock nothing will ever release
    forceNative(false)
    const { request, resolvers } = deferredWakeLock()

    const pending = requestKeepAwake()
    expect(request).toHaveBeenCalledTimes(1)
    await releaseKeepAwake()
    expect(isKeepAwakeActive()).toBe(false)

    const late = fakeSentinel()
    resolvers[0](late)
    await expect(pending).resolves.toBe("rejected")
    expect(isKeepAwakeActive()).toBe(false)
    expect(late.released).toBe(true)
  })

  it("swallows a refused release of the surplus sentinel", async () => {
    //the platform can refuse to release a sentinel it already let go of;
    //nobody asked for that sentinel any more, so its rejection reaches no one
    forceNative(false)
    const { resolvers } = deferredWakeLock()
    const refused: unknown[] = []
    const onRefused = (reason: unknown) => refused.push(reason)
    process.on("unhandledRejection", onRefused)

    const pending = requestKeepAwake()
    await releaseKeepAwake()
    const late = fakeSentinel()
    late.release = () => {
      late.released = true
      return Promise.reject(new Error("NotAllowedError"))
    }
    resolvers[0](late)
    await expect(pending).resolves.toBe("rejected")
    //an unhandled rejection is reported a macrotask later
    await new Promise((resolve) => setTimeout(resolve, 0))
    process.off("unhandledRejection", onRefused)
    expect(refused).toEqual([])
    expect(late.released).toBe(true)
  })

  it("does not install a sentinel that arrives already released", async () => {
    //the document hid between the request and the answer, so the platform
    //released the lock before handing it over: nothing is held, and the
    //re-acquire on the next visibilitychange is the retry
    forceNative(false)
    const { resolvers } = deferredWakeLock()
    const pending = requestKeepAwake()
    const gone = fakeSentinel()
    gone.released = true
    resolvers[0](gone)
    await expect(pending).resolves.toBe("rejected")
    expect(isKeepAwakeActive()).toBe(false)
  })

  it("holds exactly one sentinel when two requests overlap", async () => {
    //the second resolve used to overwrite the first sentinel, which then
    //leaked on the platform until the document hid
    forceNative(false)
    const { request, resolvers } = deferredWakeLock()

    const first = requestKeepAwake()
    const second = requestKeepAwake()
    expect(request).toHaveBeenCalledTimes(2)

    const a = fakeSentinel()
    const b = fakeSentinel()
    resolvers[0](a)
    resolvers[1](b)
    await expect(first).resolves.toBe("held")
    await expect(second).resolves.toBe("held")

    expect(isKeepAwakeActive()).toBe(true)
    expect([a, b].filter((s) => !s.released)).toHaveLength(1)
    expect(a.released).toBe(false)
    expect(b.released).toBe(true)

    await releaseKeepAwake()
    expect(a.released).toBe(true)
    expect(isKeepAwakeActive()).toBe(false)
  })

  it("survives the StrictMode mount → cleanup → remount sequence", async () => {
    //useKeepAwake({ enabled: true }) under React 19 StrictMode does exactly
    //this: request (pending), release, request again (pending) — and both
    //platform answers land afterwards
    forceNative(false)
    const { request, resolvers } = deferredWakeLock()

    const mount = requestKeepAwake()
    void releaseKeepAwake()
    const remount = requestKeepAwake()
    expect(request).toHaveBeenCalledTimes(2)

    const a = fakeSentinel()
    const b = fakeSentinel()
    resolvers[0](a)
    resolvers[1](b)
    await expect(mount).resolves.toBe("held")
    await expect(remount).resolves.toBe("held")

    expect(isKeepAwakeActive()).toBe(true)
    expect([a, b].filter((s) => !s.released)).toHaveLength(1)

    await releaseKeepAwake()
    expect(a.released).toBe(true)
    expect(b.released).toBe(true)
    expect(isKeepAwakeActive()).toBe(false)
  })
})
