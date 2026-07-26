import type { CollectionConfig } from "#synq/types/collection.types"
import type { LocalDocument } from "#synq/types/synq.types"

//---- Query options ------------------------------------------------

export interface QueryOptions<TRow> {
  where?: Partial<TRow> | ((row: LocalDocument<TRow>) => boolean)
  sortBy?: keyof TRow
  order?: "asc" | "desc"
  limit?: number
  //how long a query stays warm after its last subscriber unmounts
  //before the live observer is torn down
  gcTime?: number
}

//---- Sync reporting -----------------------------------------------

export interface SyncOutcome {
  readonly collection: string
  readonly pulled: number
  readonly pushed: number
  readonly acked: number
  readonly retried: number
  readonly discarded: number
  readonly skipped: number
}

//---- Public surface -----------------------------------------------
//local reads/writes never touch the network; sync() runs the snapshot
//pipeline. the core handle is React-free; the react adapter's useQuery
//is layered on top of query() + subscribe().

export interface CollectionHandle<TRow extends Record<string, unknown>> {
  insert: (
    data: Partial<TRow> & { $id?: string },
  ) => Promise<LocalDocument<TRow>>
  update: (id: string, patch: Partial<TRow>) => Promise<void>
  delete: (id: string) => Promise<void>
  get: (id: string) => Promise<LocalDocument<TRow> | null>
  query: (opts?: QueryOptions<TRow>) => Promise<LocalDocument<TRow>[]>
  //fires whenever this collection's local state changes — including a pull
  //applying server rows. the reactive substrate the react useQuery builds on.
  subscribe: (cb: () => void) => () => void
  //fires ONLY on local-origin writes (insert/update/delete), never when a
  //pull writes server state. drive a debounced sync() off this without the
  //pull→write→sync→pull loop a plain subscribe would cause.
  onLocalChange: (cb: () => void) => () => void
  //number of distinct rows with unsynced local changes (pending outbox ops)
  pendingCount: () => Promise<number>
  sync: () => Promise<SyncOutcome>
}

//a singleton collection's handle: one row, addressed by get()/set(patch)
//instead of a query. `get()` never returns null — `defaults` fill the gaps.
export interface SingletonHandle<TRow extends Record<string, unknown>> {
  get: () => Promise<LocalDocument<TRow>>
  //patch the one row; creates it from defaults on the first write
  set: (patch: Partial<TRow>) => Promise<void>
  subscribe: (cb: () => void) => () => void
  onLocalChange: (cb: () => void) => () => void
  sync: () => Promise<SyncOutcome>
}

//each registered collection is reachable by name; db.sync() reconciles
//every collection in one coordinated run. a collection flagged
//`singleton: true` exposes a SingletonHandle, everything else a normal one.
export type SynqDb<
  // biome-ignore lint/suspicious/noExplicitAny: registry needs a row wildcard to infer per-collection types
  TCollections extends Record<string, CollectionConfig<any>>,
> = {
  [K in keyof TCollections]: TCollections[K] extends { singleton: true }
    ? TCollections[K] extends CollectionConfig<infer TRow>
      ? SingletonHandle<TRow>
      : never
    : TCollections[K] extends CollectionConfig<infer TRow>
      ? CollectionHandle<TRow>
      : never
} & {
  sync: () => Promise<SyncOutcome[]>
  /**
   * Wipe ALL local data — canonical rows, the outbox, and every pull cursor —
   * in place, then notify subscribers so live queries re-render empty. Local
   * only: it does NOT enqueue deletions, so the wipe never syncs upstream. The
   * device clock is preserved (HLC stays monotonic). Use on sign-out, or before
   * pulling a different account's data, instead of reloading the page.
   */
  resetLocal: () => Promise<void>
}
