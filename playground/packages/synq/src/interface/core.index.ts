//@repo/synq/core — the headless client core: the createSynqStorage db
//factory, the snapshot sync engine, the CRDT merge, the HLC clock, the
//schema DSL, and the leader-election coordinator. react-free and
//adapter-agnostic (bring your own StorageAdapter). internal machinery
//(stitch/coalesce/apply/tx-context) is deliberately NOT exported — it can
//change shape without a breaking release.

export type {
  LeaderElection,
  LeaderOptions,
  LeaderTimer,
  Lease,
  LeaseStore,
} from "../coordination/leader"
export {
  createLeaderElection,
  createWebLease,
} from "../coordination/leader"
export type { SynqStorageOptions } from "../core/create-synq"
export { createSynqStorage } from "../core/create-synq"
export type { ClockOptions, HlcClock } from "../core/hlc"
export {
  compareHlc,
  createClock,
  formatHlc,
  maxHlc,
  parseHlc,
} from "../core/hlc"
export { newId } from "../core/ids"
export type { MergeOptions } from "../core/merge"
export {
  documentsEqual,
  getConflicts,
  hasConflicts,
  isDeleted,
  mergeDocuments,
} from "../core/merge"
export { atomic, atomicGroupsOf } from "../core/schema"
export type { SyncCollection } from "../core/sync-engine"
export { syncCollection } from "../core/sync-engine"
export * from "./types.index"
