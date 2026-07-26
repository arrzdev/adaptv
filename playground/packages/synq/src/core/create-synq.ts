import type { StorageAdapter } from "#synq/adapters/adapter.types"
import type { HlcClock } from "#synq/core/hlc"
import { createClock, formatHlc, parseHlc } from "#synq/core/hlc"
import { newId } from "#synq/core/ids"
import { atomicGroupsOf } from "#synq/core/schema"
import { stitchCollection, stitchRecord } from "#synq/core/stitch"
import type { SyncCollection } from "#synq/core/sync-engine"
import { syncCollection } from "#synq/core/sync-engine"
import type { CollectionConfig } from "#synq/types/collection.types"
import type {
  CollectionHandle,
  QueryOptions,
  SingletonHandle,
  SyncOutcome,
  SynqDb,
} from "#synq/types/query.types"
import type { LocalDocument, OutboxEntry } from "#synq/types/synq.types"
import { ID_FIELD, SYNC_FIELD } from "#synq/types/synq.types"

//---- The synq storage factory -------------------------------------
//wires the pure engines to a storage adapter behind a typed
//storage.todos.insert() / storage.preferences.set() surface. owns the
//per-device HLC clock (persisted so stamps stay monotonic across reloads)
//and routes sync() through the snapshot engine. collection row types are
//inferred from `collections`, so call sites never pass a generic.

const META_KEY = "__synq"
//every singleton collection stores its one row under this fixed id
const SINGLETON_ID = "singleton"

type ClockMeta = { node: string; clock: string }

export interface SynqStorageOptions<
  // biome-ignore lint/suspicious/noExplicitAny: registry row wildcard
  TCollections extends Record<string, CollectionConfig<any>>,
> {
  //the storage backend (in-memory, IndexedDB, …) every collection persists to
  storageAdapter: StorageAdapter
  collections: TCollections
  //stable device id; generated and persisted if omitted
  node?: string
  //opaque sync scope (e.g. the signed-in user id). namespaces each
  //collection's pull cursor so switching scope pulls fresh instead of
  //trusting a cursor from a different row-set. auth lives in pull/push.
  scope?: string
}

export function createSynqStorage<
  // biome-ignore lint/suspicious/noExplicitAny: registry row wildcard
  const TCollections extends Record<string, CollectionConfig<any>>,
