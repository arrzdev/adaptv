//@repo/synq/server — the backend half of sync: createSyncServer runs the
//same field-level merge the clients run, over a ServerDocumentStore the
//backend implements for its database. includes the reference in-memory
//store for tests/prototypes and re-exports the wire protocol.

export { createMemoryDocumentStore } from "../server/memory.store"
export type {
  ServerDocumentRecord,
  ServerDocumentStore,
} from "../server/server.types"
export type { SyncServer } from "../server/sync-server"
export { createSyncServer } from "../server/sync-server"
export * from "./protocol.index"
