import { describe, expect, it } from "vitest"
import { createMemoryStorage } from "#synq/adapters/memory.adapter"
import type { SyncCollection } from "#synq/core/sync-engine"
import { syncCollection } from "#synq/core/sync-engine"
import type { Change, TxContext } from "#synq/types/collection.types"
import type {
  DocMeta,
  Hlc,
  OutboxEntry,
  OutboxOpType,
  StoredDocument,
} from "#synq/types/synq.types"

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

const ackAll = {
  inserts: async (items: { opId: string }[], ctx: TxContext) => {
    for (const i of items) ctx.ack(i.opId)
  },
  updates: async (items: { opId: string }[], ctx: TxContext) => {
    for (const i of items) ctx.ack(i.opId)
  },
  deletes: async (items: { opId: string }[], ctx: TxContext) => {
    for (const i of items) ctx.ack(i.opId)
  },
}

describe("syncCollection — pull (ingress)", () => {
  it("applies remote rows and advances the cursor", async () => {
    const s = createMemoryStorage()
    const col: SyncCollection = {
      name: "todos",
      pull: async () => ({
        changes: [
          stored(
            "a",
            { title: "from server", checked: false },
            { title: H(1), checked: H(1) },
          ),
        ],
        nextCursor: 10,
      }),
    }
    const out = await syncCollection(s, col)
    expect(out.pulled).toBe(1)
    expect(await s.getCursor("todos")).toBe(10)
    expect(await s.getRow("todos", "a")).toMatchObject({
      title: "from server",
    })
  })

  //SY-001
  it("leaves storage untouched when pull throws", async () => {
    const s = createMemoryStorage()
    await s.transact((tx) => {
      tx.putRows("todos", [
        stored(
          "a",
          { title: "local", checked: false },
          { title: H(1), checked: H(1) },
        ),
      ])
      tx.appendOps([op("UPDATE", "a", { checked: true }, 5)])
    })
    const col: SyncCollection = {
      name: "todos",
      pull: async () => {
        throw new Error("offline")
      },
      push: ackAll,
    }
    await expect(syncCollection(s, col)).rejects.toThrow("offline")
    expect(await s.getOps("todos")).toHaveLength(1)
    expect(await s.getRow("todos", "a")).toMatchObject({ checked: false })
  })
})

describe("syncCollection — push (egress)", () => {
  it("pushes a local insert, acks it, and clears the outbox", async () => {
    const s = createMemoryStorage()
    await s.transact((tx) =>
      tx.appendOps([
        op("INSERT", "a", { title: "new", checked: false }, 5),
      ]),
    )
    let received = 0
    const col: SyncCollection = {
      name: "todos",
      push: {
        ...ackAll,
        inserts: async (items, ctx) => {
          received = items.length
          for (const i of items) ctx.ack(i.opId)
        },
      },
    }
    const out = await syncCollection(s, col)
    expect(received).toBe(1)
    expect(out.acked).toBe(1)
    expect(await s.getOps("todos")).toHaveLength(0)
    expect(await s.getRow("todos", "a")).toMatchObject({ title: "new" })
  })

  it("keeps the op when the developer retries", async () => {
    const s = createMemoryStorage()
    await s.transact((tx) =>
      tx.appendOps([
        op("INSERT", "a", { title: "new", checked: false }, 5),
      ]),
    )
    const col: SyncCollection = {
      name: "todos",
      push: {
        ...ackAll,
        inserts: async (items, ctx) => {
          for (const i of items)
            ctx.retry(i.opId, { message: "503", code: "503" })
        },
      },
    }
    const out = await syncCollection(s, col)
    expect(out.retried).toBe(1)
    expect(await s.getOps("todos")).toHaveLength(1)
  })

  it("drops the op and reverts on discard", async () => {
    const s = createMemoryStorage()
    await s.transact((tx) =>
      tx.appendOps([
        op("INSERT", "a", { title: "new", checked: false }, 5),
      ]),
    )
    const col: SyncCollection = {
      name: "todos",
      push: {
        ...ackAll,
        inserts: async (items, ctx) => {
          for (const i of items)
            ctx.discard(i.opId, { message: "403", code: "403" })
        },
      },
    }
    const out = await syncCollection(s, col)
    expect(out.discarded).toBe(1)
    expect(await s.getOps("todos")).toHaveLength(0)
    //rejected insert never had canonical state → row is gone
    expect(await s.getRow("todos", "a")).toBeUndefined()
  })

  it("aborts and keeps the outbox when push throws", async () => {
    const s = createMemoryStorage()
    await s.transact((tx) =>
      tx.appendOps([
        op("INSERT", "a", { title: "new", checked: false }, 5),
      ]),
    )
    const col: SyncCollection = {
      name: "todos",
      push: {
        ...ackAll,
        inserts: async () => {
          throw new Error("network")
        },
      },
    }
    await expect(syncCollection(s, col)).rejects.toThrow("network")
    expect(await s.getOps("todos")).toHaveLength(1)
    expect(await s.getRow("todos", "a")).toBeUndefined()
  })
})

