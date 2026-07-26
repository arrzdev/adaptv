import { describe, expect, it } from "vitest"
import { createMemoryStorage } from "#synq/adapters/memory.adapter"
import { createSynqStorage } from "#synq/core/create-synq"
import type {
  CollectionConfig,
  TxContext,
} from "#synq/types/collection.types"
import { singletonCollection } from "#synq/types/collection.types"

type Todo = { title: string; checked: boolean; position: number }

function ackAllPush() {
  const ack = async (items: { opId: string }[], ctx: TxContext) => {
    for (const i of items) ctx.ack(i.opId)
  }
  return { inserts: ack, updates: ack, deletes: ack }
}

function makeDb(config?: Partial<CollectionConfig<Todo>>) {
  const storage = createMemoryStorage()
  const db = createSynqStorage({
    storageAdapter: storage,
    collections: {
      todos: { name: "todos", ...config } as CollectionConfig<Todo>,
    },
  })
  return { db, storage }
}

describe("createSynqStorage — local reads/writes", () => {
  it("insert shows up optimistically as pending", async () => {
    const { db } = makeDb()
    const created = await db.todos.insert({
      title: "buy milk",
      checked: false,
      position: 0,
    })
    expect(created.$sync.$synced).toBe(false)
    const got = await db.todos.get(created.$id)
    expect(got).toMatchObject({ title: "buy milk" })
    expect(got?.$sync.$syncStatus).toBe("pending")
  })

  it("update and delete flow through the outbox", async () => {
    const { db } = makeDb()
    const t = await db.todos.insert({
      title: "a",
      checked: false,
      position: 0,
    })
    await db.todos.update(t.$id, { checked: true })
    expect((await db.todos.get(t.$id))?.checked).toBe(true)
    await db.todos.delete(t.$id)
    expect(await db.todos.get(t.$id)).toBeNull()
  })

  it("query filters, sorts, and limits", async () => {
    const { db } = makeDb()
    await db.todos.insert({ title: "a", checked: false, position: 2 })
    await db.todos.insert({ title: "b", checked: true, position: 0 })
    await db.todos.insert({ title: "c", checked: false, position: 1 })

    const open = await db.todos.query({ where: { checked: false } })
    expect(open).toHaveLength(2)

    const sorted = await db.todos.query({
      sortBy: "position",
      order: "asc",
    })
    expect(sorted.map((t) => t.title)).toEqual(["b", "c", "a"])
  })

  it("pendingCount counts distinct unsynced rows, clearing after sync", async () => {
    const { db } = makeDb({ push: ackAllPush() })
    expect(await db.todos.pendingCount()).toBe(0)

    const a = await db.todos.insert({
      title: "a",
      checked: false,
      position: 0,
    })
    //a second op on the SAME row is still one pending item
    await db.todos.update(a.$id, { checked: true })
    await db.todos.insert({ title: "b", checked: false, position: 1 })
    expect(await db.todos.pendingCount()).toBe(2)

    await db.sync() //acked → outbox drained
    expect(await db.todos.pendingCount()).toBe(0)
  })
})

describe("createSynqStorage — singleton collection", () => {
  it("get() returns defaults before any write, then the patched row", async () => {
    const db = createSynqStorage({
      storageAdapter: createMemoryStorage(),
      collections: {
        prefs: singletonCollection("prefs", {
          hapticsEnabled: true,
          reducedAnimations: false,
        }),
      },
    })

    //defaults before any write — never null
    const initial = await db.prefs.get()
    expect(initial.hapticsEnabled).toBe(true)
    expect(initial.reducedAnimations).toBe(false)

    await db.prefs.set({ reducedAnimations: true })
    const after = await db.prefs.get()
    expect(after.reducedAnimations).toBe(true)
    //an untouched field still falls back to its default
    expect(after.hapticsEnabled).toBe(true)

    //a second set patches the SAME single row (no second entry)
    await db.prefs.set({ hapticsEnabled: false })
    const final = await db.prefs.get()
    expect(final).toMatchObject({
      hapticsEnabled: false,
      reducedAnimations: true,
    })
  })
})

