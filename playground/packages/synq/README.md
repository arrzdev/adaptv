# @repo/synq

Offline-first data framework. Local storage is the source of truth; the
network is an **optional** background optimization. Built from scratch — no
Dexie, no React in the core — so the engine is pure, fully unit-testable, and
the storage/reactivity backends are swappable adapters.

## Entry points

| Entry | Contents |
|-------|----------|
| `@repo/synq` (= `/core`) | headless client core: `createSynqStorage`, snapshot sync engine, CRDT merge, HLC clock, leader election, all shared types |
| `@repo/synq/types` | type-only surface (+ `singletonCollection`, reserved-key constants, the `StorageAdapter` contract) |
| `@repo/synq/adapters/indexeddb` | browser persistence (raw IndexedDB + BroadcastChannel cross-tab relay) |
| `@repo/synq/adapters/memory` | reference in-memory adapter (tests, SSR) |
| `@repo/synq/react` | `useCollection` / `useSingleton` / `SynqProvider` |
| `@repo/synq/live` | framework-agnostic live-query engine the react hooks sit on |
| `@repo/synq/protocol` | the sync wire contract: pull/push request/response types + structural validators (`isStoredDocument`) |
| `@repo/synq/server` | the backend half: `createSyncServer` over a `ServerDocumentStore` your database implements |

Internal machinery (stitch, coalesce, apply, tx resolution) is deliberately
not exported — it can change shape without a breaking release.

## Architecture

Two decoupled tracks:

```
Track 1 — reads (always local, instant)
  UI ── useCollection ── live-query cache ── StorageAdapter ── [canonical store + outbox]

Track 2 — sync (db.sync() / db.todos.sync())
  snapshot ─ pull ─ coalesce ─ merge(LWW) ─ equality-guard ─ push ─ atomic swap
```

- **Canonical store** holds only the last-acked server state, kept pure so a
  failed sync needs no rollback.
- **Outbox** is an append-only ledger of intent (`INSERT`/`UPDATE`/`DELETE`).
- **Read view** = canonical row + pending outbox ops, stitched on the fly with
  derived `$sync` flags. Internal causal `$meta` never reaches the UI.
- **Sync** runs entirely inside an in-memory snapshot; on success it commits to
  storage in one transaction so the UI re-renders exactly once. On any failure
  the snapshot is dropped and storage is untouched.
- **Server** (`createSyncServer`) runs the SAME field-level merge over a
  `ServerDocumentStore`, validates every pushed document before merging, and
  derives pull cursors from returned rows (never from the counter), so
  concurrent pushes can't skip changes or poison a scope.

## Conflict model

Field-level last-write-wins driven by **Hybrid Logical Clocks**, not raw wall
clocks — so a wrong device clock can't poison the global state.

- **Per-field HLC** → non-overlapping edits from different devices all survive;
  only true same-field collisions are decided by the clock.
- **Atomic groups** → coupled fields (e.g. `roomNumber` + `price`) resolve as
  one unit, preventing semantically-broken merges.
- **Tombstones** → deletions (scalar fields and array elements) carry their own
  stamp, so an older remote write can't resurrect dead data.
- **Conflict preservation** → a genuinely concurrent LWW loser is kept in
  `$meta.conflicts` (surface via `getConflicts`/`hasConflicts`) instead of
  silently vanishing, and is garbage-collected once a later write resolves it.

The merge is commutative, associative, and idempotent (a CRDT: LWW-register per
scalar field, LWW-element-set per array field) → devices converge regardless of
reconnect order.

## Push resolution + errors

Push handlers resolve each change via `ctx.ack` / `ctx.retry` / `ctx.discard`:

- **ack** — op purged, merged state committed.
- **retry** — op kept; its `retryCount` is bumped and the error is stamped on
  the op, so reads surface `$syncStatus: "error"` + `$lastError`. A collection
  `maxRetries` bounds this: past the budget the row gives up (ops dropped,
  server truth wins).
- **discard** — permanent rejection; op dropped, row reverts to server truth.
- **unreported** — kept defensively (never assume silent success); consumes no
  retry budget.

## Status

Shipped & green (TDD): ids, hlc, stitch, coalesce, merge (+ conflict
preservation), apply, snapshot sync engine (+ error surfacing/retry budget),
memory + IndexedDB adapters (causal HLC op ordering), `createSynqStorage`
(+ singletons), live queries, react hooks, leader election, wire protocol +
validators, sync server (+ reference memory store).

Open (contracts pinned as `it.todo` where applicable): schema-driven storage
indexes, pull pagination, HLC drift clamping.

## Run

```bash
pnpm --filter @repo/synq test
```
