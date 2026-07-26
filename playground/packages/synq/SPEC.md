# @repo/synq — design spec

Local-first data framework. Local store is the source of truth; upstream sync is
optional and developer-driven. Origin discussion: repo-root `OFFLINE-SPEC-CHAT.md`
+ the design interview that produced this doc.

This is a **redesign** of the proof-of-concept already in `packages/synq`. It records
what is kept, what is reshaped, and what is new. Nothing here is built until signed off.

---

## 0. Decisions (locked)

| # | Decision | Choice |
|---|----------|--------|
| 1 | Wire model | Transport-agnostic. `push` hands the dev **both** the field-level delta **and** the full snapshot per change; the dev maps to their server. |
| 2 | Read API | Index-backed only: `where` + `orderBy` + `limit`. **No predicate `.filter()` in v1.** |
| 3 | Conflicts | Auto field-level HLC last-write-wins + **opt-in value-level resolver** per field. |
| 4 | Reactive hook | **Local-only.** `isLoading` until first read; `data` then always live. Sync status is a separate subscription. |
| 5 | Resolvers | **Value-level**: `(local, remote, ctx) => value`. Covers union/max/longest. Counters explicitly unsupported. |
| 6 | Live-query recompute | **Per-collection re-run**, microtask-coalesced. Index-narrowing deferred. |
| 7 | Adapters v1 | **Memory + IndexedDB** only; others behind their own entry points later. |
| 8 | Tombstones | **Server-authoritative purge**: keep until acked AND pulled-past, then drop; server GCs on its schedule. |
| 9 | Schema drift | **Versioned migrations** (`version` + `migrate(doc, from)`); newer-version pulled docs are preserved (forward-compat), never downgraded. |
| 10 | Multi-tab | **Shared device id + leader-elected sync** (`navigator.locks`); all tabs write locally + broadcast; one tab pulls/pushes. |
| 11 | Retry/poison | **Lib safety-net + dev override**: default max-retry + backoff → quarantine; dev `ctx.discard` authoritative. |
| 12 | Nested data | **Child collection primary** (rows + fractional rank); first-class `set()` field for small embedded sets. |

---

## 1. Package layout

Segmented entry points so an unused adapter never enters a bundle.

```
@repo/synq                  → react-free root re-export of /core
@repo/synq/core             → pure engine (no DOM, no React)
@repo/synq/types            → shared public types
@repo/synq/adapters         → adapter interface + memory adapter
@repo/synq/adapters/indexeddb → IndexedDB adapter (BroadcastChannel)
@repo/synq/reactive         → SynqProvider + useCollection + query builder (React)
```

Renames vs current: `./storage` → `./adapters`, `./react` → `./reactive`, new
`./adapters/indexeddb` subpath. `imports: { "#synq/*": "./src/*" }` stays.

---

## 2. Public API

### Define collections (config object, not a fluent type DSL)

```ts
import { collection } from "@repo/synq/core"

const lists = collection<List>("lists", { version: 1 })

const listItems = collection<ListItem>("listItems", {
  indexes: { byList: ["listId", "rank"], byDone: ["done"] }, // declared for queries
  sets:    ["tags"],                 // OR-set fields: element-level merge + tombstones
  atomic:  [["lat", "lng"]],         // fields that must move together
  resolvers: { /* field: (local, remote, ctx) => value; sets union by default */ },
  version: 2,
  migrate: (doc, fromVersion) => doc, // upgrade old on-device shapes
})
```

The engine needs `sets` and `atomic` to pick the right merge per field; everything
else is scalar HLC-LWW. `indexes` declares what `where/orderBy` can use.

### Create the db

```ts
import { createSynq } from "@repo/synq/core"
import { indexedDbAdapter } from "@repo/synq/adapters/indexeddb"

const db = createSynq({
  adapter: indexedDbAdapter({ name: "chopchop" }),
  collections: { lists, listItems },
  transport: { listItems: { pull, push } },  // optional, per collection
  node:  /* persisted device id, auto-generated if absent */,
  retry: { max: 8, backoffMs: 500 },          // poison safety-net (tunable/off)
})
```

A collection with **no transport entry is local-only** — "upstream optional" falls
out for free; add transport later to make it sync.

### Collection handle

```ts
db.listItems.insert(doc)          // returns id
db.listItems.update(id, patch)    // field-level patch
db.listItems.delete(id)           // row tombstone
db.listItems.get(id)
db.listItems.query(q => q.where("listId").equals(x).orderBy("rank"))
db.listItems.subscribe(cb)        // fires on ALL writes (incl. pull) — for live reads
db.listItems.sync()               // pull+push this collection (idempotent; returns in-flight promise)

db.sync()                         // all collections with transport
db.onLocalChange(cb)              // fires ONLY on local-origin writes — echo-suppressed sync trigger
```

**Two channels** = echo suppression: `subscribe`/query updates fire on every write so
the UI reflects pulled data; `onLocalChange` fires only on local-origin writes so the
app's debounced `sync()` never loops (pull → local write → pull …).

