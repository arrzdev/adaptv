import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  clearStoreRelease,
  getStoreRelease,
  noteStoreReleaseRequired,
  resetStoreReleaseForTests,
  subscribeStoreRelease,
} from "#adaptv/ota/store-release"

beforeEach(() => {
  resetStoreReleaseForTests()
})

describe("the state itself", () => {
  it("starts null — an install that has not been told otherwise is fine", () => {
    expect(getStoreRelease()).toBeNull()
  })

  it("records the tag the channel offered and when it first happened", () => {
    vi.spyOn(Date, "now").mockReturnValue(1_000)
    noteStoreReleaseRequired("abc123")
    expect(getStoreRelease()).toEqual({ buildTag: "abc123", since: 1_000 })
    vi.restoreAllMocks()
  })

  it("keeps the original `since` when a SECOND incompatible build is published", () => {
    //🔴 The number the UI wants is how long this install has been stranded, not
    //how long the newest refusal has been true. A clock that restarted on every
    //deploy would never grow, so a "you are far behind" prompt could never fire
    //on the devices that are furthest behind — the ones a busy channel strands.
    const now = vi.spyOn(Date, "now").mockReturnValue(1_000)
    noteStoreReleaseRequired("first")
    now.mockReturnValue(999_000)
    noteStoreReleaseRequired("second")
    expect(getStoreRelease()).toEqual({ buildTag: "second", since: 1_000 })
    vi.restoreAllMocks()
  })

  it("clears when the install can take what is published again", () => {
    noteStoreReleaseRequired("abc123")
    clearStoreRelease()
    expect(getStoreRelease()).toBeNull()
  })

  it("starts a NEW clock after a clear, because the stranding really did end", () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(1_000)
    noteStoreReleaseRequired("first")
    clearStoreRelease()
    now.mockReturnValue(999_000)
    noteStoreReleaseRequired("second")
    expect(getStoreRelease()?.since).toBe(999_000)
    vi.restoreAllMocks()
  })
})

describe("notifications — every launch reaches this code, most change nothing", () => {
  it("tells subscribers when the state becomes true", () => {
    const seen = vi.fn()
    subscribeStoreRelease(seen)
    noteStoreReleaseRequired("abc123")
    expect(seen).toHaveBeenCalledTimes(1)
  })

  it("stays silent when the same build is refused again", () => {
    //The check runs on every launch and on every resume. Re-notifying identical
    //state would re-render the app for nothing, several times a session.
    const seen = vi.fn()
    noteStoreReleaseRequired("abc123")
    subscribeStoreRelease(seen)
    noteStoreReleaseRequired("abc123")
    expect(seen).not.toHaveBeenCalled()
  })

  it("stays silent when clearing state that is already clear", () => {
    const seen = vi.fn()
    subscribeStoreRelease(seen)
    clearStoreRelease()
    expect(seen).not.toHaveBeenCalled()
  })

  it("stops notifying after unsubscribe", () => {
    const seen = vi.fn()
    subscribeStoreRelease(seen)()
    noteStoreReleaseRequired("abc123")
    expect(seen).not.toHaveBeenCalled()
  })

  it("hands `useSyncExternalStore` a stable snapshot between changes", () => {
    //Returning a fresh object per read is the classic way to make that hook loop
    //forever. Identity has to survive a read that changed nothing.
    noteStoreReleaseRequired("abc123")
    const first = getStoreRelease()
    noteStoreReleaseRequired("abc123")
    expect(getStoreRelease()).toBe(first)
  })
})

describe("persistence — the age is the whole point, so it has to outlive a launch", () => {
  /**
   * A cold start, honestly: the module is re-evaluated, so its initial read of
   * `localStorage` actually runs. Calling `getStoreRelease()` on the already-
   * imported module would only report the snapshot taken at import time and would
   * pass no matter what the reader does with the stored bytes.
   */
  async function relaunch() {
    vi.resetModules()
    return await import("#adaptv/ota/store-release")
  }

  it("survives a reload, because the record is not in the bundle", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_000)
    noteStoreReleaseRequired("abc123")
    vi.restoreAllMocks()

    const next = await relaunch()
    expect(next.getStoreRelease()).toEqual({
      buildTag: "abc123",
      since: 1_000,
    })
  })

  it("removes the record on a clear, so the next stranding is timed honestly", async () => {
    noteStoreReleaseRequired("abc123")
    clearStoreRelease()
    expect(
      globalThis.localStorage.getItem("adaptv.ota.store-release"),
    ).toBeNull()
    expect((await relaunch()).getStoreRelease()).toBeNull()
  })

  it("treats a corrupt record as no record", async () => {
    //Same trade as the ledger: a half-written entry from a killed process must
    //degrade to "this device knows nothing", never to a crash on launch.
    globalThis.localStorage.setItem("adaptv.ota.store-release", "{{{")
    expect((await relaunch()).getStoreRelease()).toBeNull()
  })

  it("refuses a record with the right keys and the wrong types", async () => {
    //JSON.parse succeeds on plenty of things that are not this type. A `since`
    //that is a string would silently produce `NaN` days everywhere downstream.
    globalThis.localStorage.setItem(
      "adaptv.ota.store-release",
      JSON.stringify({ buildTag: "abc", since: "yesterday" }),
    )
    expect((await relaunch()).getStoreRelease()).toBeNull()
  })
})
