import type {
  ServerDocumentRecord,
  ServerDocumentStore,
} from "#synq/server/server.types"

//---- In-memory server store ---------------------------------------
//the reference ServerDocumentStore: plain maps, single-process. used by
//tests and prototypes; a real backend implements the same contract over
//its database (see server.types.ts for the atomicity requirements).

export function createMemoryDocumentStore(): ServerDocumentStore {
  //records keyed "scope/collection" → id → record
  const tables = new Map<string, Map<string, ServerDocumentRecord>>()
  const counters = new Map<string, number>()

  function keyOf(scope: string, collection: string): string {
    return `${scope}/${collection}`
  }

  function tableOf(
    scope: string,
    collection: string,
  ): Map<string, ServerDocumentRecord> {
    const key = keyOf(scope, collection)
    let table = tables.get(key)
    if (!table) {
      table = new Map()
      tables.set(key, table)
    }
    return table
  }

  return {
    async getDocuments(scope, collection, ids) {
      const table = tableOf(scope, collection)
      const found: ServerDocumentRecord[] = []
      for (const id of ids) {
        const record = table.get(id)
        if (record) found.push(record)
      }
      return found
    },

    async getChangesSince(scope, collection, since) {
      const table = tableOf(scope, collection)
      return [...table.values()]
        .filter((record) => record.seq > since)
        .sort((a, b) => a.seq - b.seq)
    },

    async allocateSeq(scope, collection, count) {
      const key = keyOf(scope, collection)
      const next = (counters.get(key) ?? 0) + count
      counters.set(key, next)
      return next
    },

    async putDocuments(scope, collection, records) {
      const table = tableOf(scope, collection)
      for (const record of records) table.set(record.id, record)
    },
  }
}