describe("syncCollection — pull then push (field-level LWW)", () => {
  it("merges non-overlapping local + remote edits, then pushes the merge", async () => {
    const s = createMemoryStorage()
    await s.transact((tx) => {
      tx.putRows("todos", [
        stored(
          "a",
          { title: "orig", checked: false },
          { title: H(1), checked: H(1) },
        ),
      ])
      //local toggled checked at H(5)
      tx.appendOps([op("UPDATE", "a", { checked: true }, 5)])
    })
    let pushedDoc: StoredDocument<Todo> | undefined
    const col: SyncCollection = {
      name: "todos",
      //server changed the title at H(3)
      pull: async () => ({
        changes: [
          stored(
            "a",
            { title: "server-title", checked: false },
            { title: H(3), checked: H(1) },
          ),
        ],
        nextCursor: 1,
      }),
      push: {
        ...ackAll,
        updates: async (items, ctx) => {
          pushedDoc = items[0].doc as StoredDocument<Todo>
          for (const i of items) ctx.ack(i.opId)
        },
      },
    }
    const out = await syncCollection(s, col)
    expect(out.acked).toBe(1)
    //both edits survive: remote title + local checked
    expect(pushedDoc).toMatchObject({
      title: "server-title",
      checked: true,
    })
    expect(await s.getRow("todos", "a")).toMatchObject({
      title: "server-title",
      checked: true,
    })
    expect(await s.getOps("todos")).toHaveLength(0)
  })

  it("skips the push when the merged state already equals the server", async () => {
    const s = createMemoryStorage()
    await s.transact((tx) => {
      tx.putRows("todos", [
        stored(
          "a",
          { title: "orig", checked: false },
          { title: H(1), checked: H(1) },
        ),
      ])
      tx.appendOps([op("UPDATE", "a", { checked: true }, 5)])
    })
    let pushCalls = 0
    const col: SyncCollection = {
      name: "todos",
      //server already has checked:true at a newer stamp
      pull: async () => ({
        changes: [
          stored(
            "a",
            { title: "orig", checked: true },
            { title: H(1), checked: H(9) },
          ),
        ],
        nextCursor: 1,
      }),
      push: {
        ...ackAll,
        updates: async (items, ctx) => {
          pushCalls += items.length
          for (const i of items) ctx.ack(i.opId)
        },
      },
    }
    const out = await syncCollection(s, col)
    expect(pushCalls).toBe(0)
    expect(out.skipped).toBe(1)
    expect(await s.getOps("todos")).toHaveLength(0)
    expect(await s.getRow("todos", "a")).toMatchObject({ checked: true })
  })
})

