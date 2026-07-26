//@repo/synq/protocol — the sync wire contract: the pull/push request +
//response shapes shared by client transports and sync servers, plus the
//dependency-free structural validators for documents crossing the wire.

export type {
  SyncPullRequest,
  SyncPullResponse,
  SyncPushItem,
  SyncPushRequest,
  SyncPushResponse,
  SyncPushResultStatus,
} from "../protocol/protocol.types"
export {
  isDocMeta,
  isHlc,
  isStoredDocument,
} from "../protocol/validate"
