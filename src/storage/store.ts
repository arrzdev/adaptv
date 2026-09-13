/**
 * `storage.store` — large / structured values, **async**.
 * → `docs/design/architecture.md §2.2` (L10)
 *
 * ## Scope boundary, and it is the important part
 *
 * This is an **async large-value KV. It is not a query engine and not an ORM.**
 * A real query layer — indexes, where-clauses, migrations — stays consumer-owned,
 * because `docs/design/rendering.md` already makes the data layer the consumer's. adaptv's job
 * is to (a) provide the simple async blob store the framework itself needs for
 * offline, and (b) guarantee the substrate exists. Not to grow into a database.
 *
 * ## Why raw IndexedDB rather than Dexie
 *
 * `docs/design/architecture.md §2.2` names Dexie, and Dexie is a fine library — but every
 * reason to reach for it (queries, indexes, schema migrations, live queries) is
 * explicitly **out of scope** above. What remains is `get`/`set`/`remove`/`keys`
 * over one object store, which is about eighty lines against the platform API.
 *
 * Taking the dependency would mean every consumer ships a query engine to get a
 * blob KV, including the many that never touch this tier. The scope boundary and
 * the dependency choice have to agree; this is the one that agrees with it. If
 * adaptv ever needs real queries, that is a decision to revisit *with* Dexie, not
 * a reason to pre-pay for it.
 *
 * Values are stored via **structured clone**, not JSON — so `Date`, `Map`, `Set`
 * and `Blob` survive a round trip. That is a real difference from `storage.kv`,
 * which JSON-encodes and silently turns a `Date` into a string.
 */

const DB_NAME = "adaptv-store"
const STORE_NAME = "kv"
const DB_VERSION = 1

/**
 * In-memory fallback.
 *
 * IndexedDB is genuinely absent in several places adaptv devs: during SSR, in
 * Safari private mode historically, and inside some embedded webviews. Throwing
 * there would make the tier unusable for the framework's own offline needs, so it
 * degrades to memory — correct for the session, just not durable.
 *
 * The same holds per key when IndexedDB is present but refuses a write — a quota
 * overrun at commit, a transaction the browser aborts. `set()` never rejects, so
 * a value that is not readable afterwards is lost with nothing reporting it, and
 * the read falls through to whatever the database held BEFORE. So every write
 * lands here first and leaves only once its transaction has committed; a read
 * consults this before the database. {@link REMOVED} marks a remove that has not
 * landed, so a refused delete cannot resurrect the old value.
 *
 * Each write holds its own {@link Entry}, and only the write whose entry is
 * still in place may settle it. Comparing VALUES instead would let the first of
 * two queued writes of the same value take the second's entry while it is still
 * pending — and REMOVED is one shared symbol, so every remove would look alike.
 */
type Entry = { value: unknown }
const memory = new Map<string, Entry>()
const REMOVED = Symbol("removed")

/** Keys whose latest write IndexedDB refused — what {@link store.isPersistent} reports. */
const unpersisted = new Set<string>()

/**
 * A clear IndexedDB refused whose keys could not even be listed, so no marker
 * could be left for them. Nothing to honour, but still not persistent.
 */
let clearRefused = false

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
      request.onsuccess = () => {
        const db = request.result
        //a connection that ignores versionchange blocks every deleteDatabase
        //(a consumer's wipe on logout) and every upgrade from another tab for
        //as long as this page lives. Step aside, and reopen on the next call.
        db.onversionchange = () => {
          db.close()
          dbPromise = null
        }
        resolve(db)
      }
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

function read<T>(
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T | undefined> {
  return database().then(
    (db) =>
      new Promise<T | undefined>((resolve) => {
        if (!db) return resolve(undefined)
        try {
          const request = run(
            db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME),
          )
          request.onsuccess = () => resolve(request.result)
          request.onerror = () => resolve(undefined)
        } catch {
          resolve(undefined)
        }
      }),
  )
}

