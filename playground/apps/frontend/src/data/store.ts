import { createIndexedDbStorage } from "@repo/synq/adapters/indexeddb"
import { createMemoryStorage } from "@repo/synq/adapters/memory"
import { createSynqStorage } from "@repo/synq/core"
import { decksCollection } from "@/data/collections/decks/decks.collection"
import { preferencesCollection } from "@/data/collections/preferences/preferences.collection"
import { todosCollection } from "@/data/collections/todos/todos.collection"

//---- The local store ----------------------------------------------
//one register for the whole app: pick a storage adapter, list every
//collection, get back a typed `store` (store.todos, store.decks,
//store.preferences, store.sync()). add a collection = drop its
//`*.collection.ts` into `collections`. reads/writes are local + optimistic;
//data/sync/controller.ts decides WHEN to reconcile synced collections with the
//backend.

//the IndexedDB database name — exported so sign-out can wipe the local store
export const SYNQ_DB_NAME = "chopchop-synq"

//indexeddb in the browser; in-memory keeps SSR/import-time safe
const storageAdapter =
  typeof indexedDB !== "undefined"
    ? createIndexedDbStorage({ name: SYNQ_DB_NAME })
    : createMemoryStorage()

export const store = createSynqStorage({
  storageAdapter,
  collections: {
    todos: todosCollection,
    decks: decksCollection,
    preferences: preferencesCollection,
  },
})

//wipe the local synq store IN PLACE (canonical rows + outbox + cursors) and let
//synq notify subscribers so the UI re-renders empty — no page reload. local
//only: it never enqueues deletions, so the wipe doesn't sync upstream. used on
//sign-out, and before pulling a different account's data on sign-in.
export function resetLocalStore(): Promise<void> {
  return store.resetLocal()
}
