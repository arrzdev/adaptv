import { Logger } from "@repo/shared/logging"
import tryCatch from "@repo/shared/try-catch"
import { store } from "@/data/store"
import { setSyncSignal } from "@/data/sync/abort-signal"

const log = new Logger("sync")

//---- Sync controller ----------------------------------------------
//drives WHEN the app syncs and exposes a calm status for the header. the two
//key ideas: `dirty` = there are local changes not yet confirmed upstream, and
//the indicator only ever rests at "nothing showing" when we're truly caught up.
//  • synced   — at rest, nothing queued (or offline with nothing to push)
//  • pending  — a local change just landed; lights up instantly during the
//               debounce so the user sees feedback before the run fires
//  • syncing… — a run is actually in flight
//  • offline  — no network AND we have queued changes → a small "Offline (n)"
//               text label (n = unsynced count); we don't attempt a sync, we
//               just wait for reconnect
//  • error    — online but the last run failed (backend unreachable) and we
//               still have queued changes → an "Unsynced (n)" text label; we
//               retry on a timer (capped) and only clear `dirty` on a real
//               success, so the indicator never lies
//
//the indicator treats pending + syncing as one continuous "active" run shown as
//waves; offline + error are quiet muted text labels (above):
//  local change → pending → syncing → done, or → offline/error until we can.
//triggers: a local change (debounced 2s), sign-in/startup, offline → online,
//and returning to the app/tab (visibility/focus). NO periodic polling.
//
//ONE REQUEST PER SYNCED COLLECTION (not a bug): `store.sync()` runs each synced
//collection (todos, decks) through its OWN pull/push round-trip against the
//per-collection backend routes (synq's `syncAll`). so a clean cycle makes N
//pulls for N collections, and a cycle with a single dirty collection reads on
//the wire as pull;push;pull — that's N independent collection syncs, NOT the
//same sync running twice. collapsing it to one request would need a batched
//backend endpoint + batched engine path; deliberately not done — per-collection
//cursors keep the model simple and each collection converges on its own.

export type SyncPhase =
  | "synced"
  | "pending"
  | "syncing"
  | "offline"
  | "error"
export type SyncState = {
  readonly phase: SyncPhase
  //local changes not yet synced upstream — shown as "offline (n)"
  readonly unsynced: number
}

//coalesce a burst of local changes into a single run after this much quiet
const DEBOUNCE_MS = 2000
//failed syncs retry on a FIXED 1-min timer (not exponential), at most
//MAX_RETRIES times, then we give up the timer and wait for activity (focus /
//reconnect / a new edit) to re-attempt — so a dead backend isn't polled forever
const RETRY_INTERVAL_MS = 60_000
const MAX_RETRIES = 3
//cap a single run: a suspended machine or a dropped network can leave the
//underlying fetch hung forever (it never resolves or rejects), which would
//otherwise pin the indicator in "syncing" for good. a timed-out run counts as
//a failure → we flip to the "Unsynced" state and retry on the timer.
const SYNC_TIMEOUT_MS = 15000

let enabled = false //sync runs ONLY while signed in; guests stay fully local
let running = false //a sync promise is in flight (concurrency guard)
let syncing = false //a run is actually in flight
let silentRun = false //the in-flight run is hidden (the first/startup sync)
let pending = false //a local change is waiting out the debounce
let dirty = false //local changes exist that haven't synced successfully yet
let failed = false //the last completed run failed (backend unreachable)
let unsynced = 0 //live count of unsynced rows, for the "offline (n)" label
let retryCount = 0 //consecutive failed runs; caps the retry timer
let rerunQueued = false //an edit landed mid-run — flush it once the run finishes
let epoch = 0 //bumped on enable/disable so a stale run's continuation can bail

let debounceTimer: ReturnType<typeof setTimeout> | undefined
let retryTimer: ReturnType<typeof setTimeout> | undefined

let snapshot: SyncState = { phase: "synced", unsynced: 0 }
const listeners = new Set<() => void>()

