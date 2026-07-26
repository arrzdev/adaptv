import { deepEqual } from "#synq/core/deep-equal"
import type {
  CollectionHandle,
  QueryOptions,
} from "#synq/types/query.types"
import type { LocalDocument } from "#synq/types/synq.types"

//---- Live query engine --------------------------------------------
//the work behind the reactive hook. a component's useCollection is just a
//thin view onto this: the engine owns one live query per distinct key, so N
//components asking the same question share one running observer (dedup), and
//it keeps the last result warm so a remount paints instantly
//(stale-while-revalidate) instead of flashing a skeleton.
//
//gcTime governs what happens after the LAST subscriber for a key leaves:
//  • a finite delay  → keep processing that long, then tear down the live
//    observer (the last result is still retained for SWR on a later mount)
//  • 0               → stop processing immediately, but keep the last result
//    so a remount shows it at once and revalidates in the background
//  • Infinity        → never tear down; keep the query live for the whole
//    app session so a remount is already up to date (no revalidation gap)

export interface LiveState<TRow extends Record<string, unknown>> {
  readonly data: LocalDocument<TRow>[]
  //true only until this query's first-ever result has loaded
  readonly isLoading: boolean
}

export interface LiveHandle<TRow extends Record<string, unknown>> {
  get: () => LiveState<TRow>
  unsubscribe: () => void
}

export interface LiveQueriesOptions {
  //default retention after the last subscriber leaves; per-observe overrides
  gcTime?: number
}

export interface LiveQueries<TRow extends Record<string, unknown>> {
  observe: (
    options: QueryOptions<TRow> | undefined,
    onChange: () => void,
  ) => LiveHandle<TRow>
}

const DEFAULT_GC = 5 * 60 * 1000

// biome-ignore lint/suspicious/noExplicitAny: one cache spans every row shape
type AnyDoc = LocalDocument<any>
type AnyState = { data: AnyDoc[]; isLoading: boolean }

//shared, frozen loading snapshot — referentially stable so useSyncExternalStore
//doesn't loop while a query is still cold
const LOADING: AnyState = Object.freeze({ data: [], isLoading: true })

type Entry = {
  //last computed result — retained as the warm/last-known snapshot for SWR
  data: AnyDoc[] | undefined
  //stable snapshot object handed to subscribers; identity only changes when
  //the data actually changes, so getSnapshot is safe for useSyncExternalStore
  state: AnyState
  options: QueryOptions<unknown> | undefined
  subscribers: Set<() => void>
  //the live storage subscription; null means processing is torn down
  unsubscribe: (() => void) | null
  gcTimer: ReturnType<typeof setTimeout> | null
  running: boolean
  //a change arrived mid-flight — recompute once the current run settles
  rerun: boolean
}

//engine params are not part of a query's identity, so two hooks with the
//same filter but different gcTime still dedup onto one observer
function keyOf(options: QueryOptions<unknown> | undefined): string {
  if (!options) return "{}"
  const { where, sortBy, order, limit } = options
  return JSON.stringify({ where, sortBy, order, limit }, (_k, v) =>
    typeof v === "function" ? "fn" : v,
  )
}

export function createLiveQueries<TRow extends Record<string, unknown>>(
  handle: CollectionHandle<TRow>,
  engineOpts: LiveQueriesOptions = {},
): LiveQueries<TRow> {
  const entries = new Map<string, Entry>()
  const globalGc = engineOpts.gcTime ?? DEFAULT_GC

  function recompute(key: string): void {
    const entry = entries.get(key)
    if (!entry) return
    if (entry.running) {
      entry.rerun = true
      return
    }
    entry.running = true
    entry.rerun = false
    void handle
      .query(entry.options as QueryOptions<TRow> | undefined)
      .then((rows) => {
        const e = entries.get(key)
        if (!e) return
        e.running = false
        const next = rows as AnyDoc[]
        //equality-guard: a recompute that produced the same data must not
        //churn subscribers (every storage write re-runs every live query)
        if (e.data && deepEqual(e.data, next)) {
          if (e.rerun) recompute(key)
          return
        }
        e.data = next
        e.state = { data: next, isLoading: false }
        for (const cb of e.subscribers) cb()
        //coalesce: replay one recompute if a change landed during the run
        if (e.rerun) recompute(key)
      })
  }

  function ensureLive(entry: Entry, key: string): void {
    if (entry.unsubscribe) return
    entry.unsubscribe = handle.subscribe(() => recompute(key))
  }

  function teardown(key: string): void {
    const entry = entries.get(key)
    if (!entry) return
    if (entry.gcTimer) {
      clearTimeout(entry.gcTimer)
      entry.gcTimer = null
    }
    entry.unsubscribe?.()
    entry.unsubscribe = null
    //keep entry.data: it is the last-known snapshot future mounts SWR off of
  }

  function observe(
    options: QueryOptions<TRow> | undefined,
    onChange: () => void,
  ): LiveHandle<TRow> {
    const key = keyOf(options as QueryOptions<unknown> | undefined)
    let entry = entries.get(key)
    if (!entry) {
      entry = {
        data: undefined,
        state: LOADING,
        options: options as QueryOptions<unknown> | undefined,
        subscribers: new Set(),
        unsubscribe: null,
        gcTimer: null,
        running: false,
        rerun: false,
      }
      entries.set(key, entry)
    }
    const current = entry
    current.options = options as QueryOptions<unknown> | undefined
    if (current.gcTimer) {
      clearTimeout(current.gcTimer)
      current.gcTimer = null
    }
    current.subscribers.add(onChange)
    ensureLive(current, key)
    //revalidate on (re)mount — instant if warm, fills the snapshot if cold
    recompute(key)

    return {
      //stable identity between real changes — safe for useSyncExternalStore
      get: () => current.state as LiveState<TRow>,
      unsubscribe: () => {
        current.subscribers.delete(onChange)
        if (current.subscribers.size > 0) return
        const gc = options?.gcTime ?? globalGc
        //Infinity → keep processing forever (no teardown, no timer)
        if (gc === Number.POSITIVE_INFINITY) return
        //0 (or less) → stop processing now, but retain last-known for SWR
        if (gc <= 0) {
          teardown(key)
          return
        }
        current.gcTimer = setTimeout(() => teardown(key), gc)
      },
    }
  }

  return { observe }
}
