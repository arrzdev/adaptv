import type {
  StorageAdapter,
  StorageTx,
} from "#synq/adapters/adapter.types"
import { applyOps } from "#synq/core/apply"
import { coalesce } from "#synq/core/coalesce"
import {
  documentsEqual,
  isDeleted,
  mergeDocuments,
} from "#synq/core/merge"
import { createTxContext } from "#synq/core/tx-context"
import type {
  Change,
  ChangeType,
  PullHandler,
  PushItem,
  PushTransport,
  TxContext,
} from "#synq/types/collection.types"
import type { SyncOutcome } from "#synq/types/query.types"
import type { AtomicGroups } from "#synq/types/schema.types"
import type {
  DocMeta,
  Hlc,
  OutboxEntry,
  StoredDocument,
  SyncError,
} from "#synq/types/synq.types"
import { CAUSAL_FIELD, ID_FIELD } from "#synq/types/synq.types"

//---- The snapshot sync engine -------------------------------------
//one collection reconciliation. everything runs against an in-memory
//snapshot of the last-synced canonical state + outbox; only on success
//is it committed in a single atomic swap, so a thrown pull/push leaves
//storage exactly as it was. pull happens before push so conflicts are
//resolved locally (field-level LWW) before anything is sent.
//
//invariant after a run: canonical = latest server truth (pulled rows +
//acked pushes); outbox = only the deltas the server hasn't accepted yet.

// biome-ignore lint/suspicious/noExplicitAny: the engine is row-shape agnostic
type AnyDoc = StoredDocument<any>
type AnyRow = Record<string, unknown>

export interface SyncCollection {
  readonly name: string
  //where the pull cursor is persisted. defaults to name; namespacing it by
  //an opaque scope (e.g. "todos::<userId>") means a different scope starts
  //from no cursor — a full pull — instead of trusting a cursor that belongs
  //to a different row-set. auth itself stays in the developer's pull/push.
  readonly cursorKey?: string
  readonly atomicGroups?: AtomicGroups
  //retry budget per row: after this many `ctx.retry` cycles the row's ops
  //are dropped and it reverts to server truth (counted as discarded).
  //undefined = retry forever. unreported ops never consume budget.
  readonly maxRetries?: number
  // biome-ignore lint/suspicious/noExplicitAny: transport is row-shape agnostic here
  readonly pull?: PullHandler<any>
  //either the split handlers or the unified push(changes) — both accepted
  // biome-ignore lint/suspicious/noExplicitAny: transport is row-shape agnostic here
  readonly push?: PushTransport<any>
  //called with every causal stamp seen on a pulled row so the caller's
  //clock can advance past the network (keeps local stamps monotonic)
  readonly observeHlc?: (hlc: Hlc) => void
  //invoked INSIDE the commit transaction so the caller can persist its
  //clock atomically with the pulled rows — a crash right after the swap
  //can then never resume from a clock older than the stamps it merged
  readonly persistClock?: (tx: StorageTx) => void
}

type RowPlan = {
  //the row's settled state, or null when it should be deleted locally
  canonicalNext: AnyDoc | null
  //whether to drop this row's outbox ops
  purgeOps: boolean
  //rewritten ops for a retried row: retryCount bumped + the transport's
  //error stamped so the read layer can surface $syncStatus: "error"
  updateOps?: OutboxEntry[]
}

