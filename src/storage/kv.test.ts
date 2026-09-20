import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const restores: Array<() => void> = []

/** Fresh module per test — the KV map hydrates once at module load. */
async function freshKv(native = false) {
  vi.resetModules()
  vi.stubGlobal(
    "Capacitor",
    native ? { isNativePlatform: () => true } : undefined,
  )
  return import("#adaptv/storage/kv")
}

/**
 * A `storage` event as the browser raises it in a tab that did not write.
 * `storageArea` is part of it: sessionStorage raises the same event, from a
 * frame of this very tab.
 */
function dispatchStorage(init: {
  key: string | null
  newValue?: string | null
  area?: Storage
}) {
  const event = new Event("storage") as StorageEvent
  Object.defineProperty(event, "key", { value: init.key })
  Object.defineProperty(event, "newValue", {
    value: init.newValue ?? null,
  })
  Object.defineProperty(event, "storageArea", {
    value: init.area ?? localStorage,
  })
  window.dispatchEvent(event)
}

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  for (const r of restores.splice(0)) r()
  vi.unstubAllGlobals()
  localStorage.clear()
})

describe("kv — sync reads, the whole point of the tier", () => {
  it("reads a value written in the same tick", () => {
    //MMKV model: a flag must be readable DURING render, with no await and no
    //boot gate. An async-everywhere KV forces a loading state onto every feature
    //flag, which is why this tier exists at all.
    return freshKv().then(({ kv }) => {
      kv.set("onboarded", true)
      expect(kv.get("onboarded")).toBe(true)
    })
  })

  it("returns undefined for a missing key", async () => {
    const { kv } = await freshKv()
    expect(kv.get("nope")).toBeUndefined()
  })

  it("returns the fallback for a missing key", async () => {
    const { kv } = await freshKv()
    expect(kv.get("nope", "default")).toBe("default")
  })

  it("does not use the fallback when the stored value is falsy", () => {
    //`false` and `0` are real values. A `??`-style fallback on the RESULT would
    //silently resurrect the default every time someone stored `false` — which is
    //the single most common thing a flag holds.
    return freshKv().then(({ kv }) => {
      kv.set("flag", false)
      expect(kv.get("flag", true)).toBe(false)
      kv.set("count", 0)
      expect(kv.get("count", 5)).toBe(0)
    })
  })

  it("round-trips objects and arrays", async () => {
    const { kv } = await freshKv()
    kv.set("obj", { a: 1, b: [2, 3] })
    expect(kv.get("obj")).toEqual({ a: 1, b: [2, 3] })
  })

  it("removes a key", async () => {
    const { kv } = await freshKv()
    kv.set("x", 1)
    kv.remove("x")
    expect(kv.get("x")).toBeUndefined()
  })
})

describe("kv — durability on web", () => {
  it("write-throughs to localStorage synchronously", async () => {
    //web has no durability lag: a crash immediately after set() must not lose it
    const { kv, KV_PREFIX } = await freshKv()
    kv.set("token-ish", "v")
    expect(localStorage.getItem(`${KV_PREFIX}token-ish`)).toBe('"v"')
  })

  it("hydrates from localStorage at module load, with no boot gate", async () => {
    const { KV_PREFIX } = await freshKv()
    localStorage.setItem(`${KV_PREFIX}persisted`, '"hello"')

    const { kv } = await freshKv()
    expect(kv.get("persisted")).toBe("hello")
  })

  it("namespaces its keys so clear() cannot touch consumer data", async () => {
    //adaptv shares localStorage with the app. A blind clear() would wipe the
    //consumer's own keys — data loss caused by a framework internal.
    const { kv } = await freshKv()
    localStorage.setItem("app-owned", "keep me")
    kv.set("mine", 1)
    kv.clear()

    expect(localStorage.getItem("app-owned")).toBe("keep me")
    expect(kv.get("mine")).toBeUndefined()
  })

  it("survives corrupt JSON in storage rather than throwing at import", async () => {
    //a half-written value or a hand-edited devtools entry must not brick boot:
    //this code runs at MODULE LOAD, so a throw here takes the whole app down
    const { KV_PREFIX } = await freshKv()
    localStorage.setItem(`${KV_PREFIX}broken`, "{not json")

    const { kv } = await freshKv()
    expect(kv.get("broken")).toBeUndefined()
    expect(kv.get("broken", "fallback")).toBe("fallback")
  })
})

