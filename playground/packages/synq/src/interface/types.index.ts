//@repo/synq/types — the shared type surface: document/outbox shapes, the
//collection config + transport contracts, query types, and the
//StorageAdapter contract for custom storage backends. type-only except
//for the reserved-key constants and the singletonCollection helper.

export type {
  StorageAdapter,
  StorageTx,
} from "../adapters/adapter.types"
export type {
  Change,
  ChangeType,
  CollectionConfig,
  PullHandler,
  PushHandlers,
  PushItem,
  PushTransport,
  SingletonConfig,
  TxContext,
  TxError,
  UnifiedPush,
} from "../types/collection.types"
export { singletonCollection } from "../types/collection.types"
export type {
  CollectionHandle,
  QueryOptions,
  SingletonHandle,
  SyncOutcome,
  SynqDb,
} from "../types/query.types"
export type {
  AtomicGroup,
  AtomicGroups,
  CollectionSchema,
} from "../types/schema.types"
export type {
  DocMeta,
  FieldConflict,
  Hlc,
  LocalDocument,
  OutboxEntry,
  OutboxOpType,
  RuntimeMeta,
  StoredDocument,
  SyncCursor,
  SyncError,
  SyncStatus,
} from "../types/synq.types"
export {
  CAUSAL_FIELD,
  ID_FIELD,
  SYNC_FIELD,
} from "../types/synq.types"
