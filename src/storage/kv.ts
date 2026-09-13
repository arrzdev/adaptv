/**
 * `storage.kv` — fast key/value, **synchronous**, memory-backed.
 * → `docs/design/architecture.md §2.1`
 *
 * The MMKV model, chosen over async-everywhere for one reason: **reads never
 * `await`**, so a feature flag is readable *during render*. An async KV forces a
 * loading state onto every flag, and a boot gate onto the whole app.
 *
 * ## Mechanism (one API, two backends)
 *
 * Both targets read from an in-memory `Map` plus a subscriber set. The in-process
 * emitter is not optional even on web: the browser `storage` event is **cross-tab
 * only** and never fires in the tab that wrote, so without an emitter a component
 * would not react to its own app's writes.
 *
 * - **Web:** the map hydrates **synchronously** from `localStorage` at module
 *   load — no boot gate. A write updates the map, emits, and write-throughs
 *   synchronously, so it is **durable immediately**.
 * - **Native:** the map hydrates from `@capacitor/preferences` at boot, gated by
 *   the shell behind the splash (see {@link initKv}). A write updates the map,
 *   emits, and persists fire-and-forget — so a **~1-tick durability lag exists
 *   only on native**, and a hard crash in that window loses the last write.
 *   A write the bridge rejects is kept in memory for the session, exactly as a
 *   full `localStorage` is on web. Anything that cannot tolerate that belongs in
 *   `store` or `secure`.
 *
 * ⚠︎ `@capacitor/preferences` is **plaintext** — `UserDefaults` on iOS,
 * `SharedPreferences` on Android, verified in source. Fine for flags and
 * settings. **Never put a token here**; that is what `storage.secure` is for.
 */
import { Preferences } from "@capacitor/preferences"
import { isNativePlatform } from "#adaptv/utils/platform"

/**
 * Namespace for every adaptv-managed key.
 *
 * adaptv shares `localStorage` with the consumer's app, so `clear()` must be able
 * to tell its own keys apart. A blind `localStorage.clear()` would wipe the app's
 * data — framework-caused data loss, and exactly the kind of thing nobody finds
 * until production.
 */
export const KV_PREFIX = "adaptv:kv:"

const map = new Map<string, unknown>()
const listeners = new Map<string, Set<() => void>>()

function emit(key: string): void {
  const set = listeners.get(key)
  if (!set) return
  for (const listener of set) listener()
}

function parse(raw: string | null): unknown {
  if (raw === null) return undefined
  try {
    return JSON.parse(raw)
  } catch {
    //a half-written value or a hand-edited devtools entry must not brick boot —
    //this runs at MODULE LOAD, so a throw takes the whole app down
    return undefined
  }
}

function hydrateFromLocalStorage(): void {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const storageKey = localStorage.key(i)
      if (!storageKey?.startsWith(KV_PREFIX)) continue
      const value = parse(localStorage.getItem(storageKey))
      if (value !== undefined) {
        map.set(storageKey.slice(KV_PREFIX.length), value)
      }
    }
  } catch {
    //Safari private mode throws on access — degrade to memory-only
  }
}

function bindCrossTab(): void {
  window.addEventListener("storage", (event) => {
    const key = event.key
    if (!key?.startsWith(KV_PREFIX)) return
    const name = key.slice(KV_PREFIX.length)
    const value = parse(event.newValue)
    if (value === undefined) map.delete(name)
    else map.set(name, value)
    emit(name)
  })
}

//Web hydration is synchronous and happens at import — that is what removes the
//boot gate. Native hydration is async and runs from initKv() instead.
if (typeof window !== "undefined" && !isNativePlatform()) {
  hydrateFromLocalStorage()
  bindCrossTab()
}

/** A native write that did not land: the map already holds the truth for this session. */
function memoryOnly(): void {}

function persist(key: string, value: unknown): void {
  const raw = JSON.stringify(value)
  try {
    if (isNativePlatform()) {
      //fire-and-forget: the map is already updated, so reads are correct now.
      //This is the ~1-tick native durability lag documented above. The catch is
      //not optional: the try below only sees a SYNC throw, so a bridge rejection
      //would escape as an unhandled error for a write the caller was told had
      //succeeded. A failed write degrades to memory-only, same as a full
      //localStorage on web.
      Preferences.set({ key: KV_PREFIX + key, value: raw }).catch(
        memoryOnly,
      )
      return
    }
    localStorage.setItem(KV_PREFIX + key, raw)
  } catch {
    //quota exceeded, private mode, or the plugin missing from the binary (its
    //proxy throws synchronously) — stay memory-only rather than throwing out of
    //a setter the caller treats as infallible
  }
}

function unpersist(key: string): void {
  try {
    if (isNativePlatform()) {
      Preferences.remove({ key: KV_PREFIX + key }).catch(memoryOnly)
      return
    }
    localStorage.removeItem(KV_PREFIX + key)
  } catch {
    //same as persist
  }
}

export const kv = {
  /**
   * Read a value. Synchronous by design.
   *
   * The fallback applies only when the key is **absent** — not when the stored
   * value is falsy. `false` and `0` are real values, and a `??` on the result
   * would silently resurrect the default every time someone stored `false`, which
   * is the most common thing a flag holds.
   */
  get<T>(key: string, fallback?: T): T | undefined {
    if (!map.has(key)) return fallback
    return map.get(key) as T
  },

  set<T>(key: string, value: T): void {
    //store the PARSED value so `get` is referentially stable between calls —
    //re-parsing per read would return a new object each time and spin
    //useSyncExternalStore forever
    map.set(key, value)
    persist(key, value)
    emit(key)
  },

  remove(key: string): void {
    map.delete(key)
    unpersist(key)
    emit(key)
  },

  /** Drop every adaptv-managed key. Never touches the consumer's own storage. */
  clear(): void {
    const keys = [...map.keys()]
    map.clear()
    for (const key of keys) {
      unpersist(key)
      emit(key)
    }
  },
}

/** Subscribe to changes for one key. Returns an unsubscribe. */
export function subscribeKv(
  key: string,
  listener: () => void,
): () => void {
  let set = listeners.get(key)
  if (!set) {
    set = new Set()
    listeners.set(key, set)
  }
  set.add(listener)
  return () => {
    set.delete(listener)
    if (set.size === 0) listeners.delete(key)
  }
}

/**
 * Hydrate the map from native storage. Called by the shell at boot, behind the
 * splash, alongside the other eager init (keyboard listeners, theme).
 *
 * No-op on web, where hydration already happened synchronously at import.
 */
export async function initKv(): Promise<void> {
  if (!isNativePlatform()) return
  try {
    const { keys } = await Preferences.keys()
    for (const storageKey of keys) {
      if (!storageKey.startsWith(KV_PREFIX)) continue
      const { value } = await Preferences.get({ key: storageKey })
      const parsed = parse(value)
      if (parsed !== undefined) {
        map.set(storageKey.slice(KV_PREFIX.length), parsed)
      }
    }
  } catch {
    //plugin missing or storage unavailable — memory-only is still correct,
    //just not durable. Never block boot on it.
  }
  for (const key of map.keys()) emit(key)
}
