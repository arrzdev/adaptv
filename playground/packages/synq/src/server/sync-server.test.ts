import { describe, expect, it } from "vitest"
import { createMemoryDocumentStore } from "#synq/server/memory.store"
import type { ServerDocumentStore } from "#synq/server/server.types"
import { createSyncServer } from "#synq/server/sync-server"
import type { DocMeta, Hlc, StoredDocument } from "#synq/types/synq.types"

type Todo = { title: string; checked: boolean }

const H = (wall: number, node = "n1"): Hlc => ({ wall, counter: 0, node })

function stored(
  id: string,
  row: Todo,
  fields: Record<string, Hlc>,
): StoredDocument<Todo> {
  const meta: DocMeta = { fields, tombstones: {} }
  return { $id: id, $meta: meta, ...row }
}

function tombstone(id: string, wall: number): StoredDocument<Todo> {
  return {
    $id: id,
    $meta: { fields: {}, tombstones: {}, deletedAt: H(wall) },
  } as StoredDocument<Todo>
}

describe("createSyncServer — push", () => {
  it("persists new documents and acks each item", async () => {
    const server = createSyncServer(createMemoryDocumentStore())
    const doc = stored(
      "a",
      { title: "new", checked: false },
      { title: H(1), checked: H(1) },
    )
    const res = await server.push("u1", "todos", {
      items: [{ id: "a", doc }],
    })
    expect(res.results).toEqual({ a: "ok" })

    const pulled = await server.pull("u1", "todos", { since: 0 })
    expect(pulled.changes).toHaveLength(1)
    expect(pulled.changes[0]).toMatchObject({ title: "new" })
  })

  it("converges concurrent pushes from two devices (field-level merge)", async () => {
    const server = createSyncServer(createMemoryDocumentStore())
    const base = stored(
      "a",
      { title: "orig", checked: false },
      { title: H(1), checked: H(1) },
    )
    await server.push("u1", "todos", { items: [{ id: "a", doc: base }] })

    //device A retitles, device B toggles — non-overlapping edits
    const fromA = stored(
      "a",
      { title: "renamed", checked: false },
      { title: H(5, "devA"), checked: H(1) },
    )
    const fromB = stored(
      "a",
      { title: "orig", checked: true },
      { title: H(1), checked: H(6, "devB") },
    )
    await server.push("u1", "todos", { items: [{ id: "a", doc: fromA }] })
    await server.push("u1", "todos", { items: [{ id: "a", doc: fromB }] })

    const { changes } = await server.pull("u1", "todos", { since: 0 })
    expect(changes[0]).toMatchObject({ title: "renamed", checked: true })
  })

  it("rejects a malformed document as invalid without persisting it", async () => {
    const server = createSyncServer(createMemoryDocumentStore())
    const broken = {
      $id: "a",
      title: "no meta",
    } as unknown as StoredDocument<Todo>
    const res = await server.push("u1", "todos", {
      items: [{ id: "a", doc: broken }],
    })
    expect(res.results).toEqual({ a: "invalid" })
    const { changes } = await server.pull("u1", "todos", { since: 0 })
    expect(changes).toHaveLength(0)
  })

  it("rejects an id/doc mismatch as invalid", async () => {
    const server = createSyncServer(createMemoryDocumentStore())
    const doc = stored(
      "other",
      { title: "x", checked: false },
      { title: H(1), checked: H(1) },
    )
    const res = await server.push("u1", "todos", {
      items: [{ id: "a", doc }],
    })
    expect(res.results).toEqual({ a: "invalid" })
  })

  it("stores a pushed delete as a pullable tombstone", async () => {
    const server = createSyncServer(createMemoryDocumentStore())
    await server.push("u1", "todos", {
      items: [
        {
          id: "a",
          doc: stored(
            "a",
            { title: "doomed", checked: false },
            { title: H(1), checked: H(1) },
          ),
        },
      ],
    })
    await server.push("u1", "todos", {
      items: [{ id: "a", doc: tombstone("a", 9) }],
    })
    const { changes } = await server.pull("u1", "todos", { since: 0 })
    expect(changes).toHaveLength(1)
    expect(changes[0].$meta.deletedAt).toEqual(H(9))
  })

  it("isolates scopes: one user's push is invisible to another", async () => {
    const server = createSyncServer(createMemoryDocumentStore())
    await server.push("u1", "todos", {
      items: [
        {
          id: "a",
          doc: stored(
            "a",
            { title: "mine", checked: false },
            { title: H(1), checked: H(1) },
          ),
        },
      ],
    })
    const other = await server.pull("u2", "todos", { since: 0 })
    expect(other.changes).toHaveLength(0)
  })
})

describe("createSyncServer — pull cursor", () => {
  it("derives nextCursor from the returned rows, not the counter", async () => {
    //a seq can be RESERVED but not yet written (a concurrent push mid-
    //flight). the cursor must never advance past what was actually returned.
    const inner = createMemoryDocumentStore()
    const store: ServerDocumentStore = {
      ...inner,
      //simulate: another push reserved seqs but hasn't written its rows yet
      async getChangesSince(scope, collection, since) {
        const rows = await inner.getChangesSince(scope, collection, since)
        await inner.allocateSeq(scope, collection, 5)
        return rows
      },
    }
    const server = createSyncServer(store)
    await server.push("u1", "todos", {
      items: [
        {
          id: "a",
          doc: stored(
            "a",
            { title: "x", checked: false },
            { title: H(1), checked: H(1) },
          ),
        },
      ],
    })
    const { nextCursor } = await server.pull("u1", "todos", { since: 0 })
    //row "a" has seq 1; the 5 reserved-but-unwritten seqs must not leak in
    expect(nextCursor).toBe(1)
  })

  it("returns only changes after the cursor and keeps since when empty", async () => {
    const server = createSyncServer(createMemoryDocumentStore())
    await server.push("u1", "todos", {
      items: [
        {
          id: "a",
          doc: stored(
            "a",
            { title: "one", checked: false },
            { title: H(1), checked: H(1) },
          ),
        },
      ],
    })
    const first = await server.pull("u1", "todos", { since: 0 })
    expect(first.changes).toHaveLength(1)

    const second = await server.pull("u1", "todos", {
      since: first.nextCursor,
    })
    expect(second.changes).toHaveLength(0)
    expect(second.nextCursor).toBe(first.nextCursor)
  })
})
