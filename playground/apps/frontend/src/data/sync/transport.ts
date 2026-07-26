import type { SyncPullResponse } from "@repo/synq/protocol"
import type { Change, TxContext } from "@repo/synq/types"
import { api } from "@/data/backend-client"
import { currentSyncSignal } from "@/data/sync/abort-signal"

//---- Backend sync transport ---------------------------------------
//the pull/push pair that wires a synq collection to the shared backend's
//generic sync endpoints (POST /api/v1/sync/:collection/{pull,push}). every
//synced collection (todos, decks, …) reuses this — only the collection name
//differs. sync is USER-SCOPED: the typed RPC client auto-attaches the signed-in
//user's bearer token (server scopes the data by it), and the controller only
//runs sync at all when authenticated (guests stay fully local).

export function backendTransport<TRow extends Record<string, unknown>>(
  collection: string,
) {
  async function pull(cursor: unknown) {
    const since = typeof cursor === "number" ? cursor : 0
    const res = await api.api.v1.sync[":collection"].pull.$post(
      {
        param: { collection },
        json: { since },
      },
      //abort with the run so a timed-out/superseded sync cancels its fetch
      { init: { signal: currentSyncSignal() } },
    )
    if (!res.ok) throw new Error(`sync pull failed: ${res.status}`)
    const body = await res.json()
    if (body.status !== "success") {
      throw new Error("sync pull failed: error envelope")
    }
    //why: the pull route returns its payload as an opaque JSONValue (synq
    //StoredDocuments don't satisfy the index-signature constraint though they
    //serialize fine), so we re-type `data` from the shared synq wire protocol
    const data = body.data as unknown as SyncPullResponse<TRow>
    return { changes: data.changes, nextCursor: data.nextCursor }
  }

  //unified push: each change carries the merged snapshot (doc); this backend
  //converges server-side on the full document, so we send snapshots and
  //resolve each change by its opId.
  async function push(changes: Change<TRow>[], ctx: TxContext) {
    const res = await api.api.v1.sync[":collection"].push.$post(
      {
        param: { collection },
        json: {
          items: changes.map((change) => ({
            id: change.id,
            doc: change.doc,
          })),
        },
      },
      //abort with the run so a timed-out/superseded sync cancels its fetch
      { init: { signal: currentSyncSignal() } },
    )
    if (!res.ok) {
      //transient failure — keep the ops, retry next cycle
      const error = {
        message: `sync push failed: ${res.status}`,
        code: String(res.status),
      }
      for (const change of changes) ctx.retry(change.opId, error)
      return
    }
    const body = await res.json()
    if (body.status !== "success") {
      //2xx but an error envelope — treat as transient, keep + retry the ops
      const error = {
        message: "sync push failed: error envelope",
        code: "envelope",
      }
      for (const change of changes) ctx.retry(change.opId, error)
      return
    }
    for (const change of changes) {
      const result = body.data.results[change.id]
      if (result === "ok") {
        ctx.ack(change.opId)
      } else if (result === "invalid") {
        //structural rejection — retrying the same payload can never succeed,
        //so drop the op and let the row revert to server truth
        ctx.discard(change.opId, {
          message: "document failed server validation",
          code: "invalid",
        })
      } else {
        ctx.retry(change.opId, {
          message: "not acknowledged",
          code: "no_ack",
        })
      }
    }
  }

  return { pull, push }
}
