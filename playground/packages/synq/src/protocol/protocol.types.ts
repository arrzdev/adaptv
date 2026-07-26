import type { StoredDocument } from "#synq/types/synq.types"

//---- Sync wire protocol -------------------------------------------
//the one shared definition of what crosses the network between a synq
//client transport and a synq sync server. both sides import these types
//(and the validators in protocol/validate.ts) so the contract cannot
//drift into ad-hoc casts on either edge.
//
//cursor model: a per-(scope, collection) monotonic sequence number. the
//client stores it opaquely and echoes it back; only the server assigns it.

export interface SyncPullRequest {
  //the last seq this client has seen for the collection (0 = never pulled)
  readonly since: number
}

export interface SyncPullResponse<
  TRow extends Record<string, unknown> = Record<string, unknown>,
> {
  //every stored document of the caller's scope that changed after `since`,
  //including tombstones (their $meta carries deletedAt)
  readonly changes: StoredDocument<TRow>[]
  readonly nextCursor: number
}

export interface SyncPushItem<
  TRow extends Record<string, unknown> = Record<string, unknown>,
> {
  //the row's $id, duplicated at the top level for addressing
  readonly id: string
  //the full merged document (data + $id + $meta) — the server runs the
  //same field-level merge, so it needs the causal metadata round-tripped
  readonly doc: StoredDocument<TRow>
}

export interface SyncPushRequest<
  TRow extends Record<string, unknown> = Record<string, unknown>,
> {
  readonly items: SyncPushItem<TRow>[]
}

//per-item outcome, keyed by the item's row id:
//  "ok"      — merged and persisted; the client acks the op
//  "invalid" — the document failed structural validation; the client must
//              discard the op (retrying an invalid payload can never succeed)
export type SyncPushResultStatus = "ok" | "invalid"

export interface SyncPushResponse {
  readonly results: Record<string, SyncPushResultStatus>
}
