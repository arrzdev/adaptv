import { maxHlc } from "#synq/core/hlc"
import type {
  Hlc,
  OutboxEntry,
  OutboxOpType,
} from "#synq/types/synq.types"

//---- Sync-time coalescing -----------------------------------------
//the outbox is an append-only log while offline. right before a push we
//compact each rowId's ops into the minimum needed on the wire. this is
//deferred (not done per keystroke) so the live log stays a cheap, honest
//timeline until the moment it matters.
//
//  INSERT  -> DELETE              => voided (ghost born and died offline)
//  UPDATE  -> UPDATE              => one UPDATE with merged payload
//  INSERT  -> UPDATE              => one INSERT carrying the final state
//  UPDATE  -> DELETE              => DELETE (prior edits are moot)

type PlainRow = Record<string, unknown>

export function coalesceRow(ops: OutboxEntry[]): OutboxEntry[] {
  if (ops.length === 0) return []

  let type: OutboxOpType | null = null
  let payload: PlainRow = {}
  const tombstones: Record<string, Hlc> = {}
  let bornLocally = false
  let insertId: string | undefined

  let hlc = ops[0].hlc
  let createdAt = ops[0].createdAt
  let retryCount = 0
  let lastId = ops[0].id

  for (const op of ops) {
    hlc = maxHlc(hlc, op.hlc)
    if (op.createdAt > createdAt) createdAt = op.createdAt
    if (op.retryCount > retryCount) retryCount = op.retryCount
    lastId = op.id

    if (op.tombstones) {
      for (const [key, stamp] of Object.entries(op.tombstones)) {
        tombstones[key] = tombstones[key]
          ? maxHlc(tombstones[key], stamp)
          : stamp
      }
    }

    if (op.type === "INSERT") {
      bornLocally = true
      type = "INSERT"
      insertId = op.id
      payload = { ...(op.payload as PlainRow) }
    } else if (op.type === "UPDATE") {
      payload =
        type === "DELETE"
          ? { ...(op.payload as PlainRow) }
          : { ...payload, ...(op.payload as PlainRow) }
      if (type !== "INSERT") type = "UPDATE"
    } else {
      type = "DELETE"
    }
  }

  const first = ops[0]
  function build(
    opType: OutboxOpType,
    id: string,
    body: unknown,
  ): OutboxEntry {
    const entry: OutboxEntry = {
      id,
      collection: first.collection,
      rowId: first.rowId,
      type: opType,
      payload: body,
      hlc,
      createdAt,
      retryCount,
    }
    if (Object.keys(tombstones).length > 0) {
      return { ...entry, tombstones }
    }
    return entry
  }

  if (type === "DELETE") {
    if (bornLocally) return []
    return [build("DELETE", lastId, null)]
  }
  if (type === "INSERT") {
    return [build("INSERT", insertId ?? lastId, payload)]
  }
  return [build("UPDATE", lastId, payload)]
}

//compact a whole outbox, grouping by rowId (insertion order preserved so
//independent rows keep their relative timeline).
export function coalesce(ops: OutboxEntry[]): OutboxEntry[] {
  const byRow = new Map<string, OutboxEntry[]>()
  for (const op of ops) {
    const list = byRow.get(op.rowId)
    if (list) list.push(op)
    else byRow.set(op.rowId, [op])
  }

  const out: OutboxEntry[] = []
  for (const list of byRow.values()) {
    out.push(...coalesceRow(list))
  }
  return out
}
