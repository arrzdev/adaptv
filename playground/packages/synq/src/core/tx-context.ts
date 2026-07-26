import type { TxContext, TxError } from "#synq/types/collection.types"

//---- Transaction context -------------------------------------------
//the engine hands push handlers a TxContext and stays unopinionated about
//the server's response shape — the developer just calls ack/retry/discard
//per op. the sync engine reads the tracker afterwards and resolves each
//row's plan (see sync-engine.ts): coalescing guarantees one pushed op per
//row, so ack/retry/discard decide the whole row — retry keeps its ops
//(error-stamped, retryCount bumped), discard reverts it to server truth.

export interface TxTracker {
  readonly acked: Set<string>
  readonly retried: Map<string, TxError | undefined>
  readonly discarded: Map<string, TxError | undefined>
}

export function createTxContext(): { ctx: TxContext; tracker: TxTracker } {
  const tracker: TxTracker = {
    acked: new Set(),
    retried: new Map(),
    discarded: new Map(),
  }
  const ctx: TxContext = {
    ack: (opId) => {
      tracker.acked.add(opId)
    },
    retry: (opId, error) => {
      tracker.retried.set(opId, error)
    },
    discard: (opId, error) => {
      tracker.discarded.set(opId, error)
    },
  }
  return { ctx, tracker }
}
