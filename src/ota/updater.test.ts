import { beforeEach, describe, expect, it, vi } from "vitest"
import type { UpdateManifest } from "#adaptv/ota/policy"

/*
 * `updater.ts` is where the pure policy meets a real device: the plugin, the
 * network, the ledger and the splash. Everything below drives it through a fake
 * plugin, because the decisions worth pinning here are the ORDERS and the
 * guards — what is asked before what, and what is refused — none of which a test
 * of `policy.ts` can see.
 *
 * The module keeps process-wide state (the plugin promise, the splash hold), so
 * every test re-imports it after `vi.resetModules()`.
 */

const h = vi.hoisted(() => ({
  native: true,
  plugin: null as Record<string, unknown> | null,
  manifest: null as unknown,
  status: 200,
  resume: [] as Array<() => void>,
  /** Set to hang the manifest request, for the tests that need a slow network. */
  gate: null as Promise<void> | null,
  /** Set to make loading the plugin itself fail. */
  pluginFails: false,
  /** How many times the manifest was requested. */
  fetches: 0,
}))

vi.mock("#adaptv/utils/platform", () => ({
  isNativePlatform: () => h.native,
}))

vi.mock("@capacitor/core", () => ({
  CapacitorHttp: {
    get: async () => {
      h.fetches += 1
      if (h.gate) await h.gate
      return { status: h.status, data: h.manifest }
    },
  },
}))

vi.mock("#adaptv/capabilities/app-state", () => ({
  onResume: (fn: () => void) => {
    h.resume.push(fn)
    return () => {
      h.resume = h.resume.filter((f) => f !== fn)
    }
  },
}))

vi.mock("@capawesome/capacitor-live-update", () => ({
  get LiveUpdate() {
    //Stands in for a plugin chunk that fails to load: the updater reads this
    //inside the promise that loads it, so the throw rejects that promise.
    if (h.pluginFails) throw new Error("plugin failed to load")
    return h.plugin
  },
}))

const KEY = "adaptv.ota.bundles"
const BINARY_KEY = "adaptv.ota.binary"
/** What `fakePlugin` reports as the installed app — `versionName+versionCode`. */
const APP = "1.0.0+10"

/** Put a binary record in the store, the way a previous launch would have. */
function knownBinary(identity: string, fingerprint: string | null = null) {
  localStorage.setItem(
    BINARY_KEY,
    JSON.stringify({ identity, fingerprint }),
  )
}

function binaryRecord() {
  return JSON.parse(localStorage.getItem(BINARY_KEY) ?? "null")
}

/** A plugin that answers everything, with the calls recorded. */
function fakePlugin(over: Record<string, unknown> = {}) {
  return {
    downloadBundle: vi.fn(async () => {}),
    setNextBundle: vi.fn(async () => {}),
    deleteBundle: vi.fn(async () => {}),
    getDownloadedBundles: vi.fn(async () => ({ bundleIds: [] })),
    getBlockedBundles: vi.fn(async () => ({ bundleIds: [] })),
    getCurrentBundle: vi.fn(async () => ({ bundleId: null })),
    getNextBundle: vi.fn(async () => ({ bundleId: null })),
    reset: vi.fn(async () => {}),
    reload: vi.fn(async () => {}),
    getVersionCode: vi.fn(async () => ({ versionCode: "10" })),
    getVersionName: vi.fn(async () => ({ versionName: "1.0.0" })),
    ready: vi.fn(async () => ({
      previousBundleId: null,
      currentBundleId: null,
      rollback: false,
    })),
    ...over,
  }
}

const manifest = (over: Partial<UpdateManifest> = {}): UpdateManifest => ({
  buildTag: "newbuild00000000",
  url: "https://app.example/.well-known/adaptv/ota/bundle-newbuild00000000.zip",
  sha256: "a".repeat(64),
  nativeFingerprint: "fp-1",
  createdAt: 2_000_000_000_000,
  signature: "zip-sig",
  manifestSignature: "manifest-sig",
  ...over,
})

const load = () => import("#adaptv/ota/updater")

/**
 * Let the check run to completion.
 *
 * `startOtaUpdates` fires its first check as a floating promise, so a `not.toHaveBeenCalled`
 * asserted straight after it would pass before the code under test had reached
 * the line that would break it. Every await in the chain resolves on a mocked
 * promise, so draining the queue a few times is exact rather than a sleep.
 */
