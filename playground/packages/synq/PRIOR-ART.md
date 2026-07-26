# @repo/synq — prior-art synthesis

Cross-analysis of five production local-first/sync systems, each mined for architecture +
issues/PRs and mapped onto synq's 12 decisions (see `SPEC.md`). Deep per-library reports
were produced by parallel analysis agents; this is the consolidated, decision-oriented digest.

Libraries: **RxDB** (pubkey/rxdb), **PouchDB** (apache/pouchdb), **ElectricSQL**
(electric-sql/electric), **PowerSync** (powersync-ja), **Jazz** (garden-co/jazz).

---

## The thesis: convergence validates the scope

- **ElectricSQL** was founded by CRDT researchers, shipped an ambitious bidirectional
  local-first CRDT stack ("Satellite" + SQLite + Rich-CRDTs), and **deleted the entire
  write path + CRDT engine** in July 2024, retreating to read-only sync because preserving
  database invariants (referential integrity, uniqueness, counters, ordered lists) required
  Rich-CRDT machinery (composition / compensations / escrow) "too complex to make
  bulletproof in production." (electric-next blog, 2024-07-17)
- **Jazz** rewrote from scratch (2.0, alpha): dropped op-based CoValue CRDTs and
  group-based e2e encryption, and **independently arrived at ~9 of our 12 decisions** —
  row-versions = HLC-stamped deltas, field-level LWW + opt-in per-column merge strategy,
  index-first reads, local-only loading, leader-elected multi-tab, schema-hash migrations.
- **PowerSync** & **RxDB** sit between, both with a **field-level LWW core** (PowerSync:
  "the last update to each individual field wins"; RxDB: doc-level, which it admits is worse).
- **PouchDB** (10+ yrs) is the cautionary baseline: whole-doc conflicts, tombstones-forever,
  rev-tree bloat, silent full-scans — the exact footguns our decisions reject.

**Net:** scoping down — field-LWW, no counters, index-only reads, server-authoritative
purge, snapshot-on-the-wire (not op-logs), transport-agnostic — is the winning move, and
each of those is independently confirmed below. The risk is entirely in the **invariant /
nested-data / lifecycle long tail**, which is what the gap list addresses.

---

## Validations (our decision → who confirms → evidence)

| Decision | Verdict | Evidence |
|---|---|---|
| #1 transport-agnostic | ✅ confirmed | RxDB's pluggable pull/push validates it; PouchDB/Electric/PowerSync all pay for protocol lock-in (a decade of Cloudant/Sync-Gateway interop pain, PouchDB #1666/#802). |
| #1 delta **+** snapshot | ✅ refined | PouchDB's `new_edits:false` whole-doc write is *why* its replicas converge — keep the **snapshot as convergence-of-record**, delta for bandwidth + field merge. Electric ships field-deltas by default (`replica=default`). |
| #2 index-only reads | ✅ strongly | PouchDB Mango (#6399) + RxDB slow-mode + Electric "non-optimized where clauses → throughput collapses (10 shapes 1400/s, 100 shapes 140/s)" + classic-Jazz "no query language" scale wall. Silent full-scan is a universal footgun; our hard-error is correct. |
| #3 field-LWW + value resolver | ✅ strongly | Electric retreated to field-granular; PowerSync field-LWW; Jazz 2.0 rewrote *to* it; RxDB doc-level is the inferior version. |
| #3 no counters | ✅ confirmed | Electric (none post-pivot), PowerSync ("not currently supported"), PouchDB ("accountants don't use erasers" immutable-delta recipe). LWW + counters are mutually exclusive without ancestor/op tracking. |
| #4 local-only reactive hook | ✅ confirmed | Jazz 2.0 "the only loading moment" is local-only by design; RxDB's lack of a separate sync-status channel forces users into internals (#6257). |
| #5 full re-run, coalesced | ✅ as MVP | PouchDB & PowerSync both re-run-on-change; RxDB's incremental EventReduce ships correctness bugs (#4755). Patch-diff is the documented *upgrade path*, not v1. |
| #6 memory + IndexedDB | ✅ w/ caveat | Validated, but everyone treats IndexedDB as the slow path (RxDB premium = fast IDB; PowerSync/Jazz prefer OPFS for *synchronous* storage). Design the pipeline for **async** adapters from day one. |
| #7 server-authoritative purge | ✅ right call | Avoids PowerSync's op-log compaction/defrag trap and PouchDB's rev-tree bloat (#4372/#802, the most-demanded feature ever). RxDB cleanup defaults (`minimumDeletedTime`, `awaitReplicationsInSync`) are concrete numbers to copy. |
| #8 versioned migrations | ✅ ahead | Electric/PowerSync have *no* client migration story (silent CAST corruption). Jazz 2.0's bidirectional lenses + hash-partitioned branches are the mature endgame to design toward. |
| #9 leader-elected sync | ✅ confirmed | PowerSync SharedWorker, Jazz leader tab, RxDB leader-election all do it; PouchDB's lack of it is a chronic open wound (#8209/#8494). |
| #11 child-collection + element identity | ✅ ahead of all | Every library punts on arrays (opaque JSON, whole-value replace). Ours is the most advanced — meaning least prior art, most risk to own. |

