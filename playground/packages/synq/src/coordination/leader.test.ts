import { describe, expect, it } from "vitest"
import type { LeaderTimer } from "#synq/coordination/leader"
import {
  createLeaderElection,
  createWebLease,
} from "#synq/coordination/leader"

//a Map-backed Web Storage shared by "tabs" in one test
function fakeStorage() {
  const m = new Map<string, string>()
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => {
      m.set(k, v)
    },
    removeItem: (k: string) => {
      m.delete(k)
    },
  }
}

//a timer whose interval fn is fired manually so tests control every tick
function fakeTimer() {
  let fn: (() => void) | null = null
  const timer: LeaderTimer = {
    set: (f) => {
      fn = f
      return 1
    },
    clear: () => {
      fn = null
    },
  }
  return { timer, tick: () => fn?.() }
}

describe("createLeaderElection", () => {
  it("claims leadership immediately on start when the lease is vacant", () => {
    const clock = { t: 0 }
    const store = createWebLease(fakeStorage(), "k")
    const ft = fakeTimer()
    const el = createLeaderElection({
      id: "A",
      store,
      timer: ft.timer,
      now: () => clock.t,
      heartbeatMs: 100,
      leaseMs: 300,
    })
    el.start()
    expect(el.isLeader()).toBe(true)
  })

  it("elects exactly one leader across two tabs sharing storage", () => {
    const clock = { t: 0 }
    const storage = fakeStorage()
    const ftA = fakeTimer()
    const ftB = fakeTimer()
    const common = { now: () => clock.t, heartbeatMs: 100, leaseMs: 300 }
    const a = createLeaderElection({
      id: "A",
      store: createWebLease(storage, "k"),
      timer: ftA.timer,
      ...common,
    })
    const b = createLeaderElection({
      id: "B",
      store: createWebLease(storage, "k"),
      timer: ftB.timer,
      ...common,
    })
    a.start()
    b.start()
    expect(a.isLeader()).toBe(true)
    expect(b.isLeader()).toBe(false)
  })

  it("fails over to a follower when the leader stops (releases the lease)", () => {
    const clock = { t: 0 }
    const storage = fakeStorage()
    const ftA = fakeTimer()
    const ftB = fakeTimer()
    const common = { now: () => clock.t, heartbeatMs: 100, leaseMs: 300 }
    const a = createLeaderElection({
      id: "A",
      store: createWebLease(storage, "k"),
      timer: ftA.timer,
      ...common,
    })
    const b = createLeaderElection({
      id: "B",
      store: createWebLease(storage, "k"),
      timer: ftB.timer,
      ...common,
    })
    a.start()
    b.start()
    a.stop()
    ftB.tick()
    expect(b.isLeader()).toBe(true)
  })

  it("fails over when the leader FREEZES (lease expires) — the iOS bfcache case", () => {
    const clock = { t: 0 }
    const storage = fakeStorage()
    const ftA = fakeTimer()
    const ftB = fakeTimer()
    const common = { now: () => clock.t, heartbeatMs: 100, leaseMs: 300 }
    const a = createLeaderElection({
      id: "A",
      store: createWebLease(storage, "k"),
      timer: ftA.timer,
      ...common,
    })
    const b = createLeaderElection({
      id: "B",
      store: createWebLease(storage, "k"),
      timer: ftB.timer,
      ...common,
    })
    a.start()
    b.start()
    expect(a.isLeader()).toBe(true)

    //A is frozen into bfcache: it never ticks again. time passes the lease.
    clock.t = 350
    ftB.tick()
    expect(b.isLeader()).toBe(true)

    //A thaws — its next tick sees B's fresh lease and steps down (no split)
    ftA.tick()
    expect(a.isLeader()).toBe(false)
  })

  it("does NOT let a backgrounded tab seize an expired lease", () => {
    const clock = { t: 0 }
    const storage = fakeStorage()
    const ftA = fakeTimer()
    const ftB = fakeTimer()
    const a = createLeaderElection({
      id: "A",
      store: createWebLease(storage, "k"),
      timer: ftA.timer,
      now: () => clock.t,
      heartbeatMs: 100,
      leaseMs: 300,
    })
    const b = createLeaderElection({
      id: "B",
      store: createWebLease(storage, "k"),
      timer: ftB.timer,
      now: () => clock.t,
      heartbeatMs: 100,
      leaseMs: 300,
      isActive: () => false, //backgrounded
    })
    a.start()
    clock.t = 350 //A's lease is now expired, A frozen
    b.start() //but B is inactive → must not contest
    expect(b.isLeader()).toBe(false)
    //the expired lease is left for an ACTIVE tab to claim, untouched by B
    expect(createWebLease(storage, "k").read()?.owner).toBe("A")
  })
})

describe("createWebLease", () => {
  it("compare-and-sets on vacancy / expiry / ownership", () => {
    const s = createWebLease(fakeStorage(), "k")
    expect(s.read()).toBeNull()

    expect(s.claim({ owner: "A", expiresAt: 100 }, 0)).toBe(true)
    expect(s.read()).toEqual({ owner: "A", expiresAt: 100 })

    //B cannot take a still-fresh lease
    expect(s.claim({ owner: "B", expiresAt: 200 }, 50)).toBe(false)
    //…but can once it has expired
    expect(s.claim({ owner: "B", expiresAt: 300 }, 150)).toBe(true)
    expect(s.read()?.owner).toBe("B")

    //release is owner-scoped
    s.release("A")
    expect(s.read()?.owner).toBe("B")
    s.release("B")
    expect(s.read()).toBeNull()
  })
})
