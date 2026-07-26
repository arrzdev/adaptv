import type {
  StorageAdapter,
  StorageTx,
} from "#synq/adapters/adapter.types"
import { compareHlc } from "#synq/core/hlc"
import type { OutboxEntry, StoredDocument } from "#synq/types/synq.types"
import { ID_FIELD } from "#synq/types/synq.types"

//---- In-memory storage adapter ------------------------------------
//the reference StorageAdapter: a plain set of maps. used by tests and as
//a fallback when there is no persistence (SSR, ephemeral sessions). the
//IndexedDB adapter implements the same contract for the browser.

type Table = Map<string, StoredDocument<unknown>>

export function createMemoryStorage(): StorageAdapter {
  const collections = new Map<string, Table>()
  let ops: OutboxEntry[] = []
  const cursors = new Map<string, unknown>()
  const listeners = new Map<string, Set<() => void>>()

  function tableOf(name: string): Table {
    let table = collections.get(name)
    if (!table) {
      table = new Map()
      collections.set(name, table)
    }
    return table
  }

  function notify(touched: Set<string>): void {
    for (const name of touched) {
      const subs = listeners.get(name)
      if (subs) for (const cb of subs) cb()
    }
  }

  async function getRow<T>(collection: string, id: string) {
    return tableOf(collection).get(id) as StoredDocument<T> | undefined
  }

  async function getAll<T>(collection: string) {
    return [...tableOf(collection).values()] as StoredDocument<T>[]
  }

  async function getOps(collection?: string) {
    //insertion order is already causal here, but sort by hlc anyway so both
    //adapters honor the same contract (ops come back in causal order)
    const list = collection
      ? ops.filter((op) => op.collection === collection)
      : [...ops]
    return list.sort((a, b) => compareHlc(a.hlc, b.hlc))
  }

  async function getCursor(collection: string) {
    return cursors.get(collection)
  }

  async function transact(work: (tx: StorageTx) => void | Promise<void>) {
    const touched = new Set<string>()
    const tx: StorageTx = {
      putRows(collection, rows) {
        const table = tableOf(collection)
        for (const row of rows) table.set(row[ID_FIELD], row)
        touched.add(collection)
      },
      deleteRows(collection, ids) {
        const table = tableOf(collection)
        for (const id of ids) table.delete(id)
        touched.add(collection)
      },
      appendOps(newOps) {
        ops.push(...newOps)
        for (const op of newOps) touched.add(op.collection)
      },
      deleteOps(opIds) {
        const remove = new Set(opIds)
        for (const op of ops)
          if (remove.has(op.id)) touched.add(op.collection)
        ops = ops.filter((op) => !remove.has(op.id))
      },
      putOps(updated) {
        const byId = new Map(updated.map((op) => [op.id, op]))
        ops = ops.map((op) => byId.get(op.id) ?? op)
        for (const op of updated) touched.add(op.collection)
      },
      setCursor(collection, cursor) {
        cursors.set(collection, cursor)
      },
    }
    await work(tx)
    notify(touched)
  }

  function subscribe(collection: string, cb: () => void) {
    let subs = listeners.get(collection)
    if (!subs) {
      subs = new Set()
      listeners.set(collection, subs)
    }
    subs.add(cb)
    return () => {
      subs.delete(cb)
    }
  }

  return { getRow, getAll, getOps, getCursor, transact, subscribe }
}