describe("syncCollection — failure branches", () => {
  it("offline insert→update→delete sends ZERO network + drains the outbox", async () => {
    //the network-optimal guarantee: a row born and killed offline never
    //reaches the wire AND leaves no orphan ops behind.
    const s = createMemoryStorage()
    await s.transact((tx) =>
      tx.appendOps([
        op("INSERT", "ghost", { title: "x", checked: false }, 1),
        op("UPDATE", "ghost", { checked: true }, 2),
        op("DELETE", "ghost", null, 3),
      ]),
    )
    let pushCalls = 0
    const count = async (items: { opId: string }[], ctx: TxContext) => {
      pushCalls += items.length
      for (const i of items) ctx.ack(i.opId)
    }
    const col: SyncCollection = {
      name: "todos",
      pull: async () => ({ changes: [], nextCursor: 1 }),
      push: { inserts: count, updates: count, deletes: count },
    }
    const out = await syncCollection(s, col)
    expect(pushCalls).toBe(0)
    expect(out.pushed).toBe(0)
    expect(await s.getOps("todos")).toHaveLength(0)
    expect(await s.getRow("todos", "ghost")).toBeUndefined()
  })

  it("resolves a 3-row batch independently: ack / retry / discard", async () => {
    const s = createMemoryStorage()
    await s.transact((tx) =>
      tx.appendOps([
        op("INSERT", "a", { title: "a", checked: false }, 5),
        op("INSERT", "b", { title: "b", checked: false }, 6),
        op("INSERT", "c", { title: "c", checked: false }, 7),
      ]),
    )
    const col: SyncCollection = {
      name: "todos",
      push: {
        ...ackAll,
        inserts: async (items, ctx) => {
          for (const i of items) {
            if (i.id === "a") ctx.ack(i.opId)
            else if (i.id === "b")
              ctx.retry(i.opId, { message: "503", code: "503" })
            else ctx.discard(i.opId, { message: "403", code: "403" })
          }
        },
      },
    }
    const out = await syncCollection(s, col)
    expect(out).toMatchObject({ acked: 1, retried: 1, discarded: 1 })
    //a committed + purged, b kept for retry, c reverted + purged
    expect(await s.getRow("todos", "a")).toMatchObject({ title: "a" })
    expect(await s.getRow("todos", "b")).toBeUndefined()
    expect(await s.getRow("todos", "c")).toBeUndefined()
    const remaining = await s.getOps("todos")
    expect(remaining).toHaveLength(1)
    expect(remaining[0].rowId).toBe("b")
  })

  it("does NOT persist an ack if the push aborts later in the batch", async () => {
    //the deepest abort-safety rule: an in-memory ack is worthless unless the
    //whole run commits. a throw after a partial ack must roll everything back.
    const s = createMemoryStorage()
    await s.transact((tx) =>
      tx.appendOps([
        op("INSERT", "a", { title: "a", checked: false }, 5),
        op("INSERT", "b", { title: "b", checked: false }, 6),
      ]),
    )
    const col: SyncCollection = {
      name: "todos",
      push: {
        ...ackAll,
        inserts: async (items, ctx) => {
          ctx.ack(items[0].opId) //ack one…
          throw new Error("network") //…then die before the swap
        },
      },
    }
    await expect(syncCollection(s, col)).rejects.toThrow("network")
    expect(await s.getOps("todos")).toHaveLength(2)
    expect(await s.getRow("todos", "a")).toBeUndefined()
    expect(await s.getRow("todos", "b")).toBeUndefined()
  })

  it("keeps a local write made WHILE a sync is in flight", async () => {
    //snapshot isolation: the engine only purges the ops it saw at the start,
    //so a mutation that lands mid-push survives to the next cycle.
    const s = createMemoryStorage()
    await s.transact((tx) =>
      tx.appendOps([
        op("INSERT", "a", { title: "new", checked: false }, 5),
      ]),
    )
    const col: SyncCollection = {
      name: "todos",
      push: {
        ...ackAll,
        inserts: async (items, ctx) => {
          //user toggles checked while the insert is being pushed
          await s.transact((tx) =>
            tx.appendOps([op("UPDATE", "a", { checked: true }, 9)]),
          )
          for (const i of items) ctx.ack(i.opId)
        },
      },
    }
    const out = await syncCollection(s, col)
    expect(out.acked).toBe(1)
    //the insert is acked/committed, the mid-flight update is still pending
    expect(await s.getRow("todos", "a")).toMatchObject({ checked: false })
    const pending = await s.getOps("todos")
    expect(pending).toHaveLength(1)
    expect(pending[0].type).toBe("UPDATE")
  })

  it("keeps the op (no data loss) when the push reports nothing", async () => {
    //never assume silent success — an unreported op is retained defensively
    const s = createMemoryStorage()
    await s.transact((tx) =>
      tx.appendOps([
        op("INSERT", "a", { title: "new", checked: false }, 5),
      ]),
    )
    const col: SyncCollection = {
      name: "todos",
      push: {
        ...ackAll,
        inserts: async () => {
          //handler resolves nothing
        },
      },
    }
    const out = await syncCollection(s, col)
    expect(out.acked).toBe(0)
    expect(await s.getOps("todos")).toHaveLength(1)
  })

  it("propagates a pulled delete, removing the local row", async () => {
    const s = createMemoryStorage()
    await s.transact((tx) =>
      tx.putRows("todos", [
        stored(
          "a",
          { title: "doomed", checked: false },
          { title: H(1), checked: H(1) },
        ),
      ]),
    )
    const tombstone = {
      $id: "a",
      $meta: { fields: {}, tombstones: {}, deletedAt: H(9) },
    } as StoredDocument<Todo>
    const col: SyncCollection = {
      name: "todos",
      pull: async () => ({ changes: [tombstone], nextCursor: 1 }),
    }
    await syncCollection(s, col)
    expect(await s.getRow("todos", "a")).toBeUndefined()
  })

  it("delete wins over a concurrent local edit, without a redundant push", async () => {
    //local edit races a remote delete. delete wins permanently; the local
    //op is dropped and nothing is pushed (server already holds the tombstone).
    const s = createMemoryStorage()
    await s.transact((tx) => {
      tx.putRows("todos", [
        stored(
          "a",
          { title: "orig", checked: false },
          { title: H(1), checked: H(1) },
        ),
      ])
      tx.appendOps([op("UPDATE", "a", { checked: true }, 5)])
    })
    let pushCalls = 0
    const tombstone = {
      $id: "a",
      $meta: { fields: {}, tombstones: {}, deletedAt: H(3) },
    } as StoredDocument<Todo>
    const col: SyncCollection = {
      name: "todos",
      pull: async () => ({ changes: [tombstone], nextCursor: 1 }),
      push: {
        ...ackAll,
        updates: async (items, ctx) => {
          pushCalls += items.length
          for (const i of items) ctx.ack(i.opId)
        },
        deletes: async (items, ctx) => {
          pushCalls += items.length
          for (const i of items) ctx.ack(i.opId)
        },
      },
    }
    await syncCollection(s, col)
    expect(pushCalls).toBe(0)
    expect(await s.getRow("todos", "a")).toBeUndefined()
    expect(await s.getOps("todos")).toHaveLength(0)
  })
})

