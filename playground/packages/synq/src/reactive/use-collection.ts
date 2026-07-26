import type { ReactElement, ReactNode } from "react"
import {
  createContext,
  createElement,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react"
import type {
  LiveHandle,
  LiveQueries,
  LiveState,
} from "#synq/reactive/live-queries"
import { createLiveQueries } from "#synq/reactive/live-queries"
import type {
  CollectionHandle,
  QueryOptions,
  SingletonHandle,
} from "#synq/types/query.types"
import type { LocalDocument } from "#synq/types/synq.types"

//---- React binding ------------------------------------------------
//useCollection is a thin view over the live-query engine. every component
//sharing a (handle, query) pair observes ONE engine instance — registered
//per handle in a module map so dedup spans the whole tree whether or not a
//SynqProvider is mounted. the provider only carries the global gcTime
//default; a per-hook gcTime always wins.

type AnyRow = Record<string, unknown>
// biome-ignore lint/suspicious/noExplicitAny: handle registry spans every row shape
type AnyHandle = CollectionHandle<any>

const engines = new WeakMap<AnyHandle, LiveQueries<AnyRow>>()

function engineFor<TRow extends Record<string, unknown>>(
  handle: CollectionHandle<TRow>,
): LiveQueries<TRow> {
  let engine = engines.get(handle as AnyHandle)
  if (!engine) {
    engine = createLiveQueries(handle) as unknown as LiveQueries<AnyRow>
    engines.set(handle as AnyHandle, engine)
  }
  return engine as unknown as LiveQueries<TRow>
}

const LOADING = Object.freeze({
  data: [],
  isLoading: true,
}) as LiveState<Record<string, unknown>>

function keyOf(options: QueryOptions<unknown> | undefined): string {
  if (!options) return "{}"
  const { where, sortBy, order, limit } = options
  return JSON.stringify({ where, sortBy, order, limit }, (_k, v) =>
    typeof v === "function" ? "fn" : v,
  )
}

interface SynqConfig {
  gcTime?: number
}

const SynqContext = createContext<SynqConfig>({})

export function SynqProvider(props: {
  gcTime?: number
  children: ReactNode
}): ReactElement {
  const value = useMemo(() => ({ gcTime: props.gcTime }), [props.gcTime])
  return createElement(SynqContext.Provider, { value }, props.children)
}

export function useCollection<TRow extends Record<string, unknown>>(
  handle: CollectionHandle<TRow>,
  options?: QueryOptions<TRow>,
): LiveState<TRow> {
  const config = useContext(SynqContext)
  const engine = engineFor(handle)
  const key = keyOf(options as QueryOptions<unknown> | undefined)
  //effective retention: per-hook gcTime wins, else the provider default.
  //read through refs so an inline options object can't thrash the observer
  const gcTime = options?.gcTime ?? config.gcTime
  const ref = useRef<LiveHandle<TRow> | null>(null)
  const optionsRef = useRef(options)
  optionsRef.current = options
  const gcTimeRef = useRef(gcTime)
  gcTimeRef.current = gcTime

  //key gates the subscription identity (read via refs inside) so a changed
  //query forces useSyncExternalStore to re-subscribe to the right observer
  // biome-ignore lint/correctness/useExhaustiveDependencies: key is an intentional invalidation key
  const subscribe = useMemo(
    () => (onChange: () => void) => {
      const g = gcTimeRef.current
      const effective = {
        ...(optionsRef.current ?? {}),
        ...(g === undefined ? {} : { gcTime: g }),
      } as QueryOptions<TRow>
      const h = engine.observe(effective, onChange)
      ref.current = h
      return () => {
        h.unsubscribe()
        ref.current = null
      }
    },
    [engine, key],
  )

  function getSnapshot(): LiveState<TRow> {
    return ref.current?.get() ?? (LOADING as LiveState<TRow>)
  }

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

//---- Singleton hook -----------------------------------------------
//reactive read of a one-row collection — a `useCollection` for a single kv-style
//row. `data` is that row with defaults filling any unwritten field.
//
//Like the live-query engine, the last-known value is kept WARM per handle so a
//remount paints it instantly (stale-while-revalidate) instead of flashing the
//`defaults` fallback while the async read is in flight. Without this the hook
//re-fetched from `undefined` on every mount, so a singleton read from one screen
//(e.g. preferences on the home page) didn't carry over to the next — the exact
//gap that made an unrelated screen's switches animate from their defaults on open.
const singletonWarmCache = new WeakMap<object, unknown>()

export function useSingleton<TRow extends Record<string, unknown>>(
  handle: SingletonHandle<TRow>,
): { data: LocalDocument<TRow> | undefined; isLoading: boolean } {
  const [data, setData] = useState<LocalDocument<TRow> | undefined>(
    () =>
      singletonWarmCache.get(handle) as LocalDocument<TRow> | undefined,
  )
  useEffect(() => {
    let alive = true
    function refresh(): void {
      void handle.get().then((value) => {
        singletonWarmCache.set(handle, value)
        if (alive) setData(value)
      })
    }
    refresh()
    const unsubscribe = handle.subscribe(refresh)
    return () => {
      alive = false
      unsubscribe()
    }
  }, [handle])
  return { data, isLoading: data === undefined }
}