>(opts: SynqStorageOptions<TCollections>): SynqDb<TCollections> {
  const storage = opts.storageAdapter
  let clock: HlcClock
  let node = opts.node ?? ""
  let initPromise: Promise<void> | undefined

  function ensureInit(): Promise<void> {
    if (!initPromise) {
      initPromise = (async () => {
        const meta = (await storage.getCursor(META_KEY)) as
          | ClockMeta
          | undefined
        node = opts.node ?? meta?.node ?? newId()
        const last = meta?.clock ? parseHlc(meta.clock) : undefined
        clock = createClock(node, last ? { last } : undefined)
        if (!meta?.node) await persistClock()
      })()
    }
    return initPromise
  }

  function clockMeta(): ClockMeta {
    return { node, clock: formatHlc(clock.now()) }
  }

  async function persistClock(): Promise<void> {
    await storage.transact((tx) => tx.setCursor(META_KEY, clockMeta()))
  }

  function buildHandle<TRow extends Record<string, unknown>>(
    config: CollectionConfig<TRow>,
  ): CollectionHandle<TRow> {
    const name = config.name
    const atomicGroups = atomicGroupsOf(config.schema)
    //local-origin change listeners — distinct from storage.subscribe (which
    //also fires on pull). this never fires from sync(), so a debounced sync
    //driven off it can't loop.
    const localListeners = new Set<() => void>()

    async function appendOp(op: OutboxEntry): Promise<void> {
      await storage.transact((tx) => {
        tx.appendOps([op])
        tx.setCursor(META_KEY, clockMeta())
      })
      for (const cb of localListeners) cb()
    }

    async function rowOps(id: string): Promise<OutboxEntry[]> {
      const all = await storage.getOps(name)
      return all.filter((op) => op.rowId === id)
    }

    return {
      async insert(data) {
        await ensureInit()
        const { $id, ...rest } = data
        const id = $id ?? newId()
        const op: OutboxEntry = {
          id: newId(),
          collection: name,
          rowId: id,
          type: "INSERT",
          payload: rest,
          hlc: clock.send(),
          createdAt: Date.now(),
          retryCount: 0,
        }
        await appendOp(op)
        return stitchRecord<TRow>(undefined, [op]) as LocalDocument<TRow>
      },

      async update(id, patch) {
        await ensureInit()
        const op: OutboxEntry = {
          id: newId(),
          collection: name,
          rowId: id,
          type: "UPDATE",
          payload: patch,
          hlc: clock.send(),
          createdAt: Date.now(),
          retryCount: 0,
        }
        await appendOp(op)
      },

      async delete(id) {
        await ensureInit()
        const op: OutboxEntry = {
          id: newId(),
          collection: name,
          rowId: id,
          type: "DELETE",
          payload: null,
          hlc: clock.send(),
          createdAt: Date.now(),
          retryCount: 0,
        }
        await appendOp(op)
      },

      async get(id) {
        const canonical = await storage.getRow<TRow>(name, id)
        return stitchRecord<TRow>(canonical, await rowOps(id))
      },

      async query(options) {
        const canonical = await storage.getAll<TRow>(name)
        const ops = await storage.getOps(name)
        const list = stitchCollection<TRow>(canonical, ops)
        return filterSort(list, options)
      },

      subscribe(cb) {
        return storage.subscribe(name, cb)
      },

      onLocalChange(cb) {
        localListeners.add(cb)
        return () => {
          localListeners.delete(cb)
        }
      },

      async pendingCount() {
        const ops = await storage.getOps(name)
        return new Set(ops.map((op) => op.rowId)).size
      },

      async sync() {
        await ensureInit()
        const col: SyncCollection = {
          name,
          cursorKey: opts.scope ? `${name}::${opts.scope}` : name,
          atomicGroups,
          maxRetries: config.maxRetries,
          pull: config.pull,
          push: config.push,
          observeHlc: (hlc) => clock.recv(hlc),
          //persisted inside the engine's commit transaction, so a crash can
          //never resume from a clock older than the remote stamps it merged
          //(post-reload local writes would lose LWW they should have won)
          persistClock: (tx) => tx.setCursor(META_KEY, clockMeta()),
        }
        return syncCollection(storage, col)
      },
    }
  }

  //a singleton handle is sugar over a one-row collection: get()/set() target
  //a fixed id and `defaults` fill any field that row hasn't written yet.
  function buildSingleton<TRow extends Record<string, unknown>>(
    config: CollectionConfig<TRow>,
  ): SingletonHandle<TRow> {
    const base = buildHandle(config)
    const defaults = (config.defaults ?? {}) as TRow

    return {
      async get() {
        const doc = await base.get(SINGLETON_ID)
        if (doc) return { ...defaults, ...doc } as LocalDocument<TRow>
        //not persisted yet — a clean defaults view with nothing pending
        return {
          ...defaults,
          [ID_FIELD]: SINGLETON_ID,
          [SYNC_FIELD]: { $synced: true, $syncStatus: "synced" },
        } as unknown as LocalDocument<TRow>
      },
      async set(patch) {
        const current = await base.get(SINGLETON_ID)
        if (current) await base.update(SINGLETON_ID, patch)
        else
          await base.insert({ ...defaults, ...patch, $id: SINGLETON_ID })
      },
      subscribe: base.subscribe,
      onLocalChange: base.onLocalChange,
      sync: base.sync,
    }
  }

  const handles: Record<string, { sync: () => Promise<SyncOutcome> }> = {}
  for (const key of Object.keys(opts.collections)) {
    const config = opts.collections[key]
    handles[key] = config.singleton
      ? buildSingleton(config)
      : buildHandle(config)
  }

  async function syncAll(): Promise<SyncOutcome[]> {
    const outcomes: SyncOutcome[] = []
    for (const key of Object.keys(handles)) {
      outcomes.push(await handles[key].sync())
    }
    return outcomes
  }

  //wipe every collection's canonical rows + outbox ops + pull cursor in place.
  //uses the adapter's low-level deleteRows/deleteOps (NOT collection.delete), so
  //nothing is enqueued — the wipe stays local and never syncs upstream. each
  //transact notifies subscribers, so live queries re-render empty. the clock
  //(META_KEY) is left intact so stamps stay monotonic across the reset.
  async function resetLocal(): Promise<void> {
    for (const name of Object.keys(opts.collections)) {
      const rows = await storage.getAll<Record<string, unknown>>(name)
      const ops = await storage.getOps(name)
      const ids = rows.map((row) => row[ID_FIELD] as string)
      const opIds = ops.map((op) => op.id)
      const cursorKey = opts.scope ? `${name}::${opts.scope}` : name
      await storage.transact((tx) => {
        tx.deleteRows(name, ids)
        tx.deleteOps(opIds)
        tx.setCursor(cursorKey, undefined)
      })
    }
  }

  return {
    ...handles,
    sync: syncAll,
    resetLocal,
  } as unknown as SynqDb<TCollections>
}

//---- read-time filtering / sorting --------------------------------

function filterSort<TRow>(
  list: LocalDocument<TRow>[],
  options: QueryOptions<TRow> | undefined,
): LocalDocument<TRow>[] {
  if (!options) return list
  let out = list

  if (options.where) {
    const predicate = options.where
    if (typeof predicate === "function") {
      out = out.filter((row) => predicate(row))
    } else {
      const entries = Object.entries(predicate) as [keyof TRow, unknown][]
      out = out.filter((row) =>
        entries.every(
          (entry) => (row as unknown as TRow)[entry[0]] === entry[1],
        ),
      )
    }
  }

  if (options.sortBy) {
    const key = options.sortBy
    const dir = options.order === "desc" ? -1 : 1
    out = [...out].sort(
      (a, b) =>
        compareValues(
          (a as unknown as TRow)[key],
          (b as unknown as TRow)[key],
        ) * dir,
    )
  }

  if (typeof options.limit === "number") out = out.slice(0, options.limit)
  return out
}

//small ordered comparison that tolerates the common value types we sort on
//(number, string, Date, boolean); nullish sorts first
function compareValues(a: unknown, b: unknown): number {
  if (a === b) return 0
  if (a == null) return -1
  if (b == null) return 1
  return (a as number) < (b as number) ? -1 : 1
}