describe("kv — reactivity", () => {
  it("notifies subscribers on set", async () => {
    const { kv, subscribeKv } = await freshKv()
    const listener = vi.fn()
    subscribeKv("k", listener)
    kv.set("k", 1)
    expect(listener).toHaveBeenCalled()
  })

  it("only notifies subscribers of the key that changed", async () => {
    const { kv, subscribeKv } = await freshKv()
    const other = vi.fn()
    subscribeKv("other", other)
    kv.set("k", 1)
    expect(other).not.toHaveBeenCalled()
  })

  it("notifies on remove", async () => {
    const { kv, subscribeKv } = await freshKv()
    const listener = vi.fn()
    subscribeKv("k", listener)

    kv.set("k", 1)
    kv.remove("k")
    expect(listener).toHaveBeenCalledTimes(2)
  })

  it("notifies every key that clear() actually dropped", async () => {
    const { kv, subscribeKv } = await freshKv()
    const a = vi.fn()
    const b = vi.fn()
    subscribeKv("a", a)
    subscribeKv("b", b)

    kv.set("a", 1)
    kv.set("b", 2)
    a.mockClear()
    b.mockClear()

    kv.clear()
    expect(a).toHaveBeenCalledOnce()
    expect(b).toHaveBeenCalledOnce()
  })

  it("does not notify for a key clear() had nothing to drop", async () => {
    //a subscriber whose key was already absent saw no change, so waking it would
    //be a spurious re-render
    const { kv, subscribeKv } = await freshKv()
    const listener = vi.fn()
    subscribeKv("never-set", listener)

    kv.clear()
    expect(listener).not.toHaveBeenCalled()
  })

  it("unsubscribes cleanly", async () => {
    const { kv, subscribeKv } = await freshKv()
    const listener = vi.fn()
    subscribeKv("k", listener)()
    kv.set("k", 1)
    expect(listener).not.toHaveBeenCalled()
  })

  it("returns a referentially stable snapshot between reads", async () => {
    //useSyncExternalStore re-renders forever if getSnapshot returns a new object
    //each call. The map must hold the PARSED value, not re-parse on every read.
    const { kv } = await freshKv()
    kv.set("obj", { a: 1 })
    expect(kv.get("obj")).toBe(kv.get("obj"))
  })

  it("folds a cross-tab write back into the map", async () => {
    //the `storage` event is cross-tab ONLY — it never fires in the writing tab,
    //which is why an in-process emitter is required as well
    const { kv, KV_PREFIX } = await freshKv()
    const listener = vi.fn()

    dispatchStorage({
      key: `${KV_PREFIX}shared`,
      newValue: '"from-other-tab"',
    })

    expect(kv.get("shared")).toBe("from-other-tab")
    expect(listener).not.toHaveBeenCalled()
  })

  it("drops every value another tab's localStorage.clear() took, and wakes each key", async () => {
    localStorage.setItem("adaptv:kv:a", "1")
    localStorage.setItem("adaptv:kv:b", "2")
    const { kv, subscribeKv } = await freshKv()
    const a = vi.fn()
    const b = vi.fn()
    subscribeKv("a", a)
    subscribeKv("b", b)

    //a clear raises one storage event with a null key, in every OTHER tab
    localStorage.clear()
    dispatchStorage({ key: null })

    expect(kv.get("a")).toBeUndefined()
    expect(kv.get("b")).toBeUndefined()
    expect(a).toHaveBeenCalledTimes(1)
    expect(b).toHaveBeenCalledTimes(1)
  })

  it("keeps a value localStorage refused through a frame's sessionStorage.clear()", async () => {
    const { kv, subscribeKv } = await freshKv()
    const listener = vi.fn()
    subscribeKv("a", listener)
    //localStorage is full: the write lands in memory only, as documented
    const setItem = vi
      .spyOn(localStorage, "setItem")
      .mockImplementation(() => {
        throw new DOMException("full", "QuotaExceededError")
      })
    restores.push(() => setItem.mockRestore())
    kv.set("a", 1)
    expect(localStorage.getItem("adaptv:kv:a")).toBeNull()
    listener.mockClear()

    //a frame of this tab clears ITS sessionStorage: keyless, and not kv's
    dispatchStorage({ key: null, area: sessionStorage })

    expect(kv.get("a")).toBe(1)
    expect(listener).not.toHaveBeenCalled()
  })

  it("ignores a sessionStorage write under a kv key", async () => {
    const { kv, KV_PREFIX } = await freshKv()
    dispatchStorage({
      key: `${KV_PREFIX}shared`,
      newValue: '"from-session"',
      area: sessionStorage,
    })

    expect(kv.get("shared")).toBeUndefined()
  })

  it("ignores storage events for keys it does not own", async () => {
    const { kv } = await freshKv()
    dispatchStorage({ key: "app-owned", newValue: '"nope"' })

    expect(kv.get("app-owned")).toBeUndefined()
  })
})

