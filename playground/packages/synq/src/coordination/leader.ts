//---- Leader election (heartbeat lease) -----------------------------
//picks one tab to own sync so N tabs don't all pull/push. unlike a Web
//Lock, leadership is a TIME-LEASED heartbeat in shared storage: the leader
//renews a {owner, expiresAt} record every heartbeat; if it stops renewing —
//tab closed, OR frozen into bfcache on iOS (the exact case a held Web Lock
//never recovers from, RxDB #7268) — the lease simply expires and an active
//tab takes over. backgrounded tabs don't contest, so a frozen tab that
//later thaws can't wrongly seize leadership; its next tick sees the fresh
//lease and steps down.

export interface Lease {
  readonly owner: string
  readonly expiresAt: number
}

export interface LeaseStore {
  read: () => Lease | null
  //best-effort compare-and-set: install `next` only if the current lease is
  //absent, expired (per `now`), or already ours. returns whether `next` is in
  //force afterwards. (cross-tab atomicity is approximate — the lease/expiry
  //model tolerates a brief double-leader, which is harmless: sync is idempotent.)
  claim: (next: Lease, now: number) => boolean
  //drop the lease iff we still own it (on stop / pagehide)
  release: (owner: string) => void
}

export interface LeaderTimer {
  //setInterval semantics — fire fn every ms until cleared
  set: (fn: () => void, ms: number) => unknown
  clear: (handle: unknown) => void
}

export interface LeaderOptions {
  //stable per-tab id
  id: string
  store: LeaseStore
  timer: LeaderTimer
  now?: () => number
  //renew (leader) / re-check (follower) cadence
  heartbeatMs?: number
  //lease lifetime; must exceed heartbeatMs so a renewing leader never lapses
  leaseMs?: number
  //only contest while "active" (e.g. document visible) so a frozen/background
  //tab can't seize leadership. defaults to always active.
  isActive?: () => boolean
}

export interface LeaderElection {
  isLeader: () => boolean
  start: () => void
  stop: () => void
  subscribe: (cb: (isLeader: boolean) => void) => () => void
}

export function createLeaderElection(opts: LeaderOptions): LeaderElection {
  const now = opts.now ?? Date.now
  const heartbeatMs = opts.heartbeatMs ?? 3000
  const leaseMs = opts.leaseMs ?? heartbeatMs * 3
  const isActive = opts.isActive ?? (() => true)
  const subs = new Set<(v: boolean) => void>()

  let leader = false
  let handle: unknown
  let running = false

  function emit(next: boolean): void {
    if (next === leader) return
    leader = next
    for (const cb of subs) cb(leader)
  }

  function tick(): void {
    const t = now()
    const lease = opts.store.read()

    if (lease?.owner === opts.id) {
      //we hold it — renew so it never lapses while we're alive + ticking
      opts.store.claim({ owner: opts.id, expiresAt: t + leaseMs }, t)
      emit(true)
      return
    }

    const vacant = !lease || lease.expiresAt <= t
    if (vacant && isActive()) {
      const won = opts.store.claim(
        { owner: opts.id, expiresAt: t + leaseMs },
        t,
      )
      emit(won && opts.store.read()?.owner === opts.id)
      return
    }

    //someone else holds a fresh lease, or we're inactive on a vacant one
    emit(false)
  }

  function start(): void {
    if (running) return
    running = true
    tick()
    handle = opts.timer.set(tick, heartbeatMs)
  }

  function stop(): void {
    if (!running) return
    running = false
    opts.timer.clear(handle)
    handle = undefined
    if (leader) opts.store.release(opts.id)
    emit(false)
  }

  return {
    isLeader: () => leader,
    start,
    stop,
    subscribe: (cb) => {
      subs.add(cb)
      return () => {
        subs.delete(cb)
      }
    },
  }
}

//---- Web Storage lease --------------------------------------------
//a LeaseStore backed by any Web Storage (localStorage shares across tabs of
//the same origin). pass a key unique to the app. SSR-safe via injection: the
//caller supplies the storage object, so this stays testable + node-friendly.

type MinimalStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">

function parseLease(raw: string | null): Lease | null {
  if (!raw) return null
  try {
    const value = JSON.parse(raw) as Lease
    if (
      typeof value?.owner === "string" &&
      typeof value?.expiresAt === "number"
    ) {
      return value
    }
    return null
  } catch {
    return null
  }
}

export function createWebLease(
  storage: MinimalStorage,
  key: string,
): LeaseStore {
  return {
    read: () => parseLease(storage.getItem(key)),
    claim: (next, now) => {
      const cur = parseLease(storage.getItem(key))
      const vacant =
        !cur || cur.expiresAt <= now || cur.owner === next.owner
      if (!vacant) return false
      storage.setItem(key, JSON.stringify(next))
      return true
    },
    release: (owner) => {
      const cur = parseLease(storage.getItem(key))
      if (cur && cur.owner === owner) storage.removeItem(key)
    },
  }
}