export async function syncCollection(
  storage: StorageAdapter,
  col: SyncCollection,
): Promise<SyncOutcome> {
  const empty: SyncOutcome = {
    collection: col.name,
    pulled: 0,
    pushed: 0,
    acked: 0,
    retried: 0,
    discarded: 0,
    skipped: 0,
  }

  const ops = await storage.getOps(col.name)
  const canonicalRows = await storage.getAll<unknown>(col.name)
  const canonicalById = new Map<string, AnyDoc>(
    canonicalRows.map((row) => [row[ID_FIELD], row]),
  )

  //one compacted op per row; index by row for reconcile + ack mapping
  const coalesced = coalesce(ops)
  const coalescedByRow = new Map<string, OutboxEntry>(
    coalesced.map((op) => [op.rowId, op]),
  )
  const opsByRow = new Map<string, OutboxEntry[]>()
  for (const op of ops) {
    const list = opsByRow.get(op.rowId)
    if (list) list.push(op)
    else opsByRow.set(op.rowId, [op])
  }

  //---- Ingress pull (abort the whole run if it throws) ----
  const cursorKey = col.cursorKey ?? col.name
  const remoteById = new Map<string, AnyDoc>()
  let nextCursor: unknown
  let didPull = false
  if (col.pull) {
    const cursor = await storage.getCursor(cursorKey)
    const res = await col.pull(cursor)
    didPull = true
    nextCursor = res.nextCursor
    for (const doc of res.changes) {
      remoteById.set(doc[ID_FIELD], doc)
      if (col.observeHlc) {
        const meta = doc[CAUSAL_FIELD] as DocMeta
        for (const hlc of Object.values(meta.fields)) col.observeHlc(hlc)
        for (const hlc of Object.values(meta.tombstones))
          col.observeHlc(hlc)
        if (meta.deletedAt) col.observeHlc(meta.deletedAt)
      }
    }
  }

  //---- Reconcile (field-level LWW merge in the snapshot) ----
  const rowIds = new Set<string>([
    ...coalescedByRow.keys(),
    ...remoteById.keys(),
    //include rows whose ops coalesced to nothing (offline insert→delete
    //ghosts) so their orphan outbox entries still get purged this cycle
    ...opsByRow.keys(),
  ])
  const mergedById = new Map<string, AnyDoc>()
  //every pushable row as one normalised, type-tagged change (delta+snapshot)
  const changes: Change<AnyRow>[] = []
  const localOnlyCommit = new Set<string>()

  for (const id of rowIds) {
    const canonical = canonicalById.get(id)
    const remote = remoteById.get(id)
    const cop = coalescedByRow.get(id)

    const localCurrent = cop ? applyOps(canonical, [cop]) : canonical
    let merged: AnyDoc | undefined
    if (remote && localCurrent) {
      //`canonical` is the last-synced common ancestor: with it the merge can
      //tell a genuine concurrent edit (both diverged from base) from a normal
      //sequential one, and preserve the LWW loser instead of dropping it
      merged = mergeDocuments(localCurrent, remote, {
        atomicGroups: col.atomicGroups,
        base: canonical,
      })
    } else {
      merged = remote ?? localCurrent
    }
    if (!merged) continue
    mergedById.set(id, merged)

    if (!cop) continue //remote-only row: silent write handled at commit

    if (!col.push) {
      //local-only collection: self-commit the optimistic state
      localOnlyCommit.add(id)
      continue
    }

    //skip the push when the server already holds this exact state
    const settledByServer =
      remote &&
      documentsEqual(merged, remote) &&
      isDeleted(merged) === isDeleted(remote)
    if (settledByServer) {
      localOnlyCommit.add(id) //purge ops, keep merged (== remote)
      continue
    }

    const existed = !!remote || !!canonical
    const type: ChangeType = isDeleted(merged)
      ? "delete"
      : existed
        ? "update"
        : "insert"
    //delta = exactly what this change touched; the merged doc is the snapshot
    const delta = (type === "delete" ? {} : (cop.payload ?? {})) as AnyRow
    changes.push({ opId: cop.id, id, type, delta, doc: merged })
  }

  //---- Egress push (a throw aborts: snapshot discarded, nothing swapped) ----
  const { ctx, tracker } = createTxContext()
  let pushed = 0
  if (col.push && changes.length) {
    pushed = changes.length
    await dispatchPush(col.push as PushTransport<AnyRow>, changes, ctx)
  }

  //---- Resolve each row into a concrete plan ----
  const stampedAt = Date.now()
  const plans = new Map<string, RowPlan>()
  let acked = 0
  let retried = 0
  let discarded = 0
  let skipped = 0

  for (const id of rowIds) {
    const merged = mergedById.get(id)
    const remote = remoteById.get(id)
    const canonical = canonicalById.get(id)
    const cop = coalescedByRow.get(id)

    if (!cop) {
      if (merged) {
        //remote-only silent write
        plans.set(id, { canonicalNext: merged, purgeOps: false })
      } else if (opsByRow.has(id)) {
        //voided ghost (insert→delete offline): no merged state, but its
        //orphan ops must still be purged so the outbox can't leak
        plans.set(id, { canonicalNext: null, purgeOps: true })
      }
      continue
    }

    if (localOnlyCommit.has(id)) {
      if (col.push) skipped++
      plans.set(id, { canonicalNext: merged ?? null, purgeOps: true })
      continue
    }

    //pushed row — honor the developer's ack/retry/discard
    const opId = cop.id
    if (tracker.discarded.has(opId)) {
      discarded++
      //revert to server/last-synced truth, drop the rejected op
      plans.set(id, {
        canonicalNext: remote ?? canonical ?? null,
        purgeOps: true,
      })
    } else if (tracker.acked.has(opId)) {
      acked++
      plans.set(id, { canonicalNext: merged ?? null, purgeOps: true })
    } else if (tracker.retried.has(opId)) {
      //a reported transient failure consumes retry budget; past the budget
      //the row gives up like a discard (ops dropped, server truth wins)
      const nextRetryCount = cop.retryCount + 1
      if (
        col.maxRetries !== undefined &&
        nextRetryCount > col.maxRetries
      ) {
        discarded++
        plans.set(id, {
          canonicalNext: remote ?? canonical ?? null,
          purgeOps: true,
        })
        continue
      }
      retried++
      const transportError = tracker.retried.get(opId)
      const error: SyncError | undefined = transportError
        ? { ...transportError, timestamp: stampedAt }
        : undefined
      const rawOps = opsByRow.get(id) ?? []
      plans.set(id, {
        canonicalNext: remote ?? canonical ?? null,
        purgeOps: false,
        updateOps: rawOps.map((raw) => ({
          ...raw,
          retryCount: raw.retryCount + 1,
          ...(error ? { error } : {}),
        })),
      })
    } else {
      //unreported — keep the op defensively (never assume silent success);
      //no budget consumed and no error stamped: the transport said nothing
      retried++
      plans.set(id, {
        canonicalNext: remote ?? canonical ?? null,
        purgeOps: false,
      })
    }
  }

  //---- Atomic swap ----
  const putRows: AnyDoc[] = []
  const deleteRowIds: string[] = []
  const purgeOpIds: string[] = []
  const rewriteOps: OutboxEntry[] = []
  for (const [id, plan] of plans) {
    if (plan.purgeOps) {
      for (const op of opsByRow.get(id) ?? []) purgeOpIds.push(op.id)
    }
    if (plan.updateOps) rewriteOps.push(...plan.updateOps)
    const next = plan.canonicalNext
    if (next && !isDeleted(next)) putRows.push(next)
    else deleteRowIds.push(id)
  }

  await storage.transact((tx) => {
    if (putRows.length) tx.putRows(col.name, putRows)
    if (deleteRowIds.length) tx.deleteRows(col.name, deleteRowIds)
    if (purgeOpIds.length) tx.deleteOps(purgeOpIds)
    if (rewriteOps.length) tx.putOps(rewriteOps)
    if (didPull) tx.setCursor(cursorKey, nextCursor)
    col.persistClock?.(tx)
  })

  return {
    ...empty,
    pulled: remoteById.size,
    pushed,
    acked,
    retried,
    discarded,
    skipped,
  }
}

//normalise either transport form onto a single call. the unified push gets
//the whole type-tagged Change[]; the split handlers get one batch per kind.
async function dispatchPush(
  push: PushTransport<AnyRow>,
  changes: Change<AnyRow>[],
  ctx: TxContext,
): Promise<void> {
  if (typeof push === "function") {
    await push(changes, ctx)
    return
  }
  const inserts: PushItem<AnyRow>[] = []
  const updates: PushItem<AnyRow>[] = []
  const deletes: PushItem<AnyRow>[] = []
  for (const c of changes) {
    const item: PushItem<AnyRow> = { opId: c.opId, id: c.id, doc: c.doc }
    if (c.type === "insert") inserts.push(item)
    else if (c.type === "update") updates.push(item)
    else deletes.push(item)
  }
  if (inserts.length) await push.inserts(inserts, ctx)
  if (updates.length) await push.updates(updates, ctx)
  if (deletes.length) await push.deletes(deletes, ctx)
}
