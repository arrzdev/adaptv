import { describe, expect, it, vi } from "vitest"
import { createMemoryStorage } from "#synq/adapters/memory.adapter"
import type {
  DocMeta,
  OutboxEntry,
  StoredDocument,
} from "#synq/types/synq.types"

const meta: DocMeta = { fields: {}, tombstones: {} }
const row = (id: string): StoredDocument<{ n: number }> => ({
  $id: id,
  $meta: meta,
  n: 1,
})
const op = (id: string): OutboxEntry => ({
  id,
  collection: "todos",
  rowId: "r1",
  type: "INSERT",
  payload: {},
  hlc: { wall: 1, counter: 0, node: "n" },
  createdAt: 1,
  retryCount: 0,
})

describe("createMemoryStorage", () => {
  it("round-trips rows, ops, and cursor", async () => {
    const s = createMemoryStorage()
    await s.transact((tx) => {
      tx.putRows("todos", [row("a"), row("b")])
      tx.appendOps([op("o1")])
      tx.setCursor("todos", 42)
    })
    expect(await s.getAll("todos")).toHaveLength(2)
    expect(await s.getRow("todos", "a")).toMatchObject({ $id: "a" })
    expect(await s.getOps("todos")).toHaveLength(1)
    expect(await s.getCursor("todos")).toBe(42)
  })

  it("notifies subscribers once per transaction", async () => {
    const s = createMemoryStorage()
    const cb = vi.fn()
    s.subscribe("todos", cb)
    await s.transact((tx) => {
      tx.putRows("todos", [row("a")])
      tx.putRows("todos", [row("b")])
      tx.appendOps([op("o1")])
    })
    expect(cb).toHaveBeenCalledTimes(1)
  })

  it("deleteOps removes by id and notifies the right collection", async () => {
    const s = createMemoryStorage()
    await s.transact((tx) => tx.appendOps([op("o1"), op("o2")]))
    const cb = vi.fn()
    s.subscribe("todos", cb)
    await s.transact((tx) => tx.deleteOps(["o1"]))
    expect(await s.getOps("todos")).toHaveLength(1)
    expect(cb).toHaveBeenCalledTimes(1)
  })

  it("unsubscribe stops further notifications", async () => {
    const s = createMemoryStorage()
    const cb = vi.fn()
    const off = s.subscribe("todos", cb)
    off()
    await s.transact((tx) => tx.putRows("todos", [row("a")]))
    expect(cb).not.toHaveBeenCalled()
  })
})
