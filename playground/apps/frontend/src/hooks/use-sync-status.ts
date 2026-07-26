import { useSyncExternalStore } from "react"
import type { SyncState } from "@/data/sync/controller"
import { getSyncState, subscribeSync } from "@/data/sync/controller"

//reactive view of the sync controller: { phase: synced | pending | syncing |
//offline | error, unsynced }. drives the header's status text.
export function useSyncStatus(): SyncState {
  return useSyncExternalStore(subscribeSync, getSyncState, getSyncState)
}
