import type {
  LocalDocument,
  OutboxEntry,
  RuntimeMeta,
  StoredDocument,
  SyncError,
  SyncStatus,
} from "#synq/types/synq.types"
import { CAUSAL_FIELD, ID_FIELD, SYNC_FIELD } from "#synq/types/synq.types"

//---- Optimistic read-time stitching -------------------------------
//the canonical store only ever holds the last-acked server state, kept
//pure so a discarded sync needs no rollback. the optimistic view the UI
//reads is computed on the fly: canonical row + its pending outbox ops,
//with the derived $sync flags stitched on and the internal $meta hidden.

type PlainRow = Record<string, unknown>

//drop the causal $meta but keep $id and the developer fields
function stripCausal<T>(doc: StoredDocument<T>): PlainRow {
  const out: PlainRow = {}
  for (const key of Object.keys(doc as PlainRow)) {
    if (key === CAUSAL_FIELD) continue
    out[key] = (doc as PlainRow)[key]
  }
  return out
}

function withSync<T>(row: PlainRow, sync: RuntimeMeta): LocalDocument<T> {
  return { ...row, [SYNC_FIELD]: sync } as LocalDocument<T>
}

//replay one rowId's chronological ops over its canonical state. returns
//null when the net effect is a deletion or an insert-then-delete ghost.
export function stitchRecord<T>(
  canonical: StoredDocument<T> | undefined,
  ops: OutboxEntry[],
): LocalDocument<T> | null {
  if (ops.length === 0) {
    if (!canonical) return null
    return withSync(stripCausal(canonical), {
      $synced: true,
      $syncStatus: "synced",
    })
  }

  let base: PlainRow | null = canonical ? stripCausal(canonical) : null
  let deleted = false
  let status: SyncStatus = "pending"
  let lastError: SyncError | undefined
  let rowId = canonical?.[ID_FIELD]

  for (const op of ops) {
    rowId = op.rowId
    if (op.type === "INSERT") {
      base = { ...(op.payload as PlainRow), [ID_FIELD]: op.rowId }
      deleted = false
    } else if (op.type === "UPDATE") {
      const patch = op.payload as PlainRow
      base = base
        ? { ...base, ...patch }
        : { ...patch, [ID_FIELD]: op.rowId }
    } else if (op.type === "DELETE") {
      deleted = true
    }
    if (op.error) {
      status = "error"
      lastError = op.error
    }
  }

  if (deleted || !base) return null
  if (!(ID_FIELD in base) && rowId) base[ID_FIELD] = rowId

  const sync: RuntimeMeta = lastError
    ? { $synced: false, $syncStatus: status, $lastError: lastError }
    : { $synced: false, $syncStatus: status }
  return withSync(base, sync)
}

//build the full optimistic list for a collection: every canonical row
//with its ops applied, plus inserts that have no canonical row yet.
//ops must arrive in chronological (causal) order per rowId.
export function stitchCollection<T>(
  canonicalRows: StoredDocument<T>[],
  ops: OutboxEntry[],
): LocalDocument<T>[] {
  const opsByRow = new Map<string, OutboxEntry[]>()
  for (const op of ops) {
    const list = opsByRow.get(op.rowId)
    if (list) list.push(op)
    else opsByRow.set(op.rowId, [op])
  }

  const result: LocalDocument<T>[] = []
  const seen = new Set<string>()

  for (const row of canonicalRows) {
    const id = row[ID_FIELD]
    seen.add(id)
    const stitched = stitchRecord(row, opsByRow.get(id) ?? [])
    if (stitched) result.push(stitched)
  }

  for (const [id, rowOps] of opsByRow) {
    if (seen.has(id)) continue
    const stitched = stitchRecord<T>(undefined, rowOps)
    if (stitched) result.push(stitched)
  }

  return result
}
