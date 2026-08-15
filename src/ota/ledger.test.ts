import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  binaryFingerprint,
  createdAtOf,
  forget,
  lastSeenBinary,
  markState,
  proven,
  readLedger,
  recordStaged,
  rememberBinary,
} from "#adaptv/ota/ledger"

const KEY = "adaptv.ota.bundles"
const APP = "1.4.0+41"

const staged = (
  over: Partial<Parameters<typeof recordStaged>[0]> = {},
) => ({
  buildTag: "v1",
  createdAt: 1000,
  ...over,
})

beforeEach(() => {
  //Unstub FIRST: one test below replaces `localStorage` with `undefined`, and
  //clearing before restoring it throws on whatever test happens to run next.
  vi.unstubAllGlobals()
  localStorage.clear()
})

describe("what the device remembers about its bundles", () => {
  it("records a staged bundle as pending, newest last", () => {
    recordStaged(staged())
    recordStaged(staged({ buildTag: "v2", createdAt: 2000 }))
    expect(readLedger().map((b) => [b.buildTag, b.state])).toEqual([
      ["v1", "pending"],
      ["v2", "pending"],
    ])
  })

  it("re-staging a tag replaces its entry instead of duplicating it", () => {
    //A bundle can be staged twice: downloaded, never booted, then re-advertised.
    //Two rows for one tag would make the tail `policy.ts` reads meaningless.
    recordStaged(staged())
    markState("v1", "known-good", APP)
    recordStaged(staged({ createdAt: 5000 }))
    expect(readLedger()).toEqual([
      { buildTag: "v1", createdAt: 5000, state: "pending" },
    ])
  })

  it("moves a bundle's state and leaves the rest alone", () => {
    recordStaged(staged())
    recordStaged(staged({ buildTag: "v2" }))
    markState("v2", "failed")
    expect(readLedger().map((b) => b.state)).toEqual(["pending", "failed"])
  })

  it("ignores a state change for a bundle it never heard of", () => {
    recordStaged(staged())
    markState("stranger", "failed")
    expect(readLedger()).toHaveLength(1)
  })

  it("forgets only what it is asked to", () => {
    recordStaged(staged())
    recordStaged(staged({ buildTag: "v2" }))
    forget(["v1"])
    expect(readLedger().map((b) => b.buildTag)).toEqual(["v2"])
    forget([])
    expect(readLedger().map((b) => b.buildTag)).toEqual(["v2"])
  })
})

describe("the replay defence's memory", () => {
  it("answers when the running build was published", () => {
    //This is the whole of the defence's local half: `decideUpdate` compares the
    //manifest's `createdAt` against it, and without an answer here a genuine old
    //bundle replayed under a fresh timestamp reads as new.
    recordStaged(staged({ createdAt: 1_700_000_000_000 }))
    expect(createdAtOf("v1")).toBe(1_700_000_000_000)
  })

  it("is undefined for a build it has no record of, not zero", () => {
    //Zero would compare as "everything is newer than this", which is the same
    //answer but arrived at by accident. `decideUpdate` skips the check entirely
    //when it does not know, which is right on a first launch.
    expect(createdAtOf("never-seen")).toBeUndefined()
  })

  it("survives being read through the bundle it describes being replaced", () => {
    //The record lives in localStorage rather than in a bundle precisely because
    //the bundle is the thing being swapped. The origin does not change when the
    //plugin re-points the root, so the store does not either.
    recordStaged(staged({ createdAt: 4242 }))
    const carried = localStorage.getItem(KEY)
    localStorage.clear()
    localStorage.setItem(KEY, carried as string)
    expect(createdAtOf("v1")).toBe(4242)
  })
})

describe("bundles this binary has actually booted", () => {
  it("keeps only the ones that proved themselves on this app version", () => {
    //⚠︎ A store release swaps the native layer under a bundle that was healthy
    //yesterday. It proved itself on an app that no longer exists, and counting it
    //makes every downstream answer wrong.
    recordStaged(staged({ buildTag: "before" }))
    recordStaged(staged({ buildTag: "after" }))
    markState("before", "known-good", "1.3.0+38")
    markState("after", "known-good", APP)
    expect(proven(APP).map((b) => b.buildTag)).toEqual(["after"])
  })

  it("does not count a bundle that was staged but never booted", () => {
    //`pending` is a download, not evidence. Rolling back to one would be
    //rolling forward into something unproven at the worst possible moment.
    recordStaged(staged())
    expect(proven(APP)).toEqual([])
  })

  it("counts nothing on a device that has never staged anything", () => {
    //Zero here is what unlocks the first-launch wait, so it has to be exact.
    expect(proven(APP)).toEqual([])
  })
})

