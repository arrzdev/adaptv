import "fake-indexeddb/auto"
import { describe, expect, it } from "vitest"
import { createIndexedDbStorage } from "#synq/adapters/indexeddb.adapter"
import type {
  DocMeta,
  OutboxEntry,
  StoredDocument,
} from "#synq/types/synq.types"

const meta: DocMeta = { fields: {}, tombstones: {} }
const row = (id: string): StoredDocument<{ n: number }> => ({
  $id: id,
  $meta: meta,
  n: id.length,
})
const op = (id: string): OutboxEntry => ({
  id,
  collection: "todos",
  rowId: "r1",
  type: "INSERT",
  payload: {},
  hlc: { wall: Number(id.replace(/\D/g, "")) || 1, counter: 0, node: "n" },
  createdAt: Number(id.replace(/\D/g, "")) || 1,
  retryCount: 0,
})

let dbCount = 0
function freshName() {
  dbCount++
  return `synq-test-${dbCount}-${Date.now()}`
}

describe("createIndexedDbStorage", () => {
  it("persists rows, ops, and cursor across reopen", async () => {
    const name = freshName()
    const a = createIndexedDbStorage({ name })
    await a.transact((tx) => {
      tx.putRows("todos", [row("a"), row("bb")])
      tx.appendOps([op("o1")])
      tx.setCursor("todos", 7)
    })

    //reopen the same database with a new adapter instance
    const b = createIndexedDbStorage({ name })
    expect(await b.getAll("todos")).toHaveLength(2)
    expect(await b.getRow("todos", "a")).toMatchObject({ $id: "a", n: 1 })
    expect(await b.getOps("todos")).toHaveLength(1)
    expect(await b.getCursor("todos")).toBe(7)
  })

  it("returns ops in causal (hlc) order", async () => {
    const a = createIndexedDbStorage({ name: freshName() })
    await a.transact((tx) => tx.appendOps([op("o3"), op("o1"), op("o2")]))
    const ops = await a.getOps("todos")
    expect(ops.map((o) => o.id)).toEqual(["o1", "o2", "o3"])
  })

  it("breaks same-millisecond ties by the hlc counter, not store key order", async () => {
    //two writes in the same wall-clock ms: createdAt ties, and IndexedDB
    //getAll returns records in key (uuid) order — only the hlc counter
    //carries the true causal order
    const a = createIndexedDbStorage({ name: freshName() })
    const first: OutboxEntry = {
      ...op("z-first"),
      hlc: { wall: 5, counter: 0, node: "n" },
      createdAt: 5,
    }
    const second: OutboxEntry = {
      ...op("a-second"),
      hlc: { wall: 5, counter: 1, node: "n" },
      createdAt: 5,
    }
    await a.transact((tx) => tx.appendOps([first, second]))
    const ops = await a.getOps("todos")
    expect(ops.map((o) => o.id)).toEqual(["z-first", "a-second"])
  })

  it("notifies subscribers once per committed transaction", async () => {
    const a = createIndexedDbStorage({ name: freshName() })
    let calls = 0
    a.subscribe("todos", () => {
      calls++
    })
    await a.transact((tx) => {
      tx.putRows("todos", [row("a")])
      tx.appendOps([op("o1")])
    })
    expect(calls).toBe(1)
  })
})