/**
 * Native kv against a stand-in `@capacitor/preferences`. The real plugin is a
 * bridge proxy that only exists in a WebView, so the seam is the module itself —
 * the same one `native-theme.test.ts` uses.
 */
async function nativeKv(preferences: Record<string, unknown>) {
  vi.resetModules()
  vi.doMock("@capacitor/preferences", () => ({ Preferences: preferences }))
  restores.push(() => {
    vi.doUnmock("@capacitor/preferences")
    vi.resetModules()
  })
  vi.stubGlobal("Capacitor", { isNativePlatform: () => true })
  return import("#adaptv/storage/kv")
}

/**
 * Collect every rejection nobody handled while `run` executes. A fire-and-forget
 * bridge call that rejects lands here, and in a WebView that is a console error
 * or an error-reporter event for a write the caller was told had succeeded.
 */
async function unhandledDuring(run: () => void): Promise<unknown[]> {
  const seen: unknown[] = []
  const listener = (reason: unknown) => seen.push(reason)
  process.on("unhandledRejection", listener)
  try {
    run()
    //unhandled rejections are reported after the microtask queue drains, so
    //leave the turn before reading
    await new Promise((resolve) => setTimeout(resolve, 0))
  } finally {
    process.off("unhandledRejection", listener)
  }
  return seen
}

