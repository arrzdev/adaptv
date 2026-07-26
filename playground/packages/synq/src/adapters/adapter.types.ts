import type { OutboxEntry, StoredDocument } from "#synq/types/synq.types"

//---- Storage adapter ----------------------------------------------
//the contract every storage backend implements. the engine speaks only
//this interface, so an in-memory map, IndexedDB, OPFS, or SQLite-wasm
//are interchangeable. everything here is local I/O — never the network.

export interface StorageTx {
  putRows: (collection: string, rows: StoredDocument<unknown>[]) => void
  deleteRows: (collection: string, ids: string[]) => void
  appendOps: (ops: OutboxEntry[]) => void
  deleteOps: (opIds: string[]) => void
  putOps: (ops: OutboxEntry[]) => void
  setCursor: (collection: string, cursor: unknown) => void
}

export interface StorageAdapter {
  //---- canonical store (last-acked server state) ----
  getRow: <T>(
    collection: string,
    id: string,
  ) => Promise<StoredDocument<T> | undefined>
  getAll: <T>(collection: string) => Promise<StoredDocument<T>[]>

  //---- outbox ledger ----
  getOps: (collection?: string) => Promise<OutboxEntry[]>

  //---- sync cursor (per collection) ----
  getCursor: (collection: string) => Promise<unknown>

  //---- atomic swap ----
  //apply every canonical write, outbox purge, and cursor advance in one
  //transaction so subscribers observe a single coalesced change
  transact: (
    work: (tx: StorageTx) => void | Promise<void>,
  ) => Promise<void>

  //---- reactivity substrate (under useQuery) ----
  subscribe: (collection: string, cb: () => void) => () => void
}
