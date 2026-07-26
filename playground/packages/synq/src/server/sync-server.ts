import { isDeleted, mergeDocuments } from "#synq/core/merge"
import type {
  SyncPullRequest,
  SyncPullResponse,
  SyncPushRequest,
  SyncPushResponse,
  SyncPushResultStatus,
} from "#synq/protocol/protocol.types"
import { isStoredDocument } from "#synq/protocol/validate"
import type {
  ServerDocumentRecord,
  ServerDocumentStore,
} from "#synq/server/server.types"
import type { StoredDocument } from "#synq/types/synq.types"

//---- The synq sync server -----------------------------------------
//the backend half of the sync protocol, pure over a ServerDocumentStore.
//it runs the SAME field-level merge as the clients, so concurrent pushes
//from a scope's devices converge here instead of last-writer-clobbering.
//
//reliability rules encoded here (not left to each backend):
//  • every pushed document is structurally validated BEFORE merging — a
//    malformed $meta is answered "invalid" (the client discards the op)
//    and never persisted, so it can't crash every device that pulls it.
//  • pull's nextCursor comes from the ROWS RETURNED, never from reading
//    the counter — a push committing between two reads can't advance the
//    cursor past a row the client hasn't seen.
//  • seq ranges are reserved via one atomic allocateSeq call per push, so
//    concurrent pushes can't mint duplicate sequence numbers.

type AnyDoc = StoredDocument<Record<string, unknown>>

export interface SyncServer {
  pull: (
    scope: string,
    collection: string,
    request: SyncPullRequest,
  ) => Promise<SyncPullResponse>
  push: (
    scope: string,
    collection: string,
    request: SyncPushRequest,
  ) => Promise<SyncPushResponse>
}

export function createSyncServer(store: ServerDocumentStore): SyncServer {
  async function pull(
    scope: string,
    collection: string,
    request: SyncPullRequest,
  ): Promise<SyncPullResponse> {
    const records = await store.getChangesSince(
      scope,
      collection,
      request.since,
    )
    let nextCursor = request.since
    for (const record of records) {
      if (record.seq > nextCursor) nextCursor = record.seq
    }
    return { changes: records.map((record) => record.doc), nextCursor }
  }

  async function push(
    scope: string,
    collection: string,
    request: SyncPushRequest,
  ): Promise<SyncPushResponse> {
    const results: Record<string, SyncPushResultStatus> = {}

    //gate every payload before it can reach the merge or storage
    const validItems: { id: string; doc: AnyDoc }[] = []
    for (const item of request.items) {
      const sound = isStoredDocument(item.doc) && item.doc.$id === item.id
      if (!sound) {
        results[item.id] = "invalid"
        continue
      }
      validItems.push({ id: item.id, doc: item.doc as AnyDoc })
    }
    if (validItems.length === 0) return { results }

    //one read for the whole batch, then merge in memory. a duplicate id in
    //the batch folds onto its own earlier merge (order preserved).
    const existing = await store.getDocuments(
      scope,
      collection,
      validItems.map((item) => item.id),
    )
    const existingById = new Map(
      existing.map((record) => [record.id, record.doc]),
    )
    const mergedById = new Map<string, AnyDoc>()
    for (const item of validItems) {
      const current = mergedById.get(item.id) ?? existingById.get(item.id)
      const merged = current ? mergeDocuments(current, item.doc) : item.doc
      mergedById.set(item.id, merged)
      results[item.id] = "ok"
    }

    //reserve a contiguous seq range atomically, then persist all-or-nothing
    const lastSeq = await store.allocateSeq(
      scope,
      collection,
      mergedById.size,
    )
    let seq = lastSeq - mergedById.size
    const records: ServerDocumentRecord[] = []
    for (const [id, doc] of mergedById) {
      seq++
      records.push({ id, seq, deleted: isDeleted(doc), doc })
    }
    await store.putDocuments(scope, collection, records)

    return { results }
  }

  return { pull, push }
}