describe("syncCollection — scope cursor", () => {
  it("namespaces the cursor per scope so a new scope pulls fresh", async () => {
    const s = createMemoryStorage()
    let seenCursor: unknown = "sentinel"
    const scopeA: SyncCollection = {
      name: "todos",
      cursorKey: "todos::userA",
      pull: async (cursor) => {
        seenCursor = cursor
        return { changes: [], nextCursor: 7 }
      },
    }
    await syncCollection(s, scopeA)
    expect(seenCursor).toBeUndefined() //first pull for userA
    expect(await s.getCursor("todos::userA")).toBe(7)

    seenCursor = "sentinel"
    const scopeB: SyncCollection = {
      name: "todos",
      cursorKey: "todos::userB",
      pull: async (cursor) => {
        seenCursor = cursor
        return { changes: [], nextCursor: 9 }
      },
    }
    await syncCollection(s, scopeB)
    //userB starts fresh despite userA's stored cursor — no skipped rows
    expect(seenCursor).toBeUndefined()
    expect(await s.getCursor("todos::userB")).toBe(9)
    expect(await s.getCursor("todos::userA")).toBe(7) //untouched
  })
})

describe("syncCollection — unified push (array form)", () => {
  it("delivers one type-tagged batch carrying delta + full snapshot", async () => {
    const s = createMemoryStorage()
    await s.transact((tx) => {
      tx.putRows("todos", [
        stored(
          "ex",
          { title: "old", checked: false },
          { title: H(1), checked: H(1) },
        ),
      ])
      tx.appendOps([
        op("INSERT", "a", { title: "new", checked: false }, 5),
        op("UPDATE", "ex", { checked: true }, 6),
      ])
    })
    let received: Change<Todo>[] = []
    const col: SyncCollection = {
      name: "todos",
      push: async (changes, ctx) => {
        received = changes as Change<Todo>[]
        for (const c of changes) ctx.ack(c.opId)
      },
    }
    const out = await syncCollection(s, col)
    expect(out.acked).toBe(2)

    const byId = Object.fromEntries(received.map((c) => [c.id, c]))
    expect(byId.a.type).toBe("insert")
    expect(byId.a.delta).toMatchObject({ title: "new" })
    expect(byId.a.doc).toMatchObject({ title: "new" })
    //update: delta is ONLY the touched field, doc is the full merged snapshot
    expect(byId.ex.type).toBe("update")
    expect(byId.ex.delta).toEqual({ checked: true })
    expect(byId.ex.doc).toMatchObject({ title: "old", checked: true })
    expect(await s.getOps("todos")).toHaveLength(0)
  })

  it("honors per-change ack/retry in the unified handler", async () => {
    const s = createMemoryStorage()
    await s.transact((tx) =>
      tx.appendOps([
        op("INSERT", "a", { title: "a", checked: false }, 5),
        op("INSERT", "b", { title: "b", checked: false }, 6),
      ]),
    )
    const col: SyncCollection = {
      name: "todos",
      push: async (changes, ctx) => {
        for (const c of changes) {
          if (c.id === "a") ctx.ack(c.opId)
          else ctx.retry(c.opId, { message: "503", code: "503" })
        }
      },
    }
    const out = await syncCollection(s, col)
    expect(out.acked).toBe(1)
    expect(out.retried).toBe(1)
    const ops = await s.getOps("todos")
    expect(ops).toHaveLength(1)
    expect(ops[0].rowId).toBe("b")
  })
})

