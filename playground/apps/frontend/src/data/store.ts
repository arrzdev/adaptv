import { createIndexedDbStorage } from "@repo/synq/adapters/indexeddb"
import { createMemoryStorage } from "@repo/synq/adapters/memory"
import { createSynqStorage } from "@repo/synq/core"
import { decksCollection } from "@/data/collections/decks/decks.collection"
import { preferencesCollection } from "@/data/collections/preferences/preferences.collection"
import { todosCollection } from "@/data/collections/todos/todos.collection"

//---- The local store ----------------------------------------------
//one register for the whole app: pick a storage adapter, list every
//collection, get back a typed `store` (store.todos, store.decks,
//store.preferences). add a collection = drop its `*.collection.ts` into
//`collections`. every collection is LOCAL-ONLY — none declares a transport, so
//nothing is ever pulled or pushed anywhere.

//the IndexedDB database name
const SYNQ_DB_NAME = "chopchop-synq"

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