function isOnline(): boolean {
  return typeof navigator === "undefined" || navigator.onLine !== false
}

function phaseOf(): SyncPhase {
  //offline WINS: with no network we never report syncing/pending, so the
  //indicator never STARTS waving while offline — it shows "offline (n)" at once
  //(or nothing if we owe no push). the CANVAS still smooths any waves already on
  //screen: it holds them their minimum before resolving, so a run that flips
  //offline mid-flight resolves to the label without flickering (MIN_WAVE_MS).
  if (!isOnline()) return dirty ? "offline" : "synced"
  //a visible run reads as syncing (a SILENT startup run stays hidden)
  if (syncing && !silentRun) return "syncing"
  //online but the last attempt failed and we still owe a push → "error (n)"
  if (failed && dirty) return "error"
  //a queued local change, still waiting out the debounce
  if (pending) return "pending"
  return "synced"
}

//swap the snapshot only when phase or the unsynced count actually changes, so
//the useSyncExternalStore consumer keeps a stable reference between updates
function publish(): void {
  const phase = phaseOf()
  if (snapshot.phase === phase && snapshot.unsynced === unsynced) return
  snapshot = { phase, unsynced }
  for (const cb of listeners) cb()
}

export function getSyncState(): SyncState {
  return snapshot
}

export function subscribeSync(cb: () => void): () => void {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

function scheduleRetry(): void {
  if (retryTimer) clearTimeout(retryTimer)
  retryTimer = setTimeout(() => {
    void runSync()
  }, RETRY_INTERVAL_MS)
}

//`silent` runs the sync without the syncing indicator (the first/startup sync —
//it should be invisible unless it fails). all other triggers are visible.
export async function runSync(silent = false): Promise<void> {
  //guests never sync — the controller is inert until sign-in enables it
  if (!enabled) return
  pending = false
  //offline: never attempt — the `online` event reconnects + retries
  if (!isOnline()) {
    publish()
    return
  }
  if (running) {
    //an edit landed while a run is in flight: that run already snapshotted the
    //outbox before this change, so remember to fire one follow-up run when it
    //finishes (otherwise the change sits unsynced while we falsely show "synced")
    rerunQueued = true
    return
  }
  running = true
  syncing = true
  silentRun = silent
  rerunQueued = false
  const runEpoch = epoch
  publish() //phase → syncing (hidden while silentRun)

  //abort a hung run rather than merely racing a timeout: a suspended machine or
  //dropped network can leave the underlying fetch pending forever. aborting
  //cancels the in-flight request (the transport threads this signal), so the run
  //rejects promptly AND leaves no zombie fetch that could later commit stale
  //state or rewind the pull cursor behind a newer run.
  const controller = new AbortController()
  setSyncSignal(controller.signal)
  const timeout = setTimeout(() => {
    controller.abort(new DOMException("sync timed out", "TimeoutError"))
  }, SYNC_TIMEOUT_MS)
  const [, syncError] = await tryCatch(() => store.sync())
  clearTimeout(timeout)
  setSyncSignal(undefined)

  //a sign-out / sign-in happened while this run was in flight: its state was
  //already cleared or reset, so this stale continuation must not touch it — no
  //re-arming the retry timer into the next session, no lying publish.
  if (runEpoch !== epoch) {
    running = false
    return
  }

  running = false
  syncing = false
  silentRun = false
  const didFail = syncError !== null
  failed = didFail
  if (didFail) {
    //surface the failure so a persistently-unreachable backend is diagnosable
    //from the device (forwarded to the dev log sink) rather than swallowed
    log.warn("sync run failed", syncError)
    //retry on the fixed timer, but only up to MAX_RETRIES consecutive failures —
    //after that we give up the timer and wait for activity (focus / reconnect /
    //a new edit) to try again, so a dead backend isn't polled forever
    retryCount++
    if (retryCount <= MAX_RETRIES) scheduleRetry()
  } else if (!rerunQueued) {
    //caught up ONLY if no edit landed mid-run; otherwise dirty stays set until
    //the follow-up run below confirms that newer change upstream
    dirty = false
    retryCount = 0
  }
  publish() //→ synced / error / offline (the indicator owns its own min time)
  void refreshUnsynced() //success drains the outbox → count back to 0

  //flush an edit that arrived during the run (it hit the `running` guard). only
  //on success — a failure already re-attempts via the retry timer / activity.
  if (rerunQueued && !didFail) {
    rerunQueued = false
    void runSync()
  }
}

//a local change: mark dirty + pending and publish right away so the indicator
//lights up instantly, then debounce a run. inert for guests — their writes
//still land in synq's outbox locally and adopt on the next sign-in. private
//on purpose: mutations never call this — synq's onLocalChange (wired below)
//is the single trigger, so a new mutation module can't forget to sync.
function scheduleSync(): void {
  if (!enabled) return
  dirty = true
  pending = true
  publish()
  void refreshUnsynced() //keep the offline label's count current
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => {
    void runSync()
  }, DEBOUNCE_MS)
}

