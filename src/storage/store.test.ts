import "fake-indexeddb/auto"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { store } from "#adaptv/storage/store"

beforeEach(async () => {
  await store.clear()
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

/**
 * A module instance of its own. The connection is opened once and cached per
 * module, so a test that breaks the open has to start from a module that has
 * not opened yet.
 */
async function freshStore() {
  vi.resetModules()
  return (await import("#adaptv/storage/store")).store
}

/** An `indexedDB` whose open request fails the way `event` says, and nothing else. */
function openThatFires(event: "error" | "blocked") {
  return {
    open() {
      const request: Record<string, unknown> = {}
      queueMicrotask(() =>
        (request[`on${event}`] as (() => void) | undefined)?.(),
      )
      return request
    },
  }
}

/**
 * Make every `put` fail. `"request"` fails the request itself (its `error`
 * event fires); `"commit"` lets the request succeed and then aborts the
 * transaction, which is how a quota overrun surfaces: the put is accepted, and
 * the commit is not.
 */
function failPuts(how: "request" | "commit") {
  const put = IDBObjectStore.prototype.put
  vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (
    this: IDBObjectStore,
    ...args: Parameters<IDBObjectStore["put"]>
  ) {
    const request = put.apply(this, args)
    if (how === "request") this.transaction.abort()
    else {
      //the put's own success event still fires — only the commit is refused
      request.addEventListener("success", () => this.transaction.abort())
    }
    return request
  })
}

describe("store — async large-value KV", () => {
  it("round-trips a value", async () => {
    await store.set("a", { hello: "world" })
    expect(await store.get("a")).toEqual({ hello: "world" })
  })

  it("resolves undefined for a missing key", async () => {
    expect(await store.get("nope")).toBeUndefined()
  })

  it("removes a key", async () => {
    await store.set("a", 1)
    await store.remove("a")
    expect(await store.get("a")).toBeUndefined()
  })

  it("lists keys", async () => {
    await store.set("a", 1)
    await store.set("b", 2)
    expect((await store.keys()).sort()).toEqual(["a", "b"])
  })

  it("clears everything", async () => {
    await store.set("a", 1)
    await store.clear()
    expect(await store.keys()).toEqual([])
  })
})

describe("store — structured clone, not JSON", () => {
  //THE difference from storage.kv, and the reason both tiers exist. kv
  //JSON-encodes, which silently turns a Date into a string — a bug that only
  //shows up when someone calls .getTime() on it much later.
  it("preserves a Date as a Date", async () => {
    const when = new Date("2026-07-20T12:00:00.000Z")
    await store.set("when", when)
    const read = await store.get<Date>("when")
    expect(read).toBeInstanceOf(Date)
    expect(read?.getTime()).toBe(when.getTime())
  })

  it("preserves a Map", async () => {
    await store.set("m", new Map([["k", 1]]))
    const read = await store.get<Map<string, number>>("m")
    expect(read).toBeInstanceOf(Map)
    expect(read?.get("k")).toBe(1)
  })

  it("preserves a Set", async () => {
    await store.set("s", new Set([1, 2]))
    expect(await store.get<Set<number>>("s")).toBeInstanceOf(Set)
  })

  it("preserves nested structure without a JSON round trip", async () => {
    const value = { at: new Date(0), tags: new Set(["x"]) }
    await store.set("nested", value)
    const read = await store.get<typeof value>("nested")
    expect(read?.at).toBeInstanceOf(Date)
    expect(read?.tags).toBeInstanceOf(Set)
  })
})

describe("store — availability", () => {
  it("reports persistence when IndexedDB is present", async () => {
    expect(await store.isPersistent()).toBe(true)
  })

  it("never rejects, whatever the storage layer does", async () => {
    //this tier is used by the framework's own offline path; a rejection there
    //would surface as a boot failure rather than as degraded storage
    await expect(store.get("anything")).resolves.not.toThrow()
    await expect(store.set("k", 1)).resolves.toBeUndefined()
    await expect(store.remove("k")).resolves.toBeUndefined()
  })

  it("degrades to memory when there is no IndexedDB at all", async () => {
    vi.stubGlobal("indexedDB", undefined)
    const fresh = await freshStore()
    await fresh.set("k", { v: 1 })
    expect(await fresh.get("k")).toEqual({ v: 1 })
    expect(await fresh.keys()).toEqual(["k"])
    await fresh.remove("k")
    expect(await fresh.get("k")).toBeUndefined()
    expect(await fresh.isPersistent()).toBe(false)
  })

  it.each(["error", "blocked"] as const)(
    "degrades to memory when the open fires %s",
    async (event) => {
      //Firefox private mode used to fail the open, and an open held up by another
      //connection fires blocked — either way the session still needs a store
      vi.stubGlobal("indexedDB", openThatFires(event))
      const fresh = await freshStore()
      await fresh.set("k", "v")
      expect(await fresh.get("k")).toBe("v")
      expect(await fresh.isPersistent()).toBe(false)
    },
  )

  it("degrades to memory when the open throws", async () => {
    vi.stubGlobal("indexedDB", {
      open() {
        throw new DOMException("denied", "SecurityError")
      },
    })
    const fresh = await freshStore()
    await expect(fresh.set("k", "v")).resolves.toBeUndefined()
    expect(await fresh.get("k")).toBe("v")
  })
})

describe("store — a write IndexedDB refuses", () => {
  it.each(["request", "commit"] as const)(
    "keeps the value readable when the put fails at the %s",
    async (how) => {
      //set() resolves either way — it never rejects — so a value that is then not
      //readable is lost without anything having reported it
      await store.set("k", "old")
      failPuts(how)
      await store.set("k", "new")
      expect(await store.get("k")).toBe("new")
    },
  )

  it("reports the store as not persistent while a value lives only in memory", async () => {
    //isPersistent() is the tier's one signal that writes are not landing; a
    //refused write is exactly that, even with IndexedDB present
    failPuts("commit")
    await store.set("k", "v")
    expect(await store.isPersistent()).toBe(false)
    expect(await store.keys()).toEqual(["k"])

    vi.restoreAllMocks()
    await store.set("k", "v")
    expect(await store.isPersistent()).toBe(true)
    expect(await store.get("k")).toBe("v")
  })

  it("does not resurrect a value whose remove IndexedDB refused", async () => {
    await store.set("k", "secret-ish")
    const remove = IDBObjectStore.prototype.delete
    vi.spyOn(IDBObjectStore.prototype, "delete").mockImplementation(
      function (this: IDBObjectStore, query: IDBValidKey | IDBKeyRange) {
        const request = remove.call(this, query)
        this.transaction.abort()
        return request
      },
    )
    await store.remove("k")
    expect(await store.get("k")).toBeUndefined()
    expect(await store.keys()).toEqual([])
  })
})

describe("store — sharing the database", () => {
  it("steps aside for a delete or an upgrade elsewhere, then reopens", async () => {
    //an open connection that ignores versionchange blocks every deleteDatabase
    //(a consumer's wipe on logout) and every version bump from another tab until
    //this page closes. The store has to close on request and reopen on its next
    //call, still persistent.
    await store.set("k", 1)
    const outcome = await new Promise((resolve) => {
      const request = indexedDB.deleteDatabase("adaptv-store")
      request.onsuccess = () => resolve("deleted")
      request.onblocked = () => resolve("blocked")
    })
    expect(outcome).toBe("deleted")

    expect(await store.get("k")).toBeUndefined()
    await store.set("k", 2)
    expect(await store.get("k")).toBe(2)
    expect(await store.isPersistent()).toBe(true)
  })
})
