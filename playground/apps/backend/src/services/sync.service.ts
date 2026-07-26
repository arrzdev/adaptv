import type {
  ServerDocumentRecord,
  ServerDocumentStore,
  SyncPullResponse,
  SyncPushItem,
  SyncPushResultStatus,
  SyncServer,
} from "@repo/synq/server"
import { createSyncServer } from "@repo/synq/server"
import type { DocMeta, StoredDocument } from "@repo/synq/types"
import { and, asc, eq, gt, inArray, sql } from "drizzle-orm"
import type { Db } from "@/database/client"
import { documents, syncCounters } from "@/database/schema"
import { CustomError } from "@/http/errors"

//---- Sync service -------------------------------------------------
//D1 persistence for @repo/synq's sync server. all sync semantics —
//validation, the field-level merge, cursor derivation, seq assignment —
//live in createSyncServer; this class only implements the
//ServerDocumentStore contract over the documents/sync_counters tables.
//scope = the authenticated userId, so a client only ever sees its own rows.

type Doc = StoredDocument<Record<string, unknown>>
type DocRow = typeof documents.$inferSelect

const ID = "$id"
const META = "$meta"

export class SyncService {
  private server: SyncServer

  constructor(private db: Db) {
    this.server = createSyncServer(this.documentStore())
  }

  pull(
    userId: string,
    collection: string,
    since: number,
  ): Promise<SyncPullResponse> {
    return this.server.pull(userId, collection, { since })
  }

  async push(
    userId: string,
    collection: string,
    items: SyncPushItem[],
  ): Promise<Record<string, SyncPushResultStatus>> {
    const { results } = await this.server.push(userId, collection, {
      items,
    })
    return results
  }

  //---- ServerDocumentStore over D1 ----------------

  private documentStore(): ServerDocumentStore {
    return {
      getDocuments: async (scope, collection, ids) => {
        if (ids.length === 0) return []
        const rows = await this.db
          .select()
          .from(documents)
          .where(
            and(
              eq(documents.userId, scope),
              eq(documents.collection, collection),
              inArray(documents.id, ids),
            ),
          )
        return rows.map(rowToRecord)
      },

      getChangesSince: async (scope, collection, since) => {
        const rows = await this.db
          .select()
          .from(documents)
          .where(
            and(
              eq(documents.userId, scope),
              eq(documents.collection, collection),
              gt(documents.seq, since),
            ),
          )
          .orderBy(asc(documents.seq))
        return rows.map(rowToRecord)
      },

      //single atomic upsert-increment — a read-then-write here would let two
      //concurrent pushes mint the same seq range
      allocateSeq: async (scope, collection, count) => {
        const [row] = await this.db
          .insert(syncCounters)
          .values({ userId: scope, collection, value: count })
          .onConflictDoUpdate({
            target: [syncCounters.userId, syncCounters.collection],
            set: { value: sql`${syncCounters.value} + ${count}` },
          })
          .returning({ value: syncCounters.value })
        if (!row) throw new CustomError("internal_server_error")
        return row.value
      },

      putDocuments: async (scope, collection, records) => {
        if (records.length === 0) return
        const [first, ...rest] = records.map((record) =>
          this.upsertDocument(scope, collection, record),
        )
        if (rest.length === 0) await first
        else await this.db.batch([first, ...rest])
      },
    }
  }

  private upsertDocument(
    scope: string,
    collection: string,
    record: ServerDocumentRecord,
  ) {
    const { data, meta } = splitDoc(record.doc)
    const values = {
      userId: scope,
      collection,
      id: record.id,
      data,
      meta,
      deleted: record.deleted,
      seq: record.seq,
    }
    return this.db
      .insert(documents)
      .values(values)
      .onConflictDoUpdate({
        target: [documents.userId, documents.collection, documents.id],
        set: {
          data: values.data,
          meta: values.meta,
          deleted: values.deleted,
          seq: values.seq,
        },
      })
  }
}

//---- row mapping ----------------

//a stored db row → the synq document record the sync server expects
function rowToRecord(row: DocRow): ServerDocumentRecord {
  const doc = {
    ...(row.data as Record<string, unknown>),
    [ID]: row.id,
    [META]: row.meta as DocMeta,
  } as Doc
  return { id: row.id, seq: row.seq, deleted: row.deleted, doc }
}

//a synq document → its persisted halves: developer fields (data) + the
//causal $meta, dropping the $id/$meta envelope keys
function splitDoc(doc: Doc): {
  data: Record<string, unknown>
  meta: DocMeta
} {
  const data: Record<string, unknown> = {}
  for (const key of Object.keys(doc)) {
    if (key === ID || key === META) continue
    data[key] = (doc as Record<string, unknown>)[key]
  }
  return { data, meta: doc[META] as DocMeta }
}