### Sync status (separate from the reactive hook, per decision #4)

```ts
db.syncState.get()        // { phase: "idle"|"syncing"|"error", pending, lastError, lastSyncedAt }
db.syncState.subscribe(cb)
```

The app wires this to the status cue. `useCollection` knows nothing about it.

### Reactive (React)

```tsx
<SynqProvider db={db} gcTime={5 * 60_000}>…</SynqProvider>

const { data, isLoading } = useCollection(
  db.listItems,
  q => q.where("listId").equals(listId).orderBy("rank"),
  { gcTime },               // overrides provider default
)
```

- **Local-only**: `isLoading` true until the first async read resolves; `data` is then
  always the live local result.
- Provider owns one live-query engine: dedup by serialized query key (two components,
  same query → one engine), ref-count, per-query `gcTime`.
- `gcTime: 0` → engine torn down on unmount; a warm cache keeps the last result so a
  remount shows it instantly (SWR) then recomputes.
- `gcTime: Infinity` → query stays live for the app's lifetime after first mount.
- Recompute: any write to the collection re-runs its live queries, coalesced into one
  microtask (decision #6).

### Query builder (index-backed only)

```ts
q.where(field).equals(v) | .above(v) | .below(v) | .between(a, b) | .startsWith(s)
 .and(field)…                 // compound, served by a compound index
 .orderBy(field, "asc"|"desc")
 .limit(n).offset(n)
```

No `.filter(fn)` in v1 (decision #2). A query that can't be served by a declared index
throws at dev time, naming the index to add.

---

## 3. Change envelope + sync pipeline

The normalized envelope is the real contract; HTTP shape is the dev's business.

```ts
type Stamp = string                              // HLC
type FieldDelta = { value: JSONValue; hlc: Stamp }

type Change<T> = {
  type: "insert" | "update" | "delete"
  id: string
  delta: Record<string, FieldDelta>              // only fields changed this batch, each stamped
  snapshot: T | null                             // full current doc after delta (null on delete)
  deletedAt?: Stamp                              // row tombstone stamp
}

pull(cursor: Cursor | null): Promise<{ changes: Change<T>[]; nextCursor: Cursor }>
push(changes: Change<T>[], ctx: TxContext): Promise<void>   // ctx.ack / .retry / .discard
```

- `Cursor` is **opaque to the lib** — server defines it (seq/timestamp/ULID). Lib only
  persists "last cursor per collection".
- Snapshot-only backends: stamp the whole row with one HLC; the envelope still merges,
  just at row granularity. Granularity is the dev's tradeoff.

**Per-collection sync run** (abort-safe; a newer local write mid-run is not clobbered):

1. Snapshot local outbox + rows + cursor.
2. `pull(cursor)` → remote changes (drain pages until `nextCursor` stops advancing).
3. Merge remote into local (§4). These writes are **sync-origin**: no outbox entries,
   no `onLocalChange`. Advance cursor.
4. Coalesce outbox into net per-row changes (insert→…→delete collapses to nothing).
5. Equality guard: drop changes the merged remote already satisfies (no-op push).
6. Build `Change[]` (delta + snapshot).
7. `push(changes, ctx)`.
8. Resolve outbox by ctx; apply retry/quarantine (§7).
9. Atomic swap.

---

## 4. Merge / conflict model

Commutative, associative, idempotent. Per field:

- **Scalar** → HLC last-write-wins (higher HLC wins; node id breaks ties).
  - **Conflict preservation (no silent loss).** LWW is *convergent* but lossy: a
    concurrent same-field write is dropped. To make the loss recoverable instead of
    silent, the merge keeps the loser. A field is a *genuine concurrent conflict* only
    when **both** sides changed it relative to the last-synced common **base** (passed
    as `MergeOptions.base` — only the client sync merge has it); a sequential edit
    (one side still on the base stamp) is a normal supersede and captures nothing. The
    LWW winner stays the live value; the loser is recorded in `$meta.conflicts[field]`
    as `{ hlc, value, against }`. `conflicts` is a semilattice (union on merge, dedup
    by stamp), so it converges and reaches every device. A later write to the field
    (live stamp moves past `against`) garbage-collects it = resolution; a row delete
    clears all conflicts. Surface/clear via `getConflicts(doc)` / `hasConflicts(doc)`.
    Scalar fields only for now (sets are already lossless via the OR-set; atomic
    groups and resolvers still plain-LWW).
- **Atomic group** → the group's max field-HLC decides; the whole group moves together.
- **`set()` field** → OR-set: map of `elementId → { value, hlc, deletedAt? }`; add vs
  concurrent remove of *different* elements both survive; element tombstones purge per §6.
- **Custom resolver** → `(local, remote, ctx) => value`, value-level only (decision #5).
- **Row delete** → `deletedAt` tombstone; LWW against later writes (no resurrection).

`documentsEqual` guards no-op writes. `isDeleted` honored everywhere.

**Nested element collections** (decision #12): the headline pattern is a **child
collection** — each element is its own row (`listItems` with `listId` + `rank`), so
deleting an element is an ordinary row tombstone and the array is read back via
`where("listId").equals(x).orderBy("rank")`. `set()` is the embedded option for small,
bounded, always-loaded-together sets (tags).

**Ordering**: fractional ranks — `rank.between(a, b)` yields a string key strictly
between two neighbors, so concurrent inserts never renumber or collide. Plain LWW on the
`rank` field. (Full sequence CRDT / RGA is out of scope; only needed for collab text.)

---

## 5. Schema migrations (decision #9)

- Each collection: `version` + `migrate(doc, fromVersion)`.
- On open: local docs below current version are upgraded before any merge.
- On pull: a doc tagged a **newer** version than this client knows is **not** downgraded
  — merged value-wise with unknown fields preserved untouched (forward-compat), flagged
  once. An older-version pulled doc is migrated up before merge.

---

## 6. Tombstone GC (decision #8)

- Row + element tombstones are retained until **acked AND** the local cursor has advanced
  past the point that includes the delete (server confirms propagation), then purged.
- Server retains tombstones for a window and GCs on its own schedule (documented server
  responsibility). A device offline past that window is reconciled on next full pull.

---

## 7. Multi-tab + retry

**Multi-tab (decision #10):** one persisted device node-id → one shared HLC clock
(writes to the clock guarded by a lock to stay monotonic). `navigator.locks.request`
elects the single tab that runs `pull/push`; non-leader tabs forward "sync now" to the
leader and observe results via BroadcastChannel (already built). Leader failover is
automatic when its tab closes (lock releases). All tabs may write locally.

**Retry/poison (decision #11):** per-change retry count + exponential capped backoff.
After `retry.max` (default 8) the change is **quarantined** — kept, flagged `poisoned`,
skipped on future pushes, surfaced in `syncState` — instead of wedging the queue. The
dev's `ctx.discard(id)` removes it; `ctx.ack` clears it. The net is tunable/disable-able.

---

## 8. Reuse / reshape / new (vs current code)

**Reuse** (largely as-is): `ids`, `hlc`, deep-equal, `apply`, `stitch`, `coalesce`,
`tx-context`, sync-engine core, memory + IndexedDB adapters.

**Reshape:**
- Transport `{ inserts, updates, deletes }` → single `push(changes: Change[])` with the
  delta+snapshot envelope; `pull` returns `Change[]`.
- Collection config gains `indexes / sets / atomic / resolvers / version / migrate`.
- Exports: `storage` → `adapters` (+ `adapters/indexeddb`), `react` → `reactive`.
- `useSynqQuery(handle)` → `SynqProvider` + `useCollection` + query builder + `gcTime`.
- `merge` extended: value-level resolvers + first-class `set()` element merge.

**New:** query builder + IndexedDB index planning; reactive provider/engine (dedup,
ref-count, gcTime, warm-cache SWR); `onLocalChange` echo-suppressed channel; `syncState`
store; `rank` helper; migration runner; multi-tab leader election; tombstone GC; retry
backoff + quarantine.

---

## 9. App integration

- **Frontend** `apps/frontend/src/data/synq.ts`: rebuild on the new API. Sync controller
  drives off `db.onLocalChange` (debounced) + startup/online/heartbeat; the cue reads
  `db.syncState`. `useTodos` → `useCollection`.
- **Backend**: keep generic `documents` + `sync_counters`; update `pull/push` to the
  envelope (delta + snapshot + per-field meta — meta already stored as JSON). Server-side
  convergence keeps reusing `@repo/synq/core` merge.
- **Decks / settings**: optional — can become synq local-only collections (no transport)
  to retire Dexie. Out of v1 scope unless requested.

---

## 10. Build order (TDD)

1. core types + `Change` envelope + `rank` + ids/hlc (reuse).
2. merge v2 (scalar LWW + resolvers + atomic + `set()` elements + row tombstones + equality) — tests.
3. coalesce v2 → `Change[]` (delta + snapshot) — tests.
4. adapters (memory + indexeddb) behind new entry points, with index support — tests (fake-indexeddb).
5. query builder + index planner — tests.
6. `createSynq` + handle + two-channel subscribe + `onLocalChange` echo-suppression + migration runner — tests.
7. sync engine v2 pipeline + tombstone GC + retry/quarantine + leader election — tests (abort, poison, GC).
8. reactive: `SynqProvider` + `useCollection` + dedup + gcTime + warm-cache SWR — tests (happy-dom).
9. app integration (frontend + backend envelope + cue on `syncState`).
10. e2e (two-profile Playwright): propagation, concurrent field merge, element add/remove
    convergence, concurrent-insert ordering, multi-tab leader, offline create→update→delete = zero network.

## 11. Verification gate

`pnpm typecheck` + Biome + scoped builds + synq unit tests + backend tests + two-profile
Playwright e2e + a multi-tab leader test. Reported green before any "done".