describe("createSynqStorage — onLocalChange (echo suppression)", () => {
  it("fires on local writes but NOT when a pull applies server state", async () => {
    let remote: unknown[] = []
    const db = createSynqStorage({
      storageAdapter: createMemoryStorage(),
      collections: {
        todos: {
          name: "todos",
          pull: async () => ({ changes: remote, nextCursor: 1 }),
          push: ackAllPush(),
        } as CollectionConfig<Todo>,
      },
    })

    let localHits = 0
    let allHits = 0
    db.todos.onLocalChange(() => {
      localHits++
    })
    db.todos.subscribe(() => {
      allHits++
    })

    await db.todos.insert({ title: "a", checked: false, position: 0 })
    expect(localHits).toBe(1)

    //a pull delivers a server row — the reactive channel must fire so the UI
    //updates, but the local-change channel must stay silent (no sync loop)
    remote = [
      {
        $id: "srv",
        $meta: {
          fields: {
            title: { wall: 9, counter: 0, node: "s" },
            checked: { wall: 9, counter: 0, node: "s" },
            position: { wall: 9, counter: 0, node: "s" },
          },
          tombstones: {},
        },
        title: "from server",
        checked: false,
        position: 5,
      },
    ]
    const localBefore = localHits
    const allBefore = allHits
    await db.todos.sync()

    expect(localHits).toBe(localBefore) //pull did not look like a local write
    expect(allHits).toBeGreaterThan(allBefore) //but the UI channel did fire
    expect(await db.todos.get("srv")).toMatchObject({
      title: "from server",
    })
  })
})

describe("createSynqStorage — sync", () => {
  it("acked push commits to canonical and clears pending", async () => {
    const { db } = makeDb({ push: ackAllPush() })
    const t = await db.todos.insert({
      title: "x",
      checked: false,
      position: 0,
    })
    const [outcome] = await db.sync()
    expect(outcome.acked).toBe(1)
    const got = await db.todos.get(t.$id)
    expect(got?.$sync.$synced).toBe(true)
    expect(got?.$sync.$syncStatus).toBe("synced")
  })

  it("pulls shared remote rows into the local view", async () => {
    const db = createSynqStorage({
      storageAdapter: createMemoryStorage(),
      collections: {
        todos: {
          name: "todos",
          pull: async () => ({
            changes: [
              {
                $id: "remote-1",
                $meta: {
                  fields: {
                    title: { wall: 1, counter: 0, node: "server" },
                    checked: { wall: 1, counter: 0, node: "server" },
                    position: { wall: 1, counter: 0, node: "server" },
                  },
                  tombstones: {},
                },
                title: "from another device",
                checked: false,
                position: 0,
              },
            ],
            nextCursor: 1,
          }),
        } as CollectionConfig<Todo>,
      },
    })
    await db.todos.sync()
    const got = await db.todos.get("remote-1")
    expect(got).toMatchObject({ title: "from another device" })
    expect(got?.$sync.$synced).toBe(true)
  })

  it("persists the clock past pulled stamps in the sync commit itself", async () => {
    //the pulled stamp is far ahead of local wall time. the clock must land
    //in storage WITH the pulled rows (same transaction) — persisted only
    //after the run, a crash in between would resume from a stale clock and
    //stamp later local writes BELOW remote stamps they should beat.
    const storage = createMemoryStorage()
    const farAhead = Date.now() + 60 * 60 * 1000
    const db = createSynqStorage({
      storageAdapter: storage,
      collections: {
        todos: {
          name: "todos",
          pull: async () => ({
            changes: [
              {
                $id: "remote-1",
                $meta: {
                  fields: {
                    title: { wall: farAhead, counter: 0, node: "server" },
                  },
                  tombstones: {},
                },
                title: "future",
                checked: false,
                position: 0,
              },
            ],
            nextCursor: 1,
          }),
        } as CollectionConfig<Todo>,
      },
    })
    await db.todos.sync()
    const meta = (await storage.getCursor("__synq")) as { clock: string }
    const persistedWall = Number(meta.clock.split(":")[0])
    expect(persistedWall).toBeGreaterThanOrEqual(farAhead)
  })
})

describe("createSynqStorage — resetLocal", () => {
  it("wipes local rows + outbox and notifies subscribers", async () => {
    const { db } = makeDb()
    await db.todos.insert({ title: "x", checked: false, position: 0 })
    expect((await db.todos.query()).length).toBe(1)
    expect(await db.todos.pendingCount()).toBe(1)

    let notified = 0
    const unsub = db.todos.subscribe(() => {
      notified++
    })

    await db.resetLocal()

    expect(await db.todos.query()).toEqual([])
    expect(await db.todos.pendingCount()).toBe(0)
    expect(notified).toBeGreaterThan(0) // live queries re-render
    unsub()
  })

  it("does NOT enqueue deletions — the wipe stays local", async () => {
    const { db, storage } = makeDb()
    await db.todos.insert({ title: "x", checked: false, position: 0 })
    await db.resetLocal()
    //no outbox ops remain, so nothing pushes the wipe upstream
    expect(await storage.getOps()).toEqual([])
  })
})
