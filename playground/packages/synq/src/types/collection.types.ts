import type { CollectionSchema } from "#synq/types/schema.types"
import type { StoredDocument, SyncCursor } from "#synq/types/synq.types"

//---- Transaction context ------------------------------------------
//handed to push handlers so the developer maps each operation's network
//result back to the engine, called once per outbox entry id. the engine
//stays fully unopinionated about the server's response format.

export interface TxError {
  readonly message: string
  readonly code: string
}

export interface TxContext {
  //server accepted it — purge this op from the outbox
  ack: (opId: string) => void
  //transient failure — keep the op and freeze this rowId for the cycle
  retry: (opId: string, error?: TxError) => void
  //permanent failure — drop this op and every later op for this rowId
  discard: (opId: string, error?: TxError) => void
}

//---- Developer transport ------------------------------------------
//every handler receives a BATCH (an array); a single mutation is just a
//batch of length 1. each item carries the merged StoredDocument (data +
//$id + $meta) so the server can run the same field-level merge and
//converge. resolve each item via ctx by its opId. omit push/pull
//entirely for a local-only collection.

export interface PushItem<TRow> {
  //identifies the outbox op for ack/retry/discard
  readonly opId: string
  //the row's $id
  readonly id: string
  //the merged document to persist; for deletes it carries $meta.deletedAt
  readonly doc: StoredDocument<TRow>
}

export interface PushHandlers<TRow> {
  inserts: (items: PushItem<TRow>[], ctx: TxContext) => Promise<void>
  updates: (items: PushItem<TRow>[], ctx: TxContext) => Promise<void>
  deletes: (items: PushItem<TRow>[], ctx: TxContext) => Promise<void>
}

//---- Unified push (the array form) --------------------------------
//one handler for every kind of change. each entry is type-tagged and
//carries BOTH the field delta (just what this change touched) and the full
//merged snapshot (doc, with $id + $meta), so the developer chooses what to
//put on the wire — a compact delta, the whole row, or both. resolve each by
//its opId via ctx. this is interchangeable with PushHandlers; pick one.

export type ChangeType = "insert" | "update" | "delete"

export interface Change<TRow> {
  //identifies the outbox op for ack/retry/discard
  readonly opId: string
  //the row's $id
  readonly id: string
  readonly type: ChangeType
  //only the fields this change touched (empty for a delete). per-field HLCs
  //live on doc.$meta.fields if the developer wants a stamped wire delta.
  readonly delta: Partial<TRow>
  //the full merged document to persist; for a delete its $meta carries
  //deletedAt and the data fields are stripped
  readonly doc: StoredDocument<TRow>
}

export type UnifiedPush<TRow> = (
  changes: Change<TRow>[],
  ctx: TxContext,
) => Promise<void>

//a collection's push transport is either the split handlers or the unified
//array form — the engine normalises both onto one Change[] internally
export type PushTransport<TRow> = PushHandlers<TRow> | UnifiedPush<TRow>

//the server must round-trip $id and $meta so field-level merges converge
//across devices; changes are therefore stored documents, not raw rows.
//deleted rows come back as tombstones (their $meta carries deletedAt).
export type PullHandler<TRow> = (cursor: SyncCursor) => Promise<{
  changes: StoredDocument<TRow>[]
  nextCursor: SyncCursor
}>

//---- Collection config --------------------------------------------

export interface CollectionConfig<TRow extends Record<string, unknown>> {
  readonly name: string
  readonly schema?: CollectionSchema
  readonly pull?: PullHandler<TRow>
  //either the 3-callback PushHandlers or the unified push(changes) function
  readonly push?: PushTransport<TRow>
  //retry budget per row: after this many ctx.retry cycles the row's ops are
  //dropped and it reverts to server truth. undefined = retry forever.
  readonly maxRetries?: number
  //a singleton holds exactly one row; see singletonCollection()
  readonly singleton?: boolean
  //the fallback row for a singleton — fills any field not yet written
  readonly defaults?: TRow
}

//---- Singleton collections ----------------------------------------
//a collection that holds exactly ONE row (e.g. app preferences). its handle
//is a SingletonHandle — get()/set(patch) over a fixed id, with `defaults`
//filling any field the stored row hasn't written. local-only unless you add
//pull/push like any other collection.

export interface SingletonConfig<TRow extends Record<string, unknown>>
  extends CollectionConfig<TRow> {
  readonly singleton: true
  readonly defaults: TRow
}

export function singletonCollection<TRow extends Record<string, unknown>>(
  name: string,
  defaults: TRow,
  options?: Omit<
    CollectionConfig<TRow>,
    "name" | "singleton" | "defaults"
  >,
): SingletonConfig<TRow> {
  return { ...options, name, singleton: true, defaults }
}
