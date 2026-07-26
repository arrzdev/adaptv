//@repo/synq/live — the framework-agnostic live-query engine: deduped
//observers + SWR retention over a CollectionHandle. the react hooks are a
//thin view over this; a Vue/Svelte/vanilla consumer binds here directly.

export type {
  LiveHandle,
  LiveQueries,
  LiveQueriesOptions,
  LiveState,
} from "../reactive/live-queries"
export { createLiveQueries } from "../reactive/live-queries"
