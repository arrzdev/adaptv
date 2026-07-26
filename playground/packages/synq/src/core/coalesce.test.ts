import { describe, expect, it } from "vitest"
import { coalesce, coalesceRow } from "#synq/core/coalesce"
import type {
  Hlc,
  OutboxEntry,
  OutboxOpType,
} from "#synq/types/synq.types"

let seq = 0
function op(
  type: OutboxOpType,
  rowId: string,
  payload: unknown,
  extra: Partial<OutboxEntry> = {},
): OutboxEntry {
  seq++
  const hlc: Hlc = { wall: seq, counter: 0, node: "n1" }
  return {
    id: `op-${seq}`,
    collection: "todos",
    rowId,
    type,
    payload,
    hlc,
    createdAt: seq,
    retryCount: 0,
    ...extra,
  }
}

describe("coalesceRow — matrix", () => {
  it("INSERT then DELETE is voided entirely", () => {
    const out = coalesceRow([
      op("INSERT", "a", { title: "x" }),
      op("DELETE", "a", null),
    ])
    expect(out).toEqual([])
  })

  it("INSERT then UPDATE collapses into a single INSERT", () => {
    const out = coalesceRow([
      op("INSERT", "a", { title: "x", done: false }),
      op("UPDATE", "a", { done: true }),
    ])
    expect(out).toHaveLength(1)
    expect(out[0].type).toBe("INSERT")
    expect(out[0].payload).toEqual({ title: "x", done: true })
  })

  it("UPDATE then UPDATE merges into one UPDATE payload", () => {
    const out = coalesceRow([
      op("UPDATE", "a", { title: "x" }),
      op("UPDATE", "a", { done: true }),
    ])
    expect(out).toHaveLength(1)
    expect(out[0].type).toBe("UPDATE")
    expect(out[0].payload).toEqual({ title: "x", done: true })
  })

  it("UPDATE then DELETE drops to a single DELETE", () => {
    const out = coalesceRow([
      op("UPDATE", "a", { title: "x" }),
      op("DELETE", "a", null),
    ])
    expect(out).toHaveLength(1)
    expect(out[0].type).toBe("DELETE")
  })

  it("INSERT, several UPDATEs, then DELETE is a ghost and voids", () => {
    const out = coalesceRow([
      op("INSERT", "a", { title: "x" }),
      op("UPDATE", "a", { title: "y" }),
      op("UPDATE", "a", { done: true }),
      op("DELETE", "a", null),
    ])
    expect(out).toEqual([])
  })

  it("carries the latest hlc on the coalesced entry", () => {
    const a = op("UPDATE", "a", { title: "x" })
    const b = op("UPDATE", "a", { done: true })
    const out = coalesceRow([a, b])
    expect(out[0].hlc).toEqual(b.hlc)
  })

  it("unions tombstones from every folded op", () => {
    const t1: Record<string, Hlc> = {
      "tags::a": { wall: 1, counter: 0, node: "n1" },
    }
    const t2: Record<string, Hlc> = {
      "tags::b": { wall: 2, counter: 0, node: "n1" },
    }
    const out = coalesceRow([
      op("UPDATE", "a", { x: 1 }, { tombstones: t1 }),
      op("UPDATE", "a", { y: 2 }, { tombstones: t2 }),
    ])
    expect(out[0].tombstones).toEqual({ ...t1, ...t2 })
  })
})

describe("coalesce — whole outbox", () => {
  it("compacts each rowId independently and preserves row order", () => {
    const out = coalesce([
      op("INSERT", "a", { title: "a1" }),
      op("UPDATE", "b", { title: "b1" }),
      op("UPDATE", "a", { done: true }),
      op("DELETE", "c", null),
      op("UPDATE", "b", { done: true }),
    ])

    expect(out.map((o) => o.rowId)).toEqual(["a", "b", "c"])
    const a = out.find((o) => o.rowId === "a")
    const b = out.find((o) => o.rowId === "b")
    expect(a?.type).toBe("INSERT")
    expect(a?.payload).toEqual({ title: "a1", done: true })
    expect(b?.type).toBe("UPDATE")
    expect(b?.payload).toEqual({ title: "b1", done: true })
  })
})