/**
 * Run a write and resolve `true` only once its transaction has **committed**.
 * A request's `success` is not durability: a quota overrun is accepted by the
 * put and refused by the commit, which aborts the transaction afterwards.
 */
function commit(run: (store: IDBObjectStore) => void): Promise<boolean> {
  return database().then(
    (db) =>
      new Promise<boolean>((resolve) => {
        if (!db) return resolve(false)
        try {
          const tx = db.transaction(STORE_NAME, "readwrite")
          tx.oncomplete = () => resolve(true)
          tx.onabort = () => resolve(false)
          tx.onerror = () => resolve(false)
          run(tx.objectStore(STORE_NAME))
        } catch {
          resolve(false)
        }
      }),
  )
}

/** Hold `value` (or {@link REMOVED}) in memory until the database has taken it. */
async function write(
  key: string,
  value: unknown,
  run: (store: IDBObjectStore) => void,
): Promise<void> {
  const entry: Entry = { value }
  memory.set(key, entry)
  const landed = await commit(run)
  //a later write to the same key may have replaced the entry mid-flight — only
  //the write that put it there may take it out
  if (memory.get(key) !== entry) return
  if (landed) {
    memory.delete(key)
    unpersisted.delete(key)
  } else {
    unpersisted.add(key)
  }
}

async function hasIndexedDb(): Promise<boolean> {
  return (await database()) !== null
}

export const store = {
  /** Read a value. Resolves to `undefined` when absent. */
  async get<T>(key: string): Promise<T | undefined> {
    const entry = memory.get(key)
    if (entry) {
      return entry.value === REMOVED ? undefined : (entry.value as T)
    }
    return (await read<T>((s) => s.get(key))) as T | undefined
  },

  /**
   * Write a value. Stored by structured clone, so `Date`/`Map`/`Set`/`Blob`
   * survive — unlike `storage.kv`, which JSON-encodes.
   */
  async set<T>(key: string, value: T): Promise<void> {
    await write(key, value, (s) => s.put(value as unknown, key))
  },

  async remove(key: string): Promise<void> {
    await write(key, REMOVED, (s) => s.delete(key))
  },

  /**
   * Drop every key in adaptv's store. Never touches other databases.
   *
   * A clear IndexedDB refuses is honoured for the session the way a refused
   * remove is: every key the database still holds gets a {@link REMOVED}
   * marker, so nothing comes back, and `isPersistent()` turns false because the
   * values will be there again on the next launch. The key list is read in the
   * clear's own transaction, before the clear, so it is exactly what the clear
   * was meant to drop.
   */
  async clear(): Promise<void> {
    memory.clear()
    unpersisted.clear()
    clearRefused = false
    let held: IDBValidKey[] | undefined
    const landed = await commit((s) => {
      const listing = s.getAllKeys()
      listing.onsuccess = () => {
        held = listing.result
      }
      s.clear()
    })
    if (landed || !(await hasIndexedDb())) return
    if (!held) {
      clearRefused = true
      return
    }
    for (const key of held.map(String)) {
      //an entry here belongs to a write issued after the clear: it wins
      if (memory.has(key)) continue
      memory.set(key, { value: REMOVED })
      unpersisted.add(key)
    }
  },

  async keys(): Promise<string[]> {
    const keys = new Set(
      ((await read<IDBValidKey[]>((s) => s.getAllKeys())) ?? []).map(
        String,
      ),
    )
    for (const [key, { value }] of memory) {
      if (value === REMOVED) keys.delete(key)
      else keys.add(key)
    }
    return [...keys]
  },

  /**
   * Whether writes actually persist. `false` means the memory fallback is in
   * play — no IndexedDB at all, or a value whose last write it refused — useful
   * for deciding whether to warn, not for deciding whether to call.
   */
  async isPersistent(): Promise<boolean> {
    return (
      (await hasIndexedDb()) && unpersisted.size === 0 && !clearRefused
    )
  },
}
