//---- Reserved keys -------------------------------------------------
//framework-owned properties live under fixed keys so they can never
//collide with developer field names. $id and $meta are persisted with
//the row; $sync is derived at read-time and never written to storage.

export const ID_FIELD = "$id" as const
export const CAUSAL_FIELD = "$meta" as const
export const SYNC_FIELD = "$sync" as const

//---- Hybrid Logical Clock -----------------------------------------
//a causal timestamp that is monotonic per node and totally orderable
//across nodes. wall is physical ms, counter disambiguates events in
//the same ms (and lets a lagging clock still move forward), node is
//the stable id of the device that produced the stamp.

export interface Hlc {
  readonly wall: number
  readonly counter: number
  readonly node: string
}

//---- Document metadata --------------------------------------------
//per-field causal stamps drive field-level last-write-wins; tombstones
//record removals (a cleared field or a dropped array element keyed as
//"field::element") so an older remote write can't resurrect dead data.

//a value that LOST a concurrent same-field write but is kept instead of being
//silently dropped, so a LWW loss is recoverable/surfaceable. `against` is the
//winning stamp at capture time — once the field's live stamp moves past it (a
//later write = resolution), the conflict is garbage-collected.
export interface FieldConflict {
  readonly hlc: Hlc
  readonly value: unknown
  readonly against: Hlc
}

export interface DocMeta {
  readonly fields: Readonly<Record<string, Hlc>>
  readonly tombstones: Readonly<Record<string, Hlc>>
  //set when the whole row was deleted; resolved against field writes as a
  //row-level LWW register (a field written later resurrects the row)
  readonly deletedAt?: Hlc
  //per-scalar-field shadowed losing values from genuinely concurrent writes
  //(both sides diverged from a common base). absent when there are none.
  readonly conflicts?: Readonly<Record<string, readonly FieldConflict[]>>
}

//a row as it lives in the canonical store: the developer's shape plus a
//framework id and the causal metadata used for merging.
export type StoredDocument<T> = T & {
  readonly [ID_FIELD]: string
  readonly [CAUSAL_FIELD]: DocMeta
}

//---- Read-time runtime view ---------------------------------------

export type SyncStatus = "synced" | "pending" | "error"

export interface SyncError {
  readonly message: string
  readonly code: string
  readonly timestamp: number
}

//flags stitched onto a row at read-time from the outbox state. never
//persisted — recomputed on every read so a discarded sync needs no
//rollback, only the outbox changes.
export interface RuntimeMeta {
  readonly $synced: boolean
  readonly $syncStatus: SyncStatus
  readonly $lastError?: SyncError
}

//the optimistic document handed to the UI: developer shape + id + the
//derived sync flags. the causal $meta is internal and stripped here.
export type LocalDocument<T> = T & {
  readonly [ID_FIELD]: string
  readonly [SYNC_FIELD]: RuntimeMeta
}

//---- Outbox ledger -------------------------------------------------

export type OutboxOpType = "INSERT" | "UPDATE" | "DELETE"

//one recorded unit of user intent. payload carries the full row for an
//INSERT, the changed fields for an UPDATE, and is empty for a DELETE.
//hlc stamps every field this op touches; createdAt/retryCount are for
//diagnostics and backoff.
export interface OutboxEntry<TPayload = unknown> {
  readonly id: string
  readonly collection: string
  readonly rowId: string
  readonly type: OutboxOpType
  readonly payload: TPayload
  readonly hlc: Hlc
  readonly createdAt: number
  readonly retryCount: number
  //array-element / cleared-field removals produced by this op, keyed
  //"field" or "field::element", each carrying the op's hlc
  readonly tombstones?: Readonly<Record<string, Hlc>>
  //set when the op has been parked after a discard/retry-exhaustion so
  //the read layer can surface $syncStatus: "error"
  readonly error?: SyncError
}

//opaque per-collection pull position the developer's pull() echoes back;
//the framework only stores and forwards it, never inspects it.
export type SyncCursor = unknown
