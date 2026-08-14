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
}))

vi.mock("#adaptv/utils/platform", () => ({
  isNativePlatform: () => h.native,
}))

vi.mock("@capacitor/core", () => ({
  CapacitorHttp: {
    get: async () => ({ status: h.status, data: h.manifest }),
  },
}))

vi.mock("#adaptv/capabilities/app-state", () => ({
  onResume: (fn: () => void) => {
    h.resume.push(fn)
    return () => {}
  },
}))

vi.mock("@capawesome/capacitor-live-update", () => ({
  get LiveUpdate() {
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

  it("remembers the new binary BEFORE acting, so the reload cannot loop", async () => {
    knownBinary(APP, "fp-1")
    h.plugin = fakePlugin({
      getCurrentBundle: vi.fn(async () => ({ bundleId: "old-ota" })),
      getVersionName: vi.fn(async () => ({ versionName: "1.1.0" })),
      getVersionCode: vi.fn(async () => ({ versionCode: "11" })),
    })
    const { settleLaunch } = await load()
    await settleLaunch({ nativeFingerprint: "fp-1" })
    //and the old binary's fingerprint goes with it: a bundle from before the
    //store release cannot describe the app that just replaced it
    expect(binaryRecord()).toEqual({
      identity: "1.1.0+11",
      fingerprint: null,
    })
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

  it("releases the screen when the app is torn down mid-check", async () => {
    const { firstLaunchHold, startOtaUpdates } = await load()
    startOtaUpdates(unsigned)()
    await expect(firstLaunchHold()).resolves.toBeUndefined()
  })
})