---

## Gaps to close (the valuable part)

Each item: what / who surfaced it / the fix. `[FOLD-IN]` = clear improvement, no tradeoff.
`[FORK]` = a real decision for the human.

### Conflict / merge correctness
1. `[FOLD-IN]` **HLC tie-break determinism.** Equal HLCs on different nodes must resolve
   identically everywhere or replicas diverge. *PouchDB* uses a hash tiebreak. → final
   order = `HLC` then stable `deviceId`. (#3, #12)
2. `[FOLD-IN]` **Resolvers must be pure + commutative + associative**, or two clients
   merging the same pair in different orders diverge permanently. *PouchDB*'s deterministic
   winner exists precisely to prevent this. → constrain + document loudly, and run
   resolution on the **leader/server**, not per-tab. (#3)
3. `[FOLD-IN]` **Additive field merge / unknown-field HLC preservation.** A v1 client that
   pulls a v2 doc (decision #8) must preserve unknown fields *with their original HLC* and
   never whole-doc-replace on its next push, or old clients silently clobber newer fields.
   *Electric/PowerSync/Jazz/PouchDB* all flag this. (#3 × #8)
4. `[FOLD-IN]` **OR-set is a real CRDT — separate code path from scalar LWW.** *PouchDB*
   caught our latent inconsistency: we ban counters (uncomputable under LWW) but decision
   #11's OR-set needs add/remove-wins + element causality, which LWW alone can't express.
   Must be its own merge path or it silently degrades to LWW and loses concurrent adds. (#11)
5. `[FORK]` **Delete vs concurrent field-update precedence.** A row delete is a *row-level*
   fact, not a field, so field-LWW can't arbitrate it. *PowerSync* ("delete wins
   permanently, future updates ignored"), *PouchDB* ("not-deleted beats deleted"), *Jazz*
   ("deletes win over updates") all chose a deliberate rule. We must pick one. (#3 × #11)

### Lifecycle / durability
6. `[FOLD-IN]` **Persisted per-write record + replayable settlement** (the deepest find).
   *Jazz*'s worst bug: a dropped live ack **strands a durable write forever**; *RxDB*'s
   `assumedMasterState` (per-doc "last-known-server state") is the same idea. We need a
   persisted baseline of last-known-server-state to (a) suppress our own push echoes,
   (b) detect "server changed under me," (c) reconcile pending writes on reconnect/restart
   from a settlement query rather than relying on catching the live response. (#10, #12)
7. `[FOLD-IN]` **Rejection is a persisted, restart-surviving terminal state**, surfaced via
   a global `onMutationError` — not an ephemeral event. *Jazz* `BatchFate::Rejected`. (#10)
8. `[FOLD-IN]` **Quarantine must not head-of-line-block the outbox**, and cap **serialized
   push bytes**, not just doc count. *PowerSync* ("one bad op blocks the whole queue" — a
   documented dead-end); *PouchDB* #9111 (a too-big batch overflows `JSON.stringify` and
   wedges sync forever). (#10)
9. `[FOLD-IN]` **Backoff shape + reconnect:** jittered exponential, ~10-min cap, **reset on
   reconnect**, and **early-retry on the `online` event** (don't sleep the full backoff).
   Dual-checkpoint reconciliation: tolerate one side being restored/rolled-back (*PouchDB*
   keeps last-5-session history; falls back to full resync only when histories don't
   overlap). (#10, #12)
10. `[FOLD-IN]` **Stale-cursor → must-rebuild.** *Electric*'s `must-refetch` and *PouchDB*'s
    GC-quorum problem: `pull` must detect a cursor older than the server's tombstone
    retention and signal "your snapshot is too old, rebuild this collection from scratch,"
    or a long-dormant client resurrects deleted rows. (#7, #12)
11. `[FOLD-IN]` **Three-way push reply:** separate *content* from *durability-ack* from
    *read-completeness*. *Jazz* (`RowBatchCreated` / `BatchFate` / `QuerySettled`). Folding
    ack into the push promise is what caused the stranded-write bug. (#1, #12)
12. `[FOLD-IN]` **Push must be idempotent** (a write can land while the response is lost);
    require an idempotency key per change. *RxDB* requires this. (#1, #10)
13. `[FOLD-IN]` **Atomic apply invariants:** never ack un-persisted pulls, never advance the
    cursor for un-sent rows, drain the checkpoint queue before close/swap. *RxDB*'s patched
    correctness bugs. (#12)

### Multi-tab / platform
14. `[FOLD-IN]` **iOS Safari bfcache + `navigator.locks`.** *RxDB* #7268: Safari freezes a
    tab into bfcache *while it holds the Web Lock* → no live leader → sync silently dies
    until restart. → leader **liveness heartbeat** in shared storage + **visible-tab
    takeover** + **release lock on `pagehide`/`freeze`**, guarded against the double-sync
    write-loop RxDB hit when it tried the naive fix (#6810). (#9)
15. `[FOLD-IN]` **Migration × cursor × multi-tab.** Don't transform the cursor on schema
    change (cursor is version-independent); only the **leader** migrates, others block.
    *RxDB* bugs #3749 (multi-tab migrate breaks) + un-migrated checkpoint. (#8 × #9)

### Tombstone GC
16. `[FOLD-IN]` **Element-tombstone GC.** Decision #7 GCs *row* tombstones; OR-set element
    tombstones (decision #11) are far more numerous (every removed list item) and need the
    same acked-and-pulled-past purge, or an active list bloats — *PouchDB*'s problem at finer
    granularity. (#7 × #11)

### Scope / scale (the structural gap)
17. `[FORK]` **Sync scope / authz axis.** *Electric*, *PowerSync*, *Jazz 2.0* all enforce
    per-user/partition scoping; our "all users → one collection" model has **no axis to
    express "only my rows."** PowerSync's entire roadmap is migrating off "sync everything
    upfront." → make `pull`/`push` carry a **scope/params channel** so partial-sync and
    per-user authz are *additive*, not a protocol break. (#1, #2)
18. `[FORK]` **Multi-object atomicity.** Absent from all 12 decisions. Optimistic field-LWW
    has no "these N writes land together or not at all." *Jazz* added an opt-in
    transaction/batch layer and warns retrofitting is a near-rewrite. → at least reserve a
    **batch-id grouping** in the change envelope now. (#1, #12)
19. `[FOLD-IN]` **Cold-start size.** Whole-collection first sync blocks first paint for
    non-trivial data. *Electric/PowerSync* both built prioritized/partial first-snapshots.
    → for v1 (todo-sized data) accept blocking, but design `pull` to **drain pages** and
    emit a "first usable snapshot" event so streaming-in is additive. (#12)

### Ordered data
20. `[FOLD-IN]` **Fractional rank interleaves; document the limit.** *Jazz* uses **Fugue**
    (insert-after CRDT) to prevent concurrent inserts at the same anchor interleaving
    ("ABC"+"XYZ" → "AXBYCZ"). Fractional rank can interleave. → for v1, document synq
    ordered lists as **reorderable collections, not collaborative sequences**; reserve
    insert-after for a future text/sequence type. (#11)

---

## What everyone got wrong — AVOID (cross-cutting)

- **Op-logs on the wire + compaction/defrag** (*PowerSync*: one unchanged row blocks
  compaction → 100k stale ops → slow cold start, "fixed" by re-writing source rows which
  re-syncs everyone; *Jazz/PouchDB* op-logs never compact cleanly). → keep current-state
  docs + server-authoritative purge.
- **Coarse collection/bucket-level checksums** (*PowerSync*: the writing client nukes and
  re-downloads whole buckets on its own echo, ~33% of uploads in one repro). → per-field
  HLC + per-doc equality-guard degrades gracefully; never add a coarse checksum.
- **"Compaction" that hides but doesn't reclaim** (*PouchDB* #4372/#7100/#802). → purge must
  physically reclaim bytes *and* metadata, with a steady-state-bounded-storage test.
- **Whole-doc conflict granularity** (*PouchDB/RxDB*): different-field edits collide. → field
  merge.
- **Silent full-scan fallback** (*PouchDB/RxDB*). → unindexed query = hard error.
- **Retry a poison doc forever** (*PouchDB/PowerSync/RxDB*: none have client quarantine). →
  our #10.
- **Uncoordinated multi-tab over one store** (*PouchDB* #8209). → leader owns all sync I/O.
- **Group-based e2e encryption / crypto-permission objects** (*Jazz*: its most-beloved
  feature, dropped in 2.0 — "complex and made migration difficult," still unreplaced). →
  explicit non-goal. If authz is ever needed, do server-enforced RLS + permissive-local
  fallback, not crypto.

---

## Noted future options (not v1)

- **Counters as a declarative per-column merge strategy** (*Jazz*: sum of `tip − ancestor`
  deltas) — needs common-ancestor tracking, heavier than pure field-LWW. Consistent with
  our "value-level resolvers / no counters" v1; revisit only if a real use-case demands it.
- **Patch-based granular reactivity** (`{op,id,fields}` diffs preserving object identity for
  unchanged rows — *PowerSync* differential watch, *Jazz* granular reactivity). Design the
  full-recompute diff output in this shape so it's an additive upgrade.
- **Bidirectional migration lenses + hash-partitioned branches** (*Jazz*) — the endgame for
  mixed-version fleets; keep the version field + replay forward-compatible with it.
- **Prioritized / streamed first-snapshot** (*Electric* `must-refetch`+priorities,
  *PowerSync* `waitForFirstSync(priority)`).

---

## Per-library TL;DR

- **RxDB** — closest analog (transport-agnostic pull/push). Gave us `assumedMasterState`,
  cleanup defaults, abort-safety invariants, the iOS bfcache lock bug, push idempotency.
  Doc-level conflicts + no quarantine + fixed-interval retry are its weaknesses we avoid.
- **PouchDB** — the 10-year cautionary tale. Deterministic clock-free winner is the one idea
  to emulate; rev-tree bloat / tombstones-forever / no-purge / silent full-scans / no
  multi-tab coordination are the regrets we design against.
- **ElectricSQL** — the pivot is the lesson: a CRDT-research team deleted bidirectional CRDT
  writes. Validates no-counters, index-only reads, server-authoritative. `must-refetch` and
  the `onError` return-contract (`{}` retry / `{...}` retry-modified / `void` stop) are worth
  copying.
- **PowerSync** — server-authoritative buckets + sync-rules + upload-queue. Strongest push
  for a **scope/authz axis** and against op-logs + coarse checksums + head-of-line-blocking
  queues. Differential watch is worth stealing.
- **Jazz** — rewrote *toward* us. Gave us the three-way push reply, persisted-settlement /
  replayable reconciliation, counter-as-column-strategy, Fugue-vs-fractional-rank, multi-object
  atomicity gap, and the "don't build group e2ee" verdict.
