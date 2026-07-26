import type { StoredDocument } from "#synq/types/synq.types"

//---- Server document store ----------------------------------------
//the persistence contract a backend implements to host synq sync. the
//sync server speaks only this interface, so D1/Postgres/SQLite/KV are
//interchangeable. `scope` is an opaque ownership key (typically the
//authenticated user id) — every method must isolate rows by it; the
//sync server never mixes scopes.

export interface ServerDocumentRecord {
  readonly id: string
  //per-(scope, collection) monotonic change sequence driving delta pulls
  readonly seq: number
  //true when doc.$meta carries deletedAt — denormalized for cheap filtering
  readonly deleted: boolean
  readonly doc: StoredDocument<Record<string, unknown>>
}

export interface ServerDocumentStore {
  //fetch specific documents by id; ids with no record are simply absent
  getDocuments: (
    scope: string,
    collection: string,
    ids: string[],
  ) => Promise<ServerDocumentRecord[]>

  //every record with seq > since, ascending by seq (tombstones included)
  getChangesSince: (
    scope: string,
    collection: string,
    since: number,
  ) => Promise<ServerDocumentRecord[]>

  //atomically advance the (scope, collection) counter by `count` and
  //return the LAST reserved value. MUST be a single atomic operation
  //(e.g. `UPDATE … SET value = value + ? RETURNING value`) — a read-then-
  //write here lets two concurrent pushes mint the same seq.
  allocateSeq: (
    scope: string,
    collection: string,
    count: number,
  ) => Promise<number>

  //upsert every record atomically (all-or-nothing)
  putDocuments: (
    scope: string,
    collection: string,
    records: ServerDocumentRecord[],
  ) => Promise<void>
}