describe("when the store is not there, or not right", () => {
  it("reads an empty ledger rather than throwing", () => {
    for (const junk of ["not json", '{"not":"an array"}', ""]) {
      localStorage.setItem(KEY, junk)
      expect(readLedger()).toEqual([])
    }
  })

  it("drops rows that are missing the fields policy reads", () => {
    //A half-written entry from a killed process must not reach `policy.ts` as a
    //bundle with an undefined state — that would match nothing, or worse.
    localStorage.setItem(
      KEY,
      JSON.stringify([
        { buildTag: "ok", createdAt: 1, state: "pending" },
        { buildTag: "no-state", createdAt: 1 },
        { buildTag: "bad-state", createdAt: 1, state: "wat" },
        {
          buildTag: "bad-proof",
          createdAt: 1,
          state: "pending",
          provenOn: 7,
        },
        { createdAt: 1, state: "pending" },
      ]),
    )
    expect(readLedger().map((b) => b.buildTag)).toEqual(["ok"])
  })

  it("loses its history rather than the launch when the store refuses a write", () => {
    //A full or disabled store costs this device its record, not its ability to
    //run: every reader already treats an empty ledger as a first launch.
    const setItem = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("QuotaExceededError")
      })
    expect(() => recordStaged(staged())).not.toThrow()
    setItem.mockRestore()
  })

  it("works on a platform with no localStorage at all", () => {
    vi.stubGlobal("localStorage", undefined)
    expect(readLedger()).toEqual([])
    expect(createdAtOf("v1")).toBeUndefined()
    expect(lastSeenBinary()).toBeNull()
    expect(() => recordStaged(staged())).not.toThrow()
    expect(() => rememberBinary("1.0.0+1")).not.toThrow()
  })
})

describe("the binary underneath the bundles", () => {
  it("is null before the first launch has recorded one", () => {
    //`null` must read as "first launch", never as "it changed" — the second would
    //reset a healthy device the very first time it ran.
    expect(lastSeenBinary()).toBeNull()
  })

  it("remembers what it was told, verbatim", () => {
    rememberBinary("1.4.0+91")
    expect(lastSeenBinary()).toBe("1.4.0+91")
  })

  it("is kept apart from the bundle ledger", () => {
    //They answer different questions and are cleared at different times; sharing
    //a key would make a corrupt ledger take the binary record down with it.
    rememberBinary("1.4.0+91")
    recordStaged(staged())
    localStorage.setItem(KEY, "corrupt")
    expect(lastSeenBinary()).toBe("1.4.0+91")
  })

  it("reads a junk record as a first launch", () => {
    for (const junk of ["not json", "[]", '{"no":"identity"}', ""]) {
      localStorage.setItem("adaptv.ota.binary", junk)
      expect(lastSeenBinary()).toBeNull()
      expect(binaryFingerprint()).toBeNull()
    }
  })
})

describe("the binary's OWN native fingerprint", () => {
  it("is null until a launch is in a position to know it", () => {
    //🔴 Never guessed. Every fallback available here is a bundle's baked-in
    //constant, which is the fingerprint of the machine that BUILT it.
    rememberBinary(APP)
    expect(binaryFingerprint()).toBeNull()
  })

  it("is learnt from the bundle that shipped inside the binary", () => {
    //The one moment the two coincide: the embedded bundle and the native project
    //were built together.
    rememberBinary(APP, "fp-app")
    expect(binaryFingerprint()).toBe("fp-app")
  })

  it("survives launches that cannot see it — the whole point", () => {
    //After a skewed bundle installs, the running JS claims a fingerprint the
    //binary does not have. If this were overwritten from there, the device would
    //compare the channel against a build machine and call itself up to date.
    rememberBinary(APP, "fp-app")
    rememberBinary(APP)
    expect(binaryFingerprint()).toBe("fp-app")
  })

  it("is forgotten when the binary itself changes", () => {
    //A store release makes the old answer wrong, not stale. `null` sends the
    //device back to reading it off the embedded bundle, which the reset it is
    //about to perform guarantees will be running next launch.
    rememberBinary(APP, "fp-app")
    rememberBinary("2.0.0+50")
    expect(binaryFingerprint()).toBeNull()
    expect(lastSeenBinary()).toBe("2.0.0+50")
  })
})