async function settled() {
  for (let i = 0; i < 8; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

beforeEach(() => {
  vi.resetModules()
  localStorage.clear()
  h.native = true
  h.plugin = fakePlugin()
  h.manifest = manifest()
  h.status = 200
  h.resume = []
  h.gate = null
  h.pluginFails = false
  h.fetches = 0
})

/** Options for `startOtaUpdates` with verification turned off. */
const unsigned = {
  manifestUrl: "https://app.example/m.json",
  nativeFingerprint: "fp-1",
  requireSignature: false as const,
}

describe("settling a launch", () => {
  it("tells the watchdog the bundle reached the app", async () => {
    //Dropping this call does not disable the watchdog, it INVERTS it: every
    //update rolls itself back one launch later, which looks exactly like updates
    //that never install.
    const { settleLaunch } = await load()
    await settleLaunch({ nativeFingerprint: "fp-1" })
    expect(h.plugin?.ready).toHaveBeenCalledOnce()
  })

  it("marks the running bundle known-good, against the app it booted on", async () => {
    //🔴 The app version is half the record. "It booted" is only evidence about
    //the binary it booted on — a store release swaps the native layer under it
    //and the claim stops being true, silently.
    localStorage.setItem(
      KEY,
      JSON.stringify([{ buildTag: "v1", createdAt: 1, state: "pending" }]),
    )
    h.plugin = fakePlugin({
      ready: vi.fn(async () => ({
        previousBundleId: null,
        currentBundleId: "v1",
        rollback: false,
      })),
    })
    const { settleLaunch } = await load()
    await settleLaunch({ nativeFingerprint: "fp-1" })

    const ledger = JSON.parse(localStorage.getItem(KEY) ?? "[]")
    expect(ledger[0]).toMatchObject({ state: "known-good", provenOn: APP })
  })

  it("records the bundle that failed, and re-points at the newest known-good", async () => {
    //🔴 The plugin's rollback lands on the EMBEDDED bundle, unconditionally. Under
    //adaptv's model that may be a year old, so one bad deploy would throw back
    //every device — including ones happily running last week's build. adaptv
    //cannot change this launch; it can change the next one.
    localStorage.setItem(
      KEY,
      JSON.stringify([
        {
          buildTag: "v1",
          createdAt: 1,
          state: "known-good",
          provenOn: APP,
        },
        { buildTag: "v2", createdAt: 2, state: "pending" },
      ]),
    )
    h.plugin = fakePlugin({
      ready: vi.fn(async () => ({
        previousBundleId: "v2",
        currentBundleId: null,
        rollback: true,
      })),
    })
    const { settleLaunch } = await load()
    await settleLaunch({ nativeFingerprint: "fp-1" })

    const ledger = JSON.parse(localStorage.getItem(KEY) ?? "[]")
    expect(
      ledger.find((b: { buildTag: string }) => b.buildTag === "v2").state,
    ).toBe("failed")
    expect(h.plugin?.setNextBundle).toHaveBeenCalledWith({
      bundleId: "v1",
    })
  })

  it("will not re-point at a bundle the device has blocked", async () => {
    localStorage.setItem(
      KEY,
      JSON.stringify([
        {
          buildTag: "v1",
          createdAt: 1,
          state: "known-good",
          provenOn: APP,
        },
      ]),
    )
    h.plugin = fakePlugin({
      getBlockedBundles: vi.fn(async () => ({ bundleIds: ["v1"] })),
      ready: vi.fn(async () => ({
        previousBundleId: "v2",
        currentBundleId: null,
        rollback: true,
      })),
    })
    const { settleLaunch } = await load()
    await settleLaunch({ nativeFingerprint: "fp-1" })
    expect(h.plugin?.setNextBundle).not.toHaveBeenCalled()
  })

  it("re-points after a rollback the plugin could not attribute", async () => {
    //No `previousBundleId` means there is nothing to mark failed, not nothing to
    //do: the device is still on the embedded bundle, and still has a newer one
    //it knows can start.
    localStorage.setItem(
      KEY,
      JSON.stringify([
        {
          buildTag: "v1",
          createdAt: 1,
          state: "known-good",
          provenOn: APP,
        },
        { buildTag: "v2", createdAt: 2, state: "pending" },
      ]),
    )
    h.plugin = fakePlugin({
      ready: vi.fn(async () => ({
        previousBundleId: null,
        currentBundleId: null,
        rollback: true,
      })),
    })
    const { settleLaunch } = await load()
    await settleLaunch({ nativeFingerprint: "fp-1" })

    expect(h.plugin?.setNextBundle).toHaveBeenCalledWith({
      bundleId: "v1",
    })
    const ledger = JSON.parse(localStorage.getItem(KEY) ?? "[]")
    expect(ledger.map((b: { state: string }) => b.state)).toEqual([
      "known-good",
      "pending",
    ])
  })

  it("still re-points when the blocked list cannot be read", async () => {
    //An unreadable list is an empty one. Giving up instead would leave the device
    //on the embedded bundle, which may be a year old, over a failed bridge call.
    localStorage.setItem(
      KEY,
      JSON.stringify([
        {
          buildTag: "v1",
          createdAt: 1,
          state: "known-good",
          provenOn: APP,
        },
      ]),
    )
    h.plugin = fakePlugin({
      getBlockedBundles: vi.fn(async () => {
        throw new Error("bridge")
      }),
      ready: vi.fn(async () => ({
        previousBundleId: "v2",
        currentBundleId: null,
        rollback: true,
      })),
    })
    const { settleLaunch } = await load()
    await settleLaunch({ nativeFingerprint: "fp-1" })
    expect(h.plugin?.setNextBundle).toHaveBeenCalledWith({
      bundleId: "v1",
    })
  })

  it("does not re-point at the bundle a rollback already landed on", async () => {
    //The patched plugin rolls back to the last known-good itself (§5.5), so the
    //target is usually what is running. Staging it again would be a pointer write
    //for nothing, and a "next" bundle that prune then has to step around.
    localStorage.setItem(
      KEY,
      JSON.stringify([
        {
          buildTag: "v1",
          createdAt: 1,
          state: "known-good",
          provenOn: APP,
        },
        { buildTag: "v2", createdAt: 2, state: "pending" },
      ]),
    )
    h.plugin = fakePlugin({
      ready: vi.fn(async () => ({
        previousBundleId: "v2",
        currentBundleId: "v1",
        rollback: true,
      })),
    })
    const { settleLaunch } = await load()
    await settleLaunch({ nativeFingerprint: "fp-1" })
    expect(h.plugin?.ready).toHaveBeenCalledOnce()
    expect(h.plugin?.setNextBundle).not.toHaveBeenCalled()
  })

  it("still prunes when the re-point is refused", async () => {
    //The failed bundle is dead weight whether or not the pointer moved.
    localStorage.setItem(
      KEY,
      JSON.stringify([
        {
          buildTag: "v1",
          createdAt: 1,
          state: "known-good",
          provenOn: APP,
        },
        { buildTag: "v2", createdAt: 2, state: "pending" },
      ]),
    )
    h.plugin = fakePlugin({
      setNextBundle: vi.fn(async () => {
        throw new Error("refused")
      }),
      getDownloadedBundles: vi.fn(async () => ({
        bundleIds: ["v1", "v2"],
      })),
      ready: vi.fn(async () => ({
        previousBundleId: "v2",
        currentBundleId: null,
        rollback: true,
      })),
    })
    const { settleLaunch } = await load()
    await settleLaunch({ nativeFingerprint: "fp-1" })

    expect(h.plugin?.setNextBundle).toHaveBeenCalled()
    expect(h.plugin?.deleteBundle).toHaveBeenCalledWith({ bundleId: "v2" })
    //and the one it would have fallen back to is kept, which is the whole rule
    expect(h.plugin?.deleteBundle).not.toHaveBeenCalledWith({
      bundleId: "v1",
    })
  })

  it("keeps pruning past a bundle that will not delete", async () => {
    localStorage.setItem(
      KEY,
      JSON.stringify([
        { buildTag: "a", createdAt: 1, state: "pending" },
        { buildTag: "b", createdAt: 2, state: "pending" },
        {
          buildTag: "good",
          createdAt: 3,
          state: "known-good",
          provenOn: APP,
        },
      ]),
    )
    h.plugin = fakePlugin({
      getDownloadedBundles: vi.fn(async () => ({
        bundleIds: ["a", "b", "good", "cur"],
      })),
      deleteBundle: vi.fn(async ({ bundleId }: { bundleId: string }) => {
        if (bundleId === "a") throw new Error("busy")
      }),
      ready: vi.fn(async () => ({
        previousBundleId: null,
        currentBundleId: "cur",
        rollback: false,
      })),
    })
    const { settleLaunch } = await load()
    await settleLaunch({ nativeFingerprint: "fp-1" })
    expect(h.plugin?.deleteBundle).toHaveBeenCalledWith({ bundleId: "a" })
    expect(h.plugin?.deleteBundle).toHaveBeenCalledWith({ bundleId: "b" })
    expect(h.plugin?.deleteBundle).not.toHaveBeenCalledWith({
      bundleId: "good",
    })
  })

  it("settles without complaint when the update plugin will not load", async () => {
    h.pluginFails = true
    const { settleLaunch } = await load()
    await expect(
      settleLaunch({ nativeFingerprint: "fp-1" }),
    ).resolves.toBeUndefined()
    expect(binaryRecord()).toBeNull()
  })

  it("never deletes the bundle staged for the next launch", async () => {
    //Pruning it would be deleting the update that is about to be applied.
    localStorage.setItem(
      KEY,
      JSON.stringify([
        {
          buildTag: "old",
          createdAt: 1,
          state: "known-good",
          provenOn: APP,
        },
        { buildTag: "staged", createdAt: 3, state: "pending" },
      ]),
    )
    h.plugin = fakePlugin({
      getDownloadedBundles: vi.fn(async () => ({
        bundleIds: ["old", "staged"],
      })),
      getNextBundle: vi.fn(async () => ({ bundleId: "staged" })),
      ready: vi.fn(async () => ({
        previousBundleId: null,
        currentBundleId: "cur",
        rollback: false,
      })),
    })
    const { settleLaunch } = await load()
    await settleLaunch({ nativeFingerprint: "fp-1" })

    const deleted = (h.plugin?.deleteBundle as ReturnType<typeof vi.fn>)
      .mock.calls.length
    expect(deleted).toBe(0)
  })

  it("does nothing at all off native", async () => {
    h.native = false
    const { settleLaunch } = await load()
    await settleLaunch({ nativeFingerprint: "fp-1" })
    expect(h.plugin?.ready).not.toHaveBeenCalled()
  })

  it("never throws a launch away over a plugin that misbehaves", async () => {
    h.plugin = fakePlugin({
      ready: vi.fn(async () => {
        throw new Error("bridge is wedged")
      }),
      getDownloadedBundles: vi.fn(async () => {
        throw new Error("nope")
      }),
    })
    const { settleLaunch } = await load()
    await expect(
      settleLaunch({ nativeFingerprint: "fp-1" }),
    ).resolves.toBeUndefined()
  })
})

/*
 * 🔴 Every fingerprint the running JavaScript can see is baked into itself, so a
 * bundle cannot tell that the binary underneath it changed. Left alone, a store
 * release strands the device: the channel advertises a bundle for the NEW
 * fingerprint, the stale bundle compares it against its OWN, and answers
 * "needs a store release" — for one the user already installed. Forever.
 */
describe("a store release underneath a cached bundle", () => {
  it("drops back to the bundle inside the new binary", async () => {
    knownBinary(APP)
    h.plugin = fakePlugin({
      getCurrentBundle: vi.fn(async () => ({ bundleId: "old-ota" })),
      getVersionName: vi.fn(async () => ({ versionName: "1.1.0" })),
      getVersionCode: vi.fn(async () => ({ versionCode: "11" })),
    })
    const { settleLaunch } = await load()
    await settleLaunch({ nativeFingerprint: "fp-1" })

    expect(h.plugin?.reset).toHaveBeenCalledOnce()
    expect(h.plugin?.reload).toHaveBeenCalledOnce()
    //and it stops there: the document is already being replaced
    expect(h.plugin?.ready).not.toHaveBeenCalled()
  })

  it("remembers the new binary BEFORE the reload, so the reload cannot loop", async () => {
    knownBinary(APP, "fp-1")
    let atReload: unknown
    h.plugin = fakePlugin({
      getCurrentBundle: vi.fn(async () => ({ bundleId: "old-ota" })),
      getVersionName: vi.fn(async () => ({ versionName: "1.1.0" })),
      getVersionCode: vi.fn(async () => ({ versionCode: "11" })),
      reload: vi.fn(async () => {
        //the document is replaced by this call, so nothing after it is sure to run
        atReload = binaryRecord()?.identity
      }),
    })
    const { settleLaunch } = await load()
    await settleLaunch({ nativeFingerprint: "fp-1" })
    expect(atReload).toBe("1.1.0+11")
    //and the old binary's fingerprint goes with it: a bundle from before the
    //store release cannot describe the app that just replaced it
    expect(binaryRecord()).toEqual({
      identity: "1.1.0+11",
      fingerprint: null,
    })
  })

  /** The launch after a store release, with a pointer that survived it. */
  function onNewBinary(reset: () => Promise<void>) {
    localStorage.setItem(
      KEY,
      JSON.stringify([
        {
          buildTag: "old-ota",
          createdAt: 1,
          state: "known-good",
          provenOn: APP,
        },
      ]),
    )
    return fakePlugin({
      getCurrentBundle: vi.fn(async () => ({ bundleId: "old-ota" })),
      getVersionName: vi.fn(async () => ({ versionName: "1.1.0" })),
      getVersionCode: vi.fn(async () => ({ versionCode: "11" })),
      reset: vi.fn(reset),
      ready: vi.fn(async () => ({
        previousBundleId: null,
        currentBundleId: "old-ota",
        rollback: false,
      })),
    })
  }

  const refused = async () => {
    throw new Error("reset refused")
  }

  it("🔴 asks again on the next launch when the reset itself was refused", async () => {
    //Remembering the new binary is what stops the guard firing twice, so it must
    //not happen for a reset that never took. Otherwise the next launch sees a
    //version it already knows, and the device stays on the old bundle for good:
    //the exact stranding this guard exists for, reached through one bad answer.
    knownBinary(APP, "fp-1")
    h.plugin = onNewBinary(refused)
    let { settleLaunch } = await load()
    await settleLaunch({ nativeFingerprint: "fp-1" })
    //the launch still settles, because the app is already on screen
    expect(h.plugin?.ready).toHaveBeenCalledOnce()

    vi.resetModules()
    h.plugin = onNewBinary(async () => {})
    ;({ settleLaunch } = await load())
    await settleLaunch({ nativeFingerprint: "fp-1" })
    expect(h.plugin?.reset).toHaveBeenCalledOnce()
    expect(h.plugin?.reload).toHaveBeenCalledOnce()
  })

  it("🔴 does not let a refused reset prove the old bundle on the new binary", async () => {
    //A bundle proven on this binary is one `selectRollbackTarget` may send the
    //device back to, and one `prune` keeps. The old bundle has only shown that it
    //could not be dropped.
    knownBinary(APP, "fp-1")
    h.plugin = onNewBinary(refused)
    const { settleLaunch } = await load()
    await settleLaunch({ nativeFingerprint: "fp-1" })
    const ledger = JSON.parse(localStorage.getItem(KEY) ?? "[]")
    expect(ledger).toHaveLength(1)
    expect(ledger[0].provenOn).toBe(APP)
  })

  it("does not ask again once the reset landed, even if the reload did not", async () => {
    //The pointer has moved, so the next cold start is the embedded bundle anyway.
    //Asking again there would be a reset for a device that already took one.
    knownBinary(APP, "fp-1")
    h.plugin = {
      ...onNewBinary(async () => {}),
      reload: vi.fn(async () => {
        throw new Error("reload refused")
      }),
    }
    let { settleLaunch } = await load()
    await settleLaunch({ nativeFingerprint: "fp-1" })
    expect(h.plugin?.reset).toHaveBeenCalledOnce()
    expect(binaryRecord().identity).toBe("1.1.0+11")

    vi.resetModules()
    h.plugin = onNewBinary(async () => {})
    ;({ settleLaunch } = await load())
    await settleLaunch({ nativeFingerprint: "fp-1" })
    expect(h.plugin?.reset).not.toHaveBeenCalled()
  })

  it("leaves a device that is already on the embedded bundle alone", async () => {
    //There is nothing to drop back to, and resetting would reload for nothing.
    knownBinary(APP)
    h.plugin = fakePlugin({
      getVersionName: vi.fn(async () => ({ versionName: "1.1.0" })),
      getVersionCode: vi.fn(async () => ({ versionCode: "11" })),
    })
    const { settleLaunch } = await load()
    await settleLaunch({ nativeFingerprint: "fp-1" })
    expect(h.plugin?.reset).not.toHaveBeenCalled()
    expect(h.plugin?.ready).toHaveBeenCalledOnce()
  })

  it("🔴 learns the BINARY's fingerprint off the embedded bundle", async () => {
    //The one launch where the running bundle and the binary are the same build.
    //Everything after this may be a bundle made for a native layer this app does
    //not have, and its baked-in fingerprint describes the machine that built it.
    h.plugin = fakePlugin({
      getCurrentBundle: vi.fn(async () => ({ bundleId: null })),
    })
    const { settleLaunch } = await load()
    await settleLaunch({ nativeFingerprint: "fp-app" })
    expect(binaryRecord()).toEqual({
      identity: APP,
      fingerprint: "fp-app",
    })
  })

  it("does not let an OTA bundle overwrite that answer with its own", async () => {
    //🔴 The regression this whole record exists for. A skewed bundle claiming
    //`fp-next` here would make the device compare the channel against a build
    //machine and report itself up to date for ever.
    knownBinary(APP, "fp-app")
    h.plugin = fakePlugin({
      getCurrentBundle: vi.fn(async () => ({ bundleId: "some-ota" })),
    })
    const { settleLaunch } = await load()
    await settleLaunch({ nativeFingerprint: "fp-next" })
    expect(binaryRecord().fingerprint).toBe("fp-app")
  })

  it("treats a first launch as no change, and records the binary", async () => {
    h.plugin = fakePlugin({
      getCurrentBundle: vi.fn(async () => ({ bundleId: "some-ota" })),
    })
    const { settleLaunch } = await load()
    await settleLaunch({ nativeFingerprint: "fp-1" })
    expect(h.plugin?.reset).not.toHaveBeenCalled()
    expect(binaryRecord().identity).toBe(APP)
  })

  it("does not reset when only the version code cannot be read", async () => {
    //Half an identity is not an identity, and a guess resets a healthy device.
    knownBinary(APP)
    h.plugin = fakePlugin({
      getCurrentBundle: vi.fn(async () => ({ bundleId: "old-ota" })),
      getVersionName: vi.fn(async () => ({ versionName: "1.1.0" })),
      getVersionCode: vi.fn(async () => {
        throw new Error("no")
      }),
    })
    const { settleLaunch } = await load()
    await settleLaunch({ nativeFingerprint: "fp-1" })
    expect(h.plugin?.reset).not.toHaveBeenCalled()
    expect(binaryRecord().identity).toBe(APP)
  })

  it("does not reset a healthy device when the version cannot be read", async () => {
    //Guessing here would reload every launch on any platform that answers oddly.
    knownBinary(APP)
    h.plugin = fakePlugin({
      getCurrentBundle: vi.fn(async () => ({ bundleId: "old-ota" })),
      getVersionName: vi.fn(async () => {
        throw new Error("no")
      }),
    })
    const { settleLaunch } = await load()
    await settleLaunch({ nativeFingerprint: "fp-1" })
    expect(h.plugin?.reset).not.toHaveBeenCalled()
    expect(h.plugin?.ready).toHaveBeenCalledOnce()
  })
})

describe("checking for an update", () => {
  it("installs a newer compatible build and stages it for the next launch", async () => {
    const { startOtaUpdates } = await load()
    startOtaUpdates(unsigned)
    await vi.waitFor(() =>
      expect(h.plugin?.setNextBundle).toHaveBeenCalledWith({
        bundleId: "newbuild00000000",
      }),
    )
    expect(h.plugin?.downloadBundle).toHaveBeenCalledWith(
      expect.objectContaining({
        bundleId: "newbuild00000000",
        checksum: "a".repeat(64),
        //passed down so the plugin can verify it NATIVELY — a check run by the
        //code being replaced is not a check
        signature: "zip-sig",
      }),
    )
  })

  it("stages a bundle it already has without asking to download it again", async () => {
    //🔴 Measured on a device, and it strands the app: the plugin THROWS on a
    //download for a bundle already on disk, the throw is swallowed as a failed
    //check, and `setNextBundle` is never reached. The channel keeps advertising
    //that exact tag, so it repeats every launch, forever.
    //
    //Reached after every store release (`reset()` clears the pointer and leaves
    //the bundle) and after any launch killed between the download and the next
    //cold start.
    h.plugin = fakePlugin({
      getDownloadedBundles: vi.fn(async () => ({
        bundleIds: ["newbuild00000000"],
      })),
      downloadBundle: vi.fn(async () => {
        throw new Error("bundleAlreadyExists")
      }),
    })
    const { startOtaUpdates } = await load()
    startOtaUpdates(unsigned)
    await vi.waitFor(() =>
      expect(h.plugin?.setNextBundle).toHaveBeenCalledWith({
        bundleId: "newbuild00000000",
      }),
    )
    expect(h.plugin?.downloadBundle).not.toHaveBeenCalled()
    //and it is still recorded, or the replay defence would have no `createdAt`
    //for the build the device is about to run
    expect(
      JSON.parse(localStorage.getItem(KEY) ?? "[]").map(
        (b: { buildTag: string }) => b.buildTag,
      ),
    ).toEqual(["newbuild00000000"])
  })

  it("writes the ledger entry before the pointer moves", async () => {
    //The other order leaves a bundle on disk the ledger does not know about:
    //invisible, never pruned, and a rollback target it will refuse to consider.
    const order: string[] = []
    h.plugin = fakePlugin({
      setNextBundle: vi.fn(async () => {
        order.push(
          `ledger:${JSON.parse(localStorage.getItem(KEY) ?? "[]").length}`,
        )
      }),
    })
    const { startOtaUpdates } = await load()
    startOtaUpdates(unsigned)
    await vi.waitFor(() => expect(order).toEqual(["ledger:1"]))
  })

  it("refuses a manifest whose signature does not check out", async () => {
    //The runtime half of §5.4d, and it runs before anything is believed: this
    //covers `createdAt`, which the native check cannot see.
    const { startOtaUpdates } = await load()
    startOtaUpdates({
      manifestUrl: "https://app.example/m.json",
      nativeFingerprint: "fp-1",
      requireSignature: true,
      publicKey:
        "-----BEGIN PUBLIC KEY-----\nnot a key\n-----END PUBLIC KEY-----",
    })
    await settled()
    //it never even asked what it was running: nothing in the manifest was believed
    expect(h.plugin?.getCurrentBundle).not.toHaveBeenCalled()
    expect(h.plugin?.downloadBundle).not.toHaveBeenCalled()
  })

  it("refuses everything when signing is required and no key was baked in", async () => {
    const { startOtaUpdates } = await load()
    startOtaUpdates({
      manifestUrl: "https://app.example/m.json",
      nativeFingerprint: "fp-1",
      requireSignature: true,
      publicKey: null,
    })
    await settled()
    expect(h.plugin?.downloadBundle).not.toHaveBeenCalled()
  })

  it("installs a build made for a native layer this app does not have", async () => {
    //The default, and the point of the whole design: the fixes in that release
    //reach every install the day they ship, native change or not.
    h.manifest = manifest({ nativeFingerprint: "fp-OTHER" })
    const { startOtaUpdates } = await load()
    startOtaUpdates(unsigned)
    await vi.waitFor(() =>
      expect(h.plugin?.setNextBundle).toHaveBeenCalledWith({
        bundleId: "newbuild00000000",
      }),
    )
  })

  it("says a store release is needed even while it installs the bundle", async () => {
    //🔴 Both halves, and reading this off the DECISION instead of the comparison
    //is how the second one is lost: under the default the decision is "install",
    //so an app taking every bundle would never learn that its native half had
    //stopped keeping up — and the features that go dark would have no
    //explanation attached to them.
    const onStoreReleaseRequired = vi.fn()
    h.manifest = manifest({ nativeFingerprint: "fp-OTHER" })
    const { startOtaUpdates } = await load()
    startOtaUpdates({ ...unsigned, onStoreReleaseRequired })
    await vi.waitFor(() =>
      expect(onStoreReleaseRequired).toHaveBeenCalledWith(
        "newbuild00000000",
      ),
    )
    expect(h.plugin?.downloadBundle).toHaveBeenCalled()
  })

  it("refuses to download it when the app asked to wait for the store", async () => {
    const onStoreReleaseRequired = vi.fn()
    h.manifest = manifest({ nativeFingerprint: "fp-OTHER" })
    const { startOtaUpdates } = await load()
    startOtaUpdates({
      ...unsigned,
      nativeSkew: "refuse",
      onStoreReleaseRequired,
    })
    await vi.waitFor(() =>
      expect(onStoreReleaseRequired).toHaveBeenCalledWith(
        "newbuild00000000",
      ),
    )
    expect(h.plugin?.downloadBundle).not.toHaveBeenCalled()
  })

  it("🔴 compares the channel against the BINARY, not the running bundle", async () => {
    //The trap the whole binary record exists for. This device took a skewed
    //bundle, so the JS now running claims `fp-NEXT` — the fingerprint of the
    //machine that built it. The binary is still `fp-APP`. Comparing against the
    //bundle would report the app up to date, clear the state, and take the
    //"update required" screen away from an install that had not moved at all.
    knownBinary(APP, "fp-APP")
    h.manifest = manifest({ nativeFingerprint: "fp-NEXT" })
    const [{ startOtaUpdates }, store] = await Promise.all([
      load(),
      import("#adaptv/ota/store-release"),
    ])
    startOtaUpdates({ ...unsigned, nativeFingerprint: "fp-NEXT" })
    await vi.waitFor(() =>
      expect(store.getStoreRelease()?.buildTag).toBe("newbuild00000000"),
    )
  })

  it("also leaves the state behind, because a callback nobody passed says nothing", async () => {
    //The callback existed first and was never wired up by the shell, so the one
    //signal an app could act on reached nothing at all. The state is what
    //`useStoreRelease` reads, and it is written whether or not anyone listens.
    h.manifest = manifest({ nativeFingerprint: "fp-OTHER" })
    const [{ startOtaUpdates }, store] = await Promise.all([
      load(),
      import("#adaptv/ota/store-release"),
    ])
    startOtaUpdates(unsigned)
    await vi.waitFor(() =>
      expect(store.getStoreRelease()?.buildTag).toBe("newbuild00000000"),
    )
  })

  it("clears the state once a published build fits this binary again", async () => {
    const [{ startOtaUpdates }, store] = await Promise.all([
      load(),
      import("#adaptv/ota/store-release"),
    ])
    store.noteStoreReleaseRequired("oldbuild00000000")
    startOtaUpdates(unsigned)
    await vi.waitFor(() => expect(store.getStoreRelease()).toBeNull())
  })

  it("🔴 does NOT clear the state when the check itself failed", async () => {
    //Offline is not evidence that the install caught up. Clearing here would make
    //every stranded device look healthy for exactly as long as it stayed off the
    //network — which is the one time nobody is around to notice it is lying.
    h.status = 500
    const [{ startOtaUpdates }, store] = await Promise.all([
      load(),
      import("#adaptv/ota/store-release"),
    ])
    store.noteStoreReleaseRequired("oldbuild00000000")
    startOtaUpdates(unsigned)
    await settled()
    expect(store.getStoreRelease()?.buildTag).toBe("oldbuild00000000")
  })

  it("refuses a build this device already watched fail to start", async () => {
    //Without this: roll back, launch, the channel STILL advertises it because a
    //rollback is a local event, download, crash, roll back. Every launch, forever.
    h.plugin = fakePlugin({
      getBlockedBundles: vi.fn(async () => ({
        bundleIds: ["newbuild00000000"],
      })),
    })
    const { startOtaUpdates } = await load()
    startOtaUpdates(unsigned)
    await settled()
    expect(h.plugin?.getBlockedBundles).toHaveBeenCalled()
    expect(h.plugin?.downloadBundle).not.toHaveBeenCalled()
  })

  it("refuses a build older than the one it is running", async () => {
    //The replay: a genuine older bundle re-announced. The local `createdAt` is
    //the only thing that knows, because the bundle cannot carry its own.
    localStorage.setItem(
      KEY,
      JSON.stringify([
        {
          buildTag: "running",
          createdAt: 3_000_000_000_000,
          state: "known-good",
          provenOn: APP,
        },
      ]),
    )
    knownBinary(APP)
    h.plugin = fakePlugin({
      getCurrentBundle: vi.fn(async () => ({ bundleId: "running" })),
    })
    const { startOtaUpdates } = await load()
    startOtaUpdates(unsigned)
    await settled()
    expect(h.plugin?.getCurrentBundle).toHaveBeenCalled()
    expect(h.plugin?.downloadBundle).not.toHaveBeenCalled()
  })

  it("checks again on resume, not only at launch", async () => {
    //A mobile app is backgrounded far more often than it is cold-started, so a
    //launch-only check leaves people on a stale bundle for days.
    const { startOtaUpdates } = await load()
    startOtaUpdates(unsigned)
    await vi.waitFor(() => expect(h.resume).toHaveLength(1))
  })

  it("does nothing on the web, where the service worker owns updates", async () => {
    h.native = false
    const { startOtaUpdates } = await load()
    const stop = startOtaUpdates(unsigned)
    stop()
    expect(h.resume).toHaveLength(0)
  })

  it("reads a manifest the host served as text", async () => {
    //A static host that does not call `.json` JSON hands the native request a
    //string. The update is in it all the same.
    h.manifest = JSON.stringify(manifest())
    const { startOtaUpdates } = await load()
    startOtaUpdates(unsigned)
    await vi.waitFor(() =>
      expect(h.plugin?.setNextBundle).toHaveBeenCalledWith({
        bundleId: "newbuild00000000",
      }),
    )
  })

  it("requires a signature when the app did not say either way", async () => {
    //The default is the safe half. An update channel is a remote-code-execution
    //channel into every installed app. → §5.4d
    const { startOtaUpdates } = await load()
    startOtaUpdates({
      manifestUrl: "https://app.example/m.json",
      nativeFingerprint: "fp-1",
    })
    await settled()
    expect(h.plugin?.getBlockedBundles).not.toHaveBeenCalled()
    expect(h.plugin?.downloadBundle).not.toHaveBeenCalled()
  })

  it("takes an unreadable current bundle for the embedded one, and still installs", async () => {
    const { startOtaUpdates } = await load()
    h.plugin = fakePlugin({
      getCurrentBundle: vi.fn(async () => {
        throw new Error("bridge")
      }),
    })
    startOtaUpdates(unsigned)
    await vi.waitFor(() =>
      expect(h.plugin?.setNextBundle).toHaveBeenCalledWith({
        bundleId: "newbuild00000000",
      }),
    )
  })

  it("downloads when it cannot tell what is already on disk", async () => {
    //The download is the half that verifies. Skipping it on a failed listing
    //would stage a pointer at bytes nobody checked are there.
    h.plugin = fakePlugin({
      getDownloadedBundles: vi.fn(async () => {
        throw new Error("bridge")
      }),
    })
    const { startOtaUpdates } = await load()
    startOtaUpdates(unsigned)
    await vi.waitFor(() =>
      expect(h.plugin?.setNextBundle).toHaveBeenCalledWith({
        bundleId: "newbuild00000000",
      }),
    )
    expect(h.plugin?.downloadBundle).toHaveBeenCalledOnce()
  })

  it("stays quiet when the channel cannot be reached", async () => {
    h.status = 503
    const { startOtaUpdates } = await load()
    startOtaUpdates(unsigned)
    await settled()
    expect(h.plugin?.downloadBundle).not.toHaveBeenCalled()
  })
})

describe("holding the launch screen on a first launch", () => {
  it("resolves immediately when the app has run before", async () => {
    //The narrowness IS the safety: a blocking wait is only ever acceptable when
    //nothing runnable is cached, which is true exactly once per install.
    knownBinary(APP)
    localStorage.setItem(
      KEY,
      JSON.stringify([
        {
          buildTag: "cached",
          createdAt: 1,
          state: "known-good",
          provenOn: APP,
        },
      ]),
    )
    const { firstLaunchHold, startOtaUpdates } = await load()
    startOtaUpdates(unsigned)
    await expect(firstLaunchHold()).resolves.toBeUndefined()
  })

  it("resolves immediately when OTA never started", async () => {
    const { firstLaunchHold } = await load()
    await expect(firstLaunchHold()).resolves.toBeUndefined()
  })

  it("applies the update it waited for instead of showing a dead version", async () => {
    //Nothing cached means the built-in bundle may be many deploys old. There is
    //no session to tear and the splash is still up, so it applies now.
    const { firstLaunchHold, startOtaUpdates } = await load()
    startOtaUpdates(unsigned)
    await vi.waitFor(() => expect(h.plugin?.reload).toHaveBeenCalledOnce())
    await expect(firstLaunchHold()).resolves.toBeUndefined()
  })

  it("releases the screen even when the check falls over", async () => {
    //Whatever happens, the app must not stay behind its launch screen.
    h.plugin = fakePlugin({
      getBlockedBundles: vi.fn(async () => {
        throw new Error("wedged")
      }),
    })
    const { firstLaunchHold, startOtaUpdates } = await load()
    startOtaUpdates(unsigned)
    await expect(firstLaunchHold()).resolves.toBeUndefined()
  })

  it("releases the screen when applying the update in place fails", async () => {
    //The bundle is staged either way, so the next cold start still gets it; this
    //launch just has to stop waiting.
    h.plugin = fakePlugin({
      reload: vi.fn(async () => {
        throw new Error("reload refused")
      }),
    })
    const { firstLaunchHold, startOtaUpdates } = await load()
    startOtaUpdates(unsigned)
    let revealed = false
    void firstLaunchHold().then(() => {
      revealed = true
    })
    await vi.waitFor(() => expect(h.plugin?.reload).toHaveBeenCalledOnce())
    await settled()
    //now, not when the five-second ceiling would have released it anyway
    expect(revealed).toBe(true)
    expect(h.plugin?.setNextBundle).toHaveBeenCalledWith({
      bundleId: "newbuild00000000",
    })
  })

  it("releases the screen when the update plugin will not load", async () => {
    h.pluginFails = true
    const { firstLaunchHold, startOtaUpdates } = await load()
    startOtaUpdates(unsigned)
    let revealed = false
    void firstLaunchHold().then(() => {
      revealed = true
    })
    await settled()
    expect(revealed).toBe(true)
  })

  it("releases the screen when the app is torn down mid-check", async () => {
    const { firstLaunchHold, startOtaUpdates } = await load()
    startOtaUpdates(unsigned)()
    await expect(firstLaunchHold()).resolves.toBeUndefined()
  })
})

describe("the foreground poll", () => {
  it("does not run at all when the app did not ask for one", async () => {
    //The default. Launch and resume are the only two checks, exactly as before
    //this option existed.
    vi.useFakeTimers()
    try {
      const { startOtaUpdates } = await load()
      startOtaUpdates(unsigned)
      await vi.advanceTimersByTimeAsync(6 * 60 * 60 * 1000)
      expect(h.plugin?.getBlockedBundles).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it("looks again while the app stays in the foreground", async () => {
    //The session the other two checks never reach: a kiosk, never backgrounded
    //and never relaunched, which would otherwise sit a full day behind its own
    //deploy. → docs/design/ota.md §5.2
    vi.useFakeTimers()
    try {
      const { startOtaUpdates } = await load()
      startOtaUpdates({ ...unsigned, pollIntervalMs: 60_000 })
      await vi.advanceTimersByTimeAsync(180_000)
      expect(h.plugin?.getBlockedBundles).toHaveBeenCalledTimes(4)
    } finally {
      vi.useRealTimers()
    }
  })

  it("still stages rather than swapping under a live session", async () => {
    //The poll moves WHEN the download happens, never when the swap does. A tick
    //that reloaded the WebView would tear the session it polled from.
    vi.useFakeTimers()
    try {
      localStorage.setItem(
        KEY,
        JSON.stringify([
          {
            buildTag: "old",
            createdAt: 1,
            state: "known-good",
            provenOn: APP,
          },
        ]),
      )
      knownBinary(APP, "fp-1")
      const { startOtaUpdates } = await load()
      startOtaUpdates({ ...unsigned, pollIntervalMs: 60_000 })
      await vi.advanceTimersByTimeAsync(120_000)
      expect(h.plugin?.setNextBundle).toHaveBeenCalled()
      expect(h.plugin?.reload).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it("never lets two checks run at once", async () => {
    //🔴 The regression this pins. Two concurrent checks both reach
    //`downloadBundle` for the same tag, the plugin THROWS on the second, the
    //throw is caught — so the visible result is not an error but a check that
    //abandoned its run before `setNextBundle`. Bytes on disk, no pointer at them.
    //
    //Two ticks cannot collide by themselves — the clock is only re-armed once a
    //check has returned — so the overlap that has to be ruled out is a RESUME
    //landing on top of a check already in flight, which is the ordinary shape of
    //a slow network and a user coming back to the app.
    let release: (() => void) | undefined
    h.plugin = fakePlugin({
      getBlockedBundles: vi.fn(
        () =>
          new Promise((resolve) => {
            release = () => resolve({ bundleIds: [] })
          }),
      ),
    })
    const { startOtaUpdates } = await load()
    startOtaUpdates({ ...unsigned, pollIntervalMs: 60_000 })
    //the launch check is now parked inside `getBlockedBundles` and cannot finish
    await vi.waitFor(() =>
      expect(h.plugin?.getBlockedBundles).toHaveBeenCalledTimes(1),
    )

    for (let i = 0; i < 3; i++) for (const fn of h.resume) fn()
    await settled()
    expect(h.plugin?.getBlockedBundles).toHaveBeenCalledTimes(1)
    release?.()
  })

  it("counts the interval from the last check, not from a clock of its own", async () => {
    //A resume restarts it. Otherwise coming back to an app costs a check and
    //then a tick moments later, which is two requests for one answer.
    vi.useFakeTimers()
    try {
      const { startOtaUpdates } = await load()
      startOtaUpdates({ ...unsigned, pollIntervalMs: 60_000 })
      await vi.advanceTimersByTimeAsync(50_000)
      for (const fn of h.resume) fn()
      await vi.advanceTimersByTimeAsync(0)
      expect(h.plugin?.getBlockedBundles).toHaveBeenCalledTimes(2)
      //the tick that was 10s away has been pushed out a full interval
      await vi.advanceTimersByTimeAsync(50_000)
      expect(h.plugin?.getBlockedBundles).toHaveBeenCalledTimes(2)
      await vi.advanceTimersByTimeAsync(10_000)
      expect(h.plugin?.getBlockedBundles).toHaveBeenCalledTimes(3)
    } finally {
      vi.useRealTimers()
    }
  })

  it("does not check on a resume that arrives after teardown", async () => {
    //A listener the platform fires late, or one captured before teardown, must
    //not start a check for an app that has gone.
    const { startOtaUpdates } = await load()
    const stop = startOtaUpdates(unsigned)
    await settled()
    expect(h.fetches).toBe(1)

    const late = [...h.resume]
    stop()
    for (const fn of late) fn()
    await settled()
    expect(h.fetches).toBe(1)
  })

  it("leaves no timer and no resume listener behind once torn down", async () => {
    //A check that already ran has armed the interval, and teardown has to take it
    //down itself: nothing else will, and a live interval keeps waking the app.
    vi.useFakeTimers()
    try {
      knownBinary(APP)
      localStorage.setItem(
        KEY,
        JSON.stringify([
          {
            buildTag: "cached",
            createdAt: 1,
            state: "known-good",
            provenOn: APP,
          },
        ]),
      )
      const { startOtaUpdates } = await load()
      const stop = startOtaUpdates({ ...unsigned, pollIntervalMs: 60_000 })
      await vi.advanceTimersByTimeAsync(0)
      expect(h.plugin?.getBlockedBundles).toHaveBeenCalledTimes(1)
      expect(vi.getTimerCount()).toBe(1)
      expect(h.resume).toHaveLength(1)

      stop()
      expect(vi.getTimerCount()).toBe(0)
      expect(h.resume).toHaveLength(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it("stops when the app tears down", async () => {
    vi.useFakeTimers()
    try {
      const { startOtaUpdates } = await load()
      startOtaUpdates({ ...unsigned, pollIntervalMs: 60_000 })()
      await vi.advanceTimersByTimeAsync(600_000)
      expect(h.plugin?.getBlockedBundles).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })
})

describe("applying in place, which only a launch may do", () => {
  //🔴 `decideFirstLaunch` answers `"wait"` from `cachedAtStart`, and that is read
  //ONCE when the updater starts. On an install with nothing proven yet — the
  //first launch after a store install, or after a store release wiped what was —
  //it therefore keeps answering `"wait"` for the entire session. Only the check
  //running behind the launch screen may act on it.

  it("applies at once behind the launch screen, where nothing can be torn", async () => {
    //The case the branch exists for: a brand-new install whose bundle is already
    //stale. The splash is up, so a new user is shown the current product rather
    //than a version of it that no longer exists.
    const { startOtaUpdates } = await load()
    startOtaUpdates(unsigned)
    await settled()
    expect(h.plugin?.setNextBundle).toHaveBeenCalled()
    expect(h.plugin?.reload).toHaveBeenCalled()
  })

  it("stages instead once a poll tick finds it, with the app on screen", async () => {
    //Same device, same `"wait"` verdict, and a reload here replaces the document
    //under a mounted app: scroll position, half-typed input and open sheets all
    //gone, and nothing about it reads as an update.
    vi.useFakeTimers()
    try {
      h.manifest = null
      const { startOtaUpdates } = await load()
      startOtaUpdates({ ...unsigned, pollIntervalMs: 60_000 })
      //the launch check finds nothing, so the hold is released on its own
      await vi.advanceTimersByTimeAsync(10_000)
      expect(h.plugin?.reload).not.toHaveBeenCalled()

      h.manifest = manifest()
      await vi.advanceTimersByTimeAsync(60_000)
      expect(h.plugin?.setNextBundle).toHaveBeenCalled()
      expect(h.plugin?.reload).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it("stages instead when a resume finds it, with the app on screen", async () => {
    h.manifest = null
    const { startOtaUpdates } = await load()
    startOtaUpdates(unsigned)
    await settled()

    h.manifest = manifest()
    for (const fn of h.resume) fn()
    await settled()
    expect(h.plugin?.setNextBundle).toHaveBeenCalled()
    expect(h.plugin?.reload).not.toHaveBeenCalled()
  })

  it("stages instead when the launch check outran its own budget", async () => {
    //The hold has a ceiling, so a slow network reveals the app while the check is
    //still running. The download then lands on an app the user is already using,
    //which is the same tear by a different route.
    vi.useFakeTimers()
    let release: (() => void) | undefined
    h.gate = new Promise<void>((resolve) => {
      release = resolve
    })
    try {
      const { firstLaunchHold, startOtaUpdates } = await load()
      startOtaUpdates(unsigned)
      await vi.advanceTimersByTimeAsync(6000)
      //the budget expired and the app is on screen
      await expect(firstLaunchHold()).resolves.toBeUndefined()

      release?.()
      await vi.advanceTimersByTimeAsync(100)
      expect(h.plugin?.setNextBundle).toHaveBeenCalled()
      expect(h.plugin?.reload).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })
})