//set when an EXISTING-account sign-in should discard local guest data and pull
//the account's clean state. set before the session lands; the auth provider
//consumes it (wipes local, then enables sync). a fresh sign-up leaves it unset
//so the guest data adopts instead.
let resetRequested = false

export function requestSyncReset(): void {
  resetRequested = true
}

export function consumeSyncReset(): boolean {
  const requested = resetRequested
  resetRequested = false
  return requested
}

//count local rows that haven't synced upstream yet (synced collections only).
//used to warn before a sign-out wipes the local store.
export async function pendingChangeCount(): Promise<number> {
  const [todos, decks] = await Promise.all([
    store.todos.pendingCount(),
    store.decks.pendingCount(),
  ])
  return todos + decks
}

//re-read the unsynced count and republish if it moved — feeds the "offline (n)"
//label. fire-and-forget from the sync lifecycle (mutation, run, enable, offline)
async function refreshUnsynced(): Promise<void> {
  const next = await pendingChangeCount()
  if (next === unsynced) return
  unsynced = next
  publish()
}

//flip sync on at sign-in / off at sign-out. enabling kicks off an immediate but
//SILENT first run (no syncing indicator unless it fails) that also pushes any
//guest data up under the new account.
export function setSyncEnabled(next: boolean): void {
  if (next === enabled) return
  enabled = next
  //invalidate any run currently in flight: its continuation checks this and
  //bails, so it can't re-arm timers or publish into the new session's state
  epoch++
  if (enabled) {
    failed = false
    dirty = true //assume local data may need pushing; a clean run clears it
    retryCount = 0
    publish()
    void refreshUnsynced() //seed the count (guest data waiting to adopt)
    void runSync(true) //silent startup sync
    return
  }
  //signed out: stop everything and clear the indicator
  if (debounceTimer) clearTimeout(debounceTimer)
  if (retryTimer) clearTimeout(retryTimer)
  debounceTimer = undefined
  retryTimer = undefined
  running = false
  syncing = false
  pending = false
  dirty = false
  failed = false
  unsynced = 0
  retryCount = 0
  publish()
}

//every local-origin write to a SYNCED collection schedules a debounced run —
//no mutation module has to remember to call scheduleSync (synq's onLocalChange
//never fires from a pull, so this can't loop). preferences is local-only and
//deliberately unwired: it has nothing to push.
store.todos.onLocalChange(scheduleSync)
store.decks.onLocalChange(scheduleSync)

if (typeof window !== "undefined") {
  //reconnect retries, but only while sync is enabled (guarded inside runSync).
  //network is back → give it a fresh retry budget so the retry cap re-arms
  window.addEventListener("online", () => {
    retryCount = 0
    publish()
    void runSync()
  })
  window.addEventListener("offline", () => {
    void refreshUnsynced() //make sure the offline label's count is fresh
    publish()
  })
  //returning to the app/tab syncs immediately (and re-arms the periodic). a
  //run already in flight is a no-op, so the two events can't double-sync.
  window.addEventListener("focus", () => {
    void runSync()
  })
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void runSync()
  })
}
