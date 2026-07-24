import "fake-indexeddb/auto"
import { beforeEach, describe, expect, it } from "vitest"
import { store } from "#adaptv/storage/store"

beforeEach(async () => {
  await store.clear()
})

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
})
