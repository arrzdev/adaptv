import { describe, expect, it } from "vitest"
import { createMemoryStorage } from "#synq/adapters/memory.adapter"
import { createSynqStorage } from "#synq/core/create-synq"
import { createLiveQueries } from "#synq/reactive/live-queries"
import type { CollectionConfig } from "#synq/types/collection.types"
import type { CollectionHandle } from "#synq/types/query.types"

type Todo = { title: string; checked: boolean; position: number }

//flush pending microtasks + the async query() that the engine kicks off
const flush = () => new Promise((r) => setTimeout(r, 0))

function makeHandle() {
  const storage = createMemoryStorage()
  const db = createSynqStorage({
    storageAdapter: storage,
    collections: {
      todos: { name: "todos" } as CollectionConfig<Todo>,
    },
  })
  //wrap subscribe so tests can prove the engine dedups onto one observer
  let subscribeCount = 0
  const handle: CollectionHandle<Todo> = {
    ...db.todos,
    subscribe(cb) {
      subscribeCount++
      return db.todos.subscribe(cb)
    },
  }
  return { db, handle, subscribeCount: () => subscribeCount }
}

describe("createLiveQueries — dedup + reactivity", () => {
  it("two observers of the same query share one live observer", async () => {
    const { db, handle, subscribeCount } = makeHandle()
    await db.todos.insert({ title: "a", checked: false, position: 0 })

    const engine = createLiveQueries(handle)
    let hitsA = 0
    let hitsB = 0
    const a = engine.observe({ sortBy: "position" }, () => {
      hitsA++
    })
    const b = engine.observe({ sortBy: "position" }, () => {
      hitsB++
    })
    await flush()

    //one underlying subscription despite two observers
    expect(subscribeCount()).toBe(1)
    expect(a.get().data.map((t) => t.title)).toEqual(["a"])
    expect(b.get().isLoading).toBe(false)

    await db.todos.insert({ title: "b", checked: false, position: 1 })
    await flush()
    expect(a.get().data.map((t) => t.title)).toEqual(["a", "b"])
    expect(b.get().data).toHaveLength(2)
    expect(hitsA).toBeGreaterThan(0)
    expect(hitsB).toBeGreaterThan(0)
  })

  it("reports isLoading until the first result arrives", async () => {
    const { handle } = makeHandle()
    const engine = createLiveQueries(handle)
    const h = engine.observe(undefined, () => {})
    expect(h.get().isLoading).toBe(true)
    await flush()
    expect(h.get().isLoading).toBe(false)
  })
})

describe("createLiveQueries — gcTime semantics", () => {
  it("gcTime:0 stops processing on unmount but keeps last data for SWR", async () => {
    const { db, handle } = makeHandle()
    await db.todos.insert({ title: "a", checked: false, position: 0 })

    const engine = createLiveQueries(handle)
    const first = engine.observe({ gcTime: 0 }, () => {})
    await flush()
    expect(first.get().data).toHaveLength(1)

    //unmount → live processing torn down
    first.unsubscribe()
    //a change made while torn down must NOT be picked up
    await db.todos.insert({ title: "b", checked: false, position: 1 })
    await flush()

    //remount: last-known snapshot is shown instantly (SWR), still stale (1)
    const second = engine.observe({ gcTime: 0 }, () => {})
    expect(second.get().isLoading).toBe(false)
    expect(second.get().data).toHaveLength(1)
    //…then it revalidates to the current state (2)
    await flush()
    expect(second.get().data).toHaveLength(2)
  })

  it("gcTime:Infinity keeps processing after unmount (remount is fresh)", async () => {
    const { db, handle } = makeHandle()
    await db.todos.insert({ title: "a", checked: false, position: 0 })

    const engine = createLiveQueries(handle)
    const first = engine.observe(
      { gcTime: Number.POSITIVE_INFINITY },
      () => {},
    )
    await flush()
    expect(first.get().data).toHaveLength(1)

    first.unsubscribe()
    //processing continues with no subscribers → data stays current
    await db.todos.insert({ title: "b", checked: false, position: 1 })
    await flush()

    const second = engine.observe(
      { gcTime: Number.POSITIVE_INFINITY },
      () => {},
    )
    //already up to date on remount — no revalidation gap
    expect(second.get().data).toHaveLength(2)
  })
})
