/**
 * `storage.store` — large / structured values, **async**.
 * → `ARCHITECTURE.md §2.2` (L10)
 *
 * ## Scope boundary, and it is the important part
 *
 * This is an **async large-value KV. It is not a query engine and not an ORM.**
 * A real query layer — indexes, where-clauses, migrations — stays consumer-owned,
 * because `RENDERING.md` already makes the data layer the consumer's. nativ's job
 * is to (a) provide the simple async blob store the framework itself needs for
 * offline, and (b) guarantee the substrate exists. Not to grow into a database.
 *
 * ## Why raw IndexedDB rather than Dexie
 *
 * `ARCHITECTURE.md §2.2` names Dexie, and Dexie is a fine library — but every
 * reason to reach for it (queries, indexes, schema migrations, live queries) is
 * explicitly **out of scope** above. What remains is `get`/`set`/`remove`/`keys`
 * over one object store, which is about eighty lines against the platform API.
 *
 * Taking the dependency would mean every consumer ships a query engine to get a
 * blob KV, including the many that never touch this tier. The scope boundary and
 * the dependency choice have to agree; this is the one that agrees with it. If
 * nativ ever needs real queries, that is a decision to revisit *with* Dexie, not
 * a reason to pre-pay for it.
 *
 * Values are stored via **structured clone**, not JSON — so `Date`, `Map`, `Set`
 * and `Blob` survive a round trip. That is a real difference from `storage.kv`,
 * which JSON-encodes and silently turns a `Date` into a string.
 */

const DB_NAME = "nativ-store"
const STORE_NAME = "kv"
const DB_VERSION = 1

/**
 * In-memory fallback.
 *
 * IndexedDB is genuinely absent in several places nativ runs: during SSR, in
 * Safari private mode historically, and inside some embedded webviews. Throwing
 * there would make the tier unusable for the framework's own offline needs, so it
 * degrades to memory — correct for the session, just not durable.
 */
const memory = new Map<string, unknown>()

let dbPromise: Promise<IDBDatabase | null> | null = null

function openDatabase(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null)
  return new Promise((resolve) => {
    try {
      const request = indexedDB.open(DB_NAME, DB_VERSION)
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE_NAME)) {
          request.result.createObjectStore(STORE_NAME)
        }
      }
      request.onsuccess = () => resolve(request.result)
      //resolve(null) rather than reject: every caller then takes the memory
      //path, which is exactly what should happen when storage is unavailable
      request.onerror = () => resolve(null)
      request.onblocked = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
}

function database(): Promise<IDBDatabase | null> {
  dbPromise ??= openDatabase()
  return dbPromise
}

function transact<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T | undefined> {
  return database().then(
    (db) =>
      new Promise<T | undefined>((resolve) => {
        if (!db) return resolve(undefined)
        try {
          const tx = db.transaction(STORE_NAME, mode)
          const request = run(tx.objectStore(STORE_NAME))
          request.onsuccess = () => resolve(request.result)
          request.onerror = () => resolve(undefined)
        } catch {
          resolve(undefined)
        }
      }),
  )
}

async function hasIndexedDb(): Promise<boolean> {
  return (await database()) !== null
}

export const store = {
  /** Read a value. Resolves to `undefined` when absent. */
  async get<T>(key: string): Promise<T | undefined> {
    if (!(await hasIndexedDb())) return memory.get(key) as T | undefined
    return (await transact<T>("readonly", (s) => s.get(key))) as
      | T
      | undefined
  },

  /**
   * Write a value. Stored by structured clone, so `Date`/`Map`/`Set`/`Blob`
   * survive — unlike `storage.kv`, which JSON-encodes.
   */
  async set<T>(key: string, value: T): Promise<void> {
    memory.set(key, value)
    if (!(await hasIndexedDb())) return
    await transact("readwrite", (s) => s.put(value as unknown, key))
  },

  async remove(key: string): Promise<void> {
    memory.delete(key)
    if (!(await hasIndexedDb())) return
    await transact("readwrite", (s) => s.delete(key))
  },

  /** Drop every key in nativ's store. Never touches other databases. */
  async clear(): Promise<void> {
    memory.clear()
    if (!(await hasIndexedDb())) return
    await transact("readwrite", (s) => s.clear())
  },

  async keys(): Promise<string[]> {
    if (!(await hasIndexedDb())) return [...memory.keys()]
    const keys = await transact<IDBValidKey[]>("readonly", (s) =>
      s.getAllKeys(),
    )
    return (keys ?? []).map(String)
  },

  /**
   * Whether writes actually persist. `false` means the memory fallback is in
   * play — useful for deciding whether to warn, not for deciding whether to call.
   */
  async isPersistent(): Promise<boolean> {
    return hasIndexedDb()
  },
}
