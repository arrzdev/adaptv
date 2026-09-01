/**
 * `storage` — one namespace, three tiers, each hiding its per-target backend.
 * → `docs/design/architecture.md §2` (L10)
 *
 * | Tier | Shape | Web / PWA | Native | For |
 * |---|---|---|---|---|
 * | `storage.kv` | **sync** + hook | `localStorage` | memory mirror ↔ `@capacitor/preferences` | flags, settings, values read in render |
 * | `storage.store` | **async** + hook | IndexedDB | IndexedDB (the WebView's) | large values, offline cache |
 * | `storage.secure` | **async**, no hook | best-effort `localStorage` — **not secure** | Keychain / Keystore | tokens, secrets |
 *
 * Encoding is **per tier, not uniform**: `kv` and `secure` store strings and
 * JSON-encode, so their values must be JSON-serializable; `store` does not
 * encode at all (structured clone — see below). All tiers are SSR-safe.
 *
 * Isolation from the consumer's own storage is likewise per tier, and total
 * either way: `kv` and `secure` prefix every key (`adaptv:kv:`, `adaptv:secure:`),
 * which is what bounds `clear()` and cross-tab sync; `store` needs no prefix
 * because it owns a dedicated IndexedDB database (`adaptv-store`).
 *
 * `storage.store` is an async large-value KV, deliberately **not** a query engine
 * or ORM — a real query layer stays consumer-owned (`docs/design/rendering.md` makes the data
 * layer the consumer's). It is built on raw IndexedDB rather than Dexie precisely
 * because every reason to want Dexie is out of that scope; see `store.ts`.
 *
 * Values there survive **structured clone**, so `Date`/`Map`/`Set`/`Blob` round
 * trip — unlike `kv`, which JSON-encodes and turns a `Date` into a string.
 */
export { initKv, KV_PREFIX, kv, subscribeKv } from "#adaptv/storage/kv"
export { secure } from "#adaptv/storage/secure"
export { store } from "#adaptv/storage/store"
export { useKv } from "#adaptv/storage/use-kv"
export { useStore } from "#adaptv/storage/use-store"

import { kv } from "#adaptv/storage/kv"
import { secure } from "#adaptv/storage/secure"
import { store } from "#adaptv/storage/store"

/** The `storage` namespace. Import the tiers directly for better tree-shaking. */
export const storage = { kv, store, secure }
