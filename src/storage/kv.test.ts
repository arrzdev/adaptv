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

    const event = new Event("storage") as StorageEvent
    Object.defineProperty(event, "key", { value: `${KV_PREFIX}shared` })
    Object.defineProperty(event, "newValue", { value: '"from-other-tab"' })
    window.dispatchEvent(event)

    expect(kv.get("shared")).toBe("from-other-tab")
    expect(listener).not.toHaveBeenCalled()
  })

  it("ignores storage events for keys it does not own", async () => {
    const { kv } = await freshKv()
    const event = new Event("storage") as StorageEvent
    Object.defineProperty(event, "key", { value: "app-owned" })
    Object.defineProperty(event, "newValue", { value: '"nope"' })
    window.dispatchEvent(event)

    expect(kv.get("app-owned")).toBeUndefined()
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