describe("syncCollection — error surfacing + retry budget", () => {
  it("stamps the retry error and bumps retryCount on the kept ops", async () => {
    const s = createMemoryStorage()
    await s.transact((tx) =>
      tx.appendOps([
        op("INSERT", "a", { title: "new", checked: false }, 5),
      ]),
    )
    const col: SyncCollection = {
      name: "todos",
      push: {
        ...ackAll,
        inserts: async (items, ctx) => {
          for (const i of items)
            ctx.retry(i.opId, { message: "503", code: "503" })
        },
      },
    }
    await syncCollection(s, col)
    const [kept] = await s.getOps("todos")
    expect(kept.retryCount).toBe(1)
    expect(kept.error).toMatchObject({ message: "503", code: "503" })
    expect(typeof kept.error?.timestamp).toBe("number")

    //a second failing cycle keeps counting
    await syncCollection(s, col)
    const [keptAgain] = await s.getOps("todos")
    expect(keptAgain.retryCount).toBe(2)
  })

  it("bumps retryCount without an error stamp when retry passes none", async () => {
    const s = createMemoryStorage()
    await s.transact((tx) =>
      tx.appendOps([
        op("INSERT", "a", { title: "new", checked: false }, 5),
      ]),
    )
    const col: SyncCollection = {
      name: "todos",
      push: {
        ...ackAll,
        inserts: async (items, ctx) => {
          for (const i of items) ctx.retry(i.opId)
        },
      },
    }
    await syncCollection(s, col)
    const [kept] = await s.getOps("todos")
    expect(kept.retryCount).toBe(1)
    expect(kept.error).toBeUndefined()
  })

  it("does NOT consume retry budget for an unreported op", async () => {
    //an unreported op is a broken transport, not a server rejection — it is
    //kept defensively but never counts toward maxRetries
    const s = createMemoryStorage()
    await s.transact((tx) =>
      tx.appendOps([
        op("INSERT", "a", { title: "new", checked: false }, 5),
      ]),
    )
    const col: SyncCollection = {
      name: "todos",
      maxRetries: 1,
      push: {
        ...ackAll,
        inserts: async () => {
          //handler resolves nothing
        },
      },
    }
    await syncCollection(s, col)
    await syncCollection(s, col)
    const [kept] = await s.getOps("todos")
    expect(kept.retryCount).toBe(0)
  })

  it("gives up after maxRetries: drops the ops and reverts to server truth", async () => {
    const s = createMemoryStorage()
    await s.transact((tx) =>
      tx.appendOps([
        op("INSERT", "a", { title: "new", checked: false }, 5),
      ]),
    )
    const col: SyncCollection = {
      name: "todos",
      maxRetries: 1,
      push: {
        ...ackAll,
        inserts: async (items, ctx) => {
          for (const i of items)
            ctx.retry(i.opId, { message: "503", code: "503" })
        },
      },
    }
    //cycle 1: retryCount 0 → 1 (within budget, kept)
    const first = await syncCollection(s, col)
    expect(first.retried).toBe(1)
    expect(await s.getOps("todos")).toHaveLength(1)

    //cycle 2: would exceed maxRetries → escalated to discard, row reverts
    const second = await syncCollection(s, col)
    expect(second.discarded).toBe(1)
    expect(second.retried).toBe(0)
    expect(await s.getOps("todos")).toHaveLength(0)
    expect(await s.getRow("todos", "a")).toBeUndefined()
  })
})

describe("syncCollection — local-only", () => {
  it("self-commits outbox ops into canonical when there is no push", async () => {
    const s = createMemoryStorage()
    await s.transact((tx) =>
      tx.appendOps([
        op("INSERT", "a", { title: "draft", checked: false }, 5),
      ]),
    )
    await syncCollection(s, { name: "todos" })
    expect(await s.getOps("todos")).toHaveLength(0)
    expect(await s.getRow("todos", "a")).toMatchObject({ title: "draft" })
  })
})
