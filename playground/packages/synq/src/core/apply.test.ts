import { describe, expect, it } from "vitest"
import { applyOps } from "#synq/core/apply"
import { isDeleted } from "#synq/core/merge"
import type {
  DocMeta,
  Hlc,
  OutboxEntry,
  OutboxOpType,
  StoredDocument,
} from "#synq/types/synq.types"

type Todo = { title: string; checked: boolean; priority?: number }

const H = (wall: number): Hlc => ({ wall, counter: 0, node: "n1" })
const emptyMeta: DocMeta = { fields: {}, tombstones: {} }

function stored(
  id: string,
  row: Todo,
  fields: Record<string, Hlc>,
): StoredDocument<Todo> {
  return { $id: id, $meta: { ...emptyMeta, fields }, ...row }
}

let seq = 0
function op(
  type: OutboxOpType,
  rowId: string,
  payload: unknown,
  wall: number,
): OutboxEntry {
  seq++
  return {
    id: `op-${seq}`,
    collection: "todos",
    rowId,
    type,
    payload,
    hlc: H(wall),
    createdAt: wall,
    retryCount: 0,
  }
}

describe("applyOps", () => {
  it("stamps every field of an INSERT with the op hlc", () => {
    const result = applyOps<Todo>(undefined, [
      op("INSERT", "a", { title: "x", checked: false }, 5),
    ])
    expect(result.$id).toBe("a")
    expect(result.title).toBe("x")
    expect(result.$meta.fields.title).toEqual(H(5))
    expect(result.$meta.fields.checked).toEqual(H(5))
  })

  it("stamps only the changed field of an UPDATE, keeping prior stamps", () => {
    const canonical = stored(
      "a",
      { title: "x", checked: false },
      { title: H(1), checked: H(1) },
    )
    const result = applyOps(canonical, [
      op("UPDATE", "a", { checked: true }, 9),
    ])
    expect(result.checked).toBe(true)
    expect(result.$meta.fields.checked).toEqual(H(9))
    expect(result.$meta.fields.title).toEqual(H(1))
  })

  it("tombstones a cleared (undefined) field", () => {
    const canonical = stored(
      "a",
      { title: "x", checked: false, priority: 3 },
      { title: H(1), checked: H(1), priority: H(1) },
    )
    const result = applyOps(canonical, [
      op("UPDATE", "a", { priority: undefined }, 9),
    ])
    expect(result).not.toHaveProperty("priority")
    expect(result.$meta.fields.priority).toBeUndefined()
    expect(result.$meta.tombstones.priority).toEqual(H(9))
  })

  it("records a row deletion", () => {
    const canonical = stored(
      "a",
      { title: "x", checked: false },
      { title: H(1), checked: H(1) },
    )
    const result = applyOps(canonical, [op("DELETE", "a", null, 9)])
    expect(result.$meta.deletedAt).toEqual(H(9))
    expect(isDeleted(result)).toBe(true)
  })

  it("folds INSERT then UPDATE into the final stamped state", () => {
    const result = applyOps<Todo>(undefined, [
      op("INSERT", "a", { title: "x", checked: false }, 2),
      op("UPDATE", "a", { title: "y" }, 4),
    ])
    expect(result.title).toBe("y")
    expect(result.$meta.fields.title).toEqual(H(4))
    expect(result.$meta.fields.checked).toEqual(H(2))
  })
})
