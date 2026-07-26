//@repo/synq/adapters/indexeddb — browser persistence on raw IndexedDB
//with BroadcastChannel cross-tab commit relay. its own entry so non-
//browser consumers never bundle it.

export type { IndexedDbOptions } from "../adapters/indexeddb.adapter"
export { createIndexedDbStorage } from "../adapters/indexeddb.adapter"