describe("kv — native, over Preferences", () => {
  it("persists a write under the namespaced key, JSON-encoded", async () => {
    const set = vi.fn(async () => {})
    const { kv, KV_PREFIX } = await nativeKv({ set })
    kv.set("flag", { on: true })
    expect(set).toHaveBeenCalledWith({
      key: `${KV_PREFIX}flag`,
      value: '{"on":true}',
    })
    //native never write-throughs to localStorage: the WebView's copy is
    //evictable, which is the reason Preferences backs this tier at all
    expect(localStorage.getItem(`${KV_PREFIX}flag`)).toBeNull()
  })

  it("removes through Preferences, for remove and for clear", async () => {
    const remove = vi.fn(async () => {})
    const { kv, KV_PREFIX } = await nativeKv({
      set: async () => {},
      remove,
    })
    kv.set("a", 1)
    kv.set("b", 2)
    kv.remove("a")
    kv.clear()
    expect(remove.mock.calls).toEqual([
      [{ key: `${KV_PREFIX}a` }],
      [{ key: `${KV_PREFIX}b` }],
    ])
  })

  it("handles a rejected Preferences.set and keeps the value for the session", async () => {
    //the write is fire-and-forget, so a bridge rejection has nowhere to go
    //unless kv catches it — the try/catch around the call never sees an async
    //failure. It must degrade exactly like a full localStorage on web: the
    //value stays readable in-process, and nothing escapes as an unhandled error.
    const { kv } = await nativeKv({
      set: () => Promise.reject(new Error("bridge: set failed")),
    })
    const unhandled = await unhandledDuring(() => kv.set("k", "v"))
    expect(unhandled).toEqual([])
    expect(kv.get("k")).toBe("v")
  })

  it("handles a rejected Preferences.remove", async () => {
    const { kv } = await nativeKv({
      set: async () => {},
      remove: () => Promise.reject(new Error("bridge: remove failed")),
    })
    kv.set("k", "v")
    const unhandled = await unhandledDuring(() => kv.remove("k"))
    expect(unhandled).toEqual([])
    expect(kv.get("k")).toBeUndefined()
  })

  it("does not throw when the plugin is missing from the binary", async () => {
    //an OTA bundle can run on a binary built before the plugin was added, where
    //the proxy's method throws synchronously instead of rejecting
    const { kv } = await nativeKv({
      set() {
        throw new Error("Preferences plugin is not implemented on ios")
      },
    })
    expect(() => kv.set("k", 1)).not.toThrow()
    expect(kv.get("k")).toBe(1)
  })
})

describe("kv — native boot hydration", () => {
  it("hydrates its own keys from Preferences and wakes their subscribers", async () => {
    const values: Record<string, string> = {
      "adaptv:kv:seen": "true",
      "adaptv:kv:broken": "{not json",
      "app-owned": '"not ours"',
    }
    const { kv, initKv, subscribeKv } = await nativeKv({
      keys: async () => ({ keys: Object.keys(values) }),
      get: async ({ key }: { key: string }) => ({ value: values[key] }),
    })
    const listener = vi.fn()
    subscribeKv("seen", listener)

    expect(kv.get("seen")).toBeUndefined()
    await initKv()

    expect(kv.get("seen")).toBe(true)
    //a corrupt entry must not brick boot, and a foreign key is not ours to read
    expect(kv.get("broken")).toBeUndefined()
    expect(kv.get("app-owned")).toBeUndefined()
    expect(listener).toHaveBeenCalledOnce()
  })

  it("never rejects when Preferences cannot be read, so boot is never blocked", async () => {
    const { kv, initKv } = await nativeKv({
      keys: () => Promise.reject(new Error("bridge: keys failed")),
    })
    await expect(initKv()).resolves.toBeUndefined()
    kv.set("still", "works")
    expect(kv.get("still")).toBe("works")
  })

  it("is a no-op on web, where hydration already happened at import", async () => {
    const keys = vi.fn()
    vi.resetModules()
    vi.doMock("@capacitor/preferences", () => ({ Preferences: { keys } }))
    restores.push(() => vi.doUnmock("@capacitor/preferences"))
    vi.stubGlobal("Capacitor", undefined)
    const { initKv } = await import("#adaptv/storage/kv")
    await initKv()
    expect(keys).not.toHaveBeenCalled()
  })
})

describe("kv — SSR safety", () => {
  it("never throws when storage is unavailable", async () => {
    //Safari private mode throws on localStorage access, and this module runs at
    //import time
    vi.stubGlobal("localStorage", {
      getItem() {
        throw new Error("SecurityError")
      },
      setItem() {
        throw new Error("SecurityError")
      },
      removeItem() {
        throw new Error("SecurityError")
      },
      key: () => null,
      length: 0,
    })
    const { kv } = await freshKv()
    expect(() => kv.set("k", 1)).not.toThrow()
    //still readable in-process even though it could not persist
    expect(kv.get("k")).toBe(1)
  })
})
