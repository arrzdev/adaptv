import { describe, expect, it } from "vitest"
import { stitchCollection, stitchRecord } from "#synq/core/stitch"
import type {
  DocMeta,
  Hlc,
  OutboxEntry,
  OutboxOpType,
  StoredDocument,
  SyncError,
} from "#synq/types/synq.types"

type Todo = { title: string; done: boolean }

const hlc = (wall: number): Hlc => ({ wall, counter: 0, node: "n1" })

const emptyMeta: DocMeta = { fields: {}, tombstones: {} }

function stored(id: string, row: Todo): StoredDocument<Todo> {
  return { $id: id, $meta: emptyMeta, ...row }
}

let seq = 0
function op(
  type: OutboxOpType,
  rowId: string,
  payload: unknown,
  extra: Partial<OutboxEntry> = {},
): OutboxEntry {
  seq++
  return {
    id: `op-${seq}`,
    collection: "todos",
    rowId,
    type,
    payload,
    hlc: hlc(seq),
    createdAt: seq,
    retryCount: 0,
    ...extra,
  }
}

describe("stitchRecord", () => {
  it("returns a synced view when there are no pending ops", () => {
    const view = stitchRecord(stored("a", { title: "x", done: false }), [])
    expect(view).toMatchObject({
      $id: "a",
      title: "x",
      done: false,
      $sync: { $synced: true, $syncStatus: "synced" },
    })
  })

  it("returns null with no canonical row and no ops", () => {
    expect(stitchRecord<Todo>(undefined, [])).toBeNull()
  })

  //ST-001
  it("overlays a pending UPDATE and marks the row unsynced", () => {
    const view = stitchRecord(stored("a", { title: "x", done: false }), [
      op("UPDATE", "a", { title: "y" }),
    ])
    expect(view).toMatchObject({
      $id: "a",
      title: "y",
      done: false,
      $sync: { $synced: false, $syncStatus: "pending" },
    })
  })

  //ST-002
  it("hides a row with a pending DELETE", () => {
    const view = stitchRecord(stored("a", { title: "x", done: false }), [
      op("DELETE", "a", null),
    ])
    expect(view).toBeNull()
  })

  it("surfaces an INSERT that has no canonical row yet", () => {
    const view = stitchRecord<Todo>(undefined, [
      op("INSERT", "b", { title: "new", done: false }),
    ])
    expect(view).toMatchObject({
      $id: "b",
      title: "new",
      $sync: { $synced: false },
    })
  })

  it("folds INSERT then UPDATE into the final state", () => {
    const view = stitchRecord<Todo>(undefined, [
      op("INSERT", "b", { title: "new", done: false }),
      op("UPDATE", "b", { done: true }),
    ])
    expect(view).toMatchObject({ $id: "b", title: "new", done: true })
  })

  it("propagates an error stamp into $syncStatus", () => {
    const err: SyncError = { message: "nope", code: "403", timestamp: 1 }
    const view = stitchRecord(stored("a", { title: "x", done: false }), [
      op("UPDATE", "a", { title: "y" }, { error: err }),
    ])
    expect(view?.$sync).toMatchObject({
      $syncStatus: "error",
      $lastError: err,
    })
  })

  it("never leaks the internal $meta into the view", () => {
    const view = stitchRecord(stored("a", { title: "x", done: false }), [])
    expect(view).not.toHaveProperty("$meta")
  })
})

describe("stitchCollection", () => {
  it("merges canonical rows, applies ops, and appends pending inserts", () => {
    const canonical = [
      stored("a", { title: "keep", done: false }),
      stored("b", { title: "edit-me", done: false }),
      stored("c", { title: "delete-me", done: false }),
    ]
    const ops = [
      op("UPDATE", "b", { title: "edited" }),
      op("DELETE", "c", null),
      op("INSERT", "d", { title: "fresh", done: false }),
    ]

    const list = stitchCollection(canonical, ops)
    const byId = Object.fromEntries(list.map((r) => [r.$id, r]))

    expect(list).toHaveLength(3)
    expect(byId.a.$sync.$syncStatus).toBe("synced")
    expect(byId.b).toMatchObject({ title: "edited" })
    expect(byId.b.$sync.$synced).toBe(false)
    expect(byId.c).toBeUndefined()
    expect(byId.d).toMatchObject({ title: "fresh" })
  })
})
