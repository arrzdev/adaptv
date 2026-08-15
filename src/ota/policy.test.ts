import { describe, expect, it } from "vitest"
import type { Bundle, UpdateManifest } from "#adaptv/ota/policy"
import {
  decideFirstLaunch,
  decideUpdate,
  selectPrunableBundles,
  selectRollbackTarget,
} from "#adaptv/ota/policy"

const SHA = "a".repeat(64)
const T0 = 1_700_000_000_000

function manifest(extra: Partial<UpdateManifest> = {}): UpdateManifest {
  return {
    buildTag: "app-newbuild",
    url: "https://example.com/b.zip",
    sha256: SHA,
    nativeFingerprint: "fp-1",
    createdAt: T0 + 1000,
    //BOTH. One covers the zip and is checked natively; the other covers the
    //fields around it and is checked here. Neither substitutes for the other.
    signature: "sig",
    manifestSignature: "msig",
    ...extra,
  }
}

const base = {
  currentBuildTag: "app-oldbuild",
  nativeFingerprint: "fp-1",
  nativeSkew: "install",
  requireSignature: true,
  blockedBuildTags: [] as string[],
} as const

/** Same app, but configured to sit still until a store release. */
const refusing = { ...base, nativeSkew: "refuse" } as const

describe("decideUpdate — a native layer that moved", () => {
  it("installs a newer, compatible, signed bundle", () => {
    expect(decideUpdate({ manifest: manifest(), ...base }).action).toBe(
      "install",
    )
  })

  it("INSTALLS a bundle built against different native code, by default", () => {
    //The default, and the shape of the whole product: a native change is not a
    //reason to withhold every fix that shipped alongside it. The bundle runs;
    //the parts of it that need native code this binary lacks report themselves
    //unavailable through the `supported` its capability hook returns.
    const decision = decideUpdate({
      manifest: manifest({ nativeFingerprint: "fp-2" }),
      ...base,
    })
    expect(decision.action).toBe("install")
  })

  it("flags that install as skewed, so the app can say what is dark", () => {
    //🔴 The bit that makes the default survivable. Installing and NOT saying so
    //would leave an app unable to tell "everything works" from "some of this
    //cannot work until you update from the store".
    const decision = decideUpdate({
      manifest: manifest({ nativeFingerprint: "fp-2" }),
      ...base,
    })
    expect(decision.action === "install" && decision.nativeSkew).toBe(true)
  })

  it("does not flag skew on a bundle built for this exact native layer", () => {
    const decision = decideUpdate({ manifest: manifest(), ...base })
    expect(decision.action === "install" && decision.nativeSkew).toBe(
      false,
    )
  })

  it("REFUSES the same bundle when the app asked to wait for the store", () => {
    //For an app whose release moved a contract the JS cannot route around — a
    //server API, an auth flow, a data shape. A half-working bundle would be
    //worse than a stale one, and OTA bundles skip review and staged rollout, so
    //there is no safety net upstream of this.
    const decision = decideUpdate({
      manifest: manifest({ nativeFingerprint: "fp-2" }),
      ...refusing,
    })
    expect(decision.action).toBe("needs-store-release")
  })

  it("says a store release is needed rather than pretending nothing exists", () => {
    //The app may want to surface this. A plain `skip` throws away the one fact
    //the user could act on.
    const decision = decideUpdate({
      manifest: manifest({ nativeFingerprint: "fp-2" }),
      ...refusing,
    })
    expect(decision.reason).toContain("native plugins")
  })

  it("still refuses a skewed bundle this device already rolled back from", () => {
    //🔴 Installing on skew must not walk past the kill switch. A bundle that
    //failed to start here is the one case where "it will just report the
    //feature dark" is wrong — it never got far enough to report anything.
    expect(
      decideUpdate({
        manifest: manifest({ buildTag: "bad", nativeFingerprint: "fp-2" }),
        ...base,
        blockedBuildTags: ["bad"],
      }).action,
    ).toBe("skip")
  })

  it("still refuses an unsigned skewed bundle", () => {
    //Signing is upstream of compatibility: relaxing what may run must never
    //relax who may publish it.
    expect(
      decideUpdate({
        manifest: manifest({
          nativeFingerprint: "fp-2",
          signature: undefined,
        }),
        ...base,
      }).action,
    ).toBe("skip")
  })

  it("refuses an unsigned manifest when signing is required", () => {
    //without this, anyone who can write to the CDN pushes arbitrary JS into
    //every installed app
    const decision = decideUpdate({
      manifest: manifest({ signature: undefined }),
      ...base,
    })
    expect(decision.action).toBe("skip")
    expect(decision.reason).toContain("unsigned")
  })

  it("refuses a manifest carrying only one of the two signatures", () => {
    //They defend different things and neither stands in for the other. The zip
    //signature keeps attacker CODE out; the manifest signature keeps a CDN
    //compromise from replaying a genuine OLDER bundle under a fresh timestamp,
    //which passes the native check perfectly.
    for (const half of [
      { signature: undefined },
      { manifestSignature: undefined },
    ]) {
      expect(
        decideUpdate({ manifest: manifest(half), ...base }).action,
      ).toBe("skip")
    }
  })

  it("allows an unsigned manifest only when the app opted out", () => {
    expect(
      decideUpdate({
        manifest: manifest({
          signature: undefined,
          manifestSignature: undefined,
        }),
        ...base,
        requireSignature: false,
      }).action,
    ).toBe("install")
  })

  it("refuses a manifest with no usable sha256", () => {
    expect(
      decideUpdate({ manifest: manifest({ sha256: "nope" }), ...base })
        .action,
    ).toBe("skip")
  })

  it("skips when already running that build", () => {
    expect(
      decideUpdate({
        manifest: manifest({ buildTag: "app-oldbuild" }),
        ...base,
      }).action,
    ).toBe("skip")
  })
})

describe("decideUpdate — the blocked list is the kill switch, and it stops a boot loop", () => {
  it("refuses a build that already failed to start on this device", () => {
    //Without this: roll back to A → launch → check → the channel STILL advertises
    //B, because a rollback is a local event no server knows about → download B →
    //crash → roll back. Every launch, forever, until a human deploys.
    const decision = decideUpdate({
      manifest: manifest({ buildTag: "bad" }),
      ...base,
      blockedBuildTags: ["bad"],
    })
    expect(decision.action).toBe("skip")
    expect(decision.reason).toContain("failed to start")
  })

  it("still accepts the fix, because a fix is a new tag", () => {
    expect(
      decideUpdate({
        manifest: manifest({ buildTag: "fixed" }),
        ...base,
        blockedBuildTags: ["bad"],
      }).action,
    ).toBe("install")
  })
})

describe("decideUpdate — replay defence", () => {
  it("refuses a build that is not newer than the installed one", () => {
    expect(
      decideUpdate({
        manifest: manifest({ createdAt: T0 - 1 }),
        ...base,
        currentCreatedAt: T0,
      }).action,
    ).toBe("skip")
  })

  it("refuses a replay stamped with the SAME time, not just an older one", () => {
    expect(
      decideUpdate({
        manifest: manifest({ createdAt: T0 }),
        ...base,
        currentCreatedAt: T0,
      }).action,
    ).toBe("skip")
  })

  it("accepts a genuinely newer build", () => {
    expect(
      decideUpdate({
        manifest: manifest({ createdAt: T0 + 1 }),
        ...base,
        currentCreatedAt: T0,
      }).action,
    ).toBe("install")
  })

  it("does not block the very first check, when nothing is known yet", () => {
    expect(decideUpdate({ manifest: manifest(), ...base }).action).toBe(
      "install",
    )
  })
})

const APP = "1.4.0+41"
const APP_BEFORE = "1.3.0+38"

describe("selectRollbackTarget — back one step, not back a year", () => {
  const bundles: Bundle[] = [
    { buildTag: "v1", state: "known-good", provenOn: APP },
    { buildTag: "v2", state: "known-good", provenOn: APP },
    { buildTag: "v3", state: "pending" },
  ]

  it("picks the newest known-good, not the embedded bundle", () => {
    //The rented plugin's answer is always "embedded", which under adaptv's model
    //can be a year old — one bad deploy would throw every device back that far.
    expect(selectRollbackTarget(bundles, APP)).toBe("v2")
  })

  it("skips a known-good that is itself blocked", () => {
    expect(selectRollbackTarget(bundles, APP, ["v2"])).toBe("v1")
  })

  it("skips bundles that proved themselves on a different app version", () => {
    //A store release swaps the native layer under bundles that were healthy the
    //day before. They proved themselves on an app that no longer exists.
    expect(selectRollbackTarget(bundles, APP_BEFORE)).toBeNull()
  })

  it("🔴 takes a bundle built for a native layer this app does not have", () => {
    //The default skew policy installs those, so they are ordinary bundles here —
    //and having BOOTED is stronger evidence than having matching build inputs.
    //Filtering them out would send a rollback back past the native change, to
    //whatever the device ran before it.
    const skewed: Bundle[] = [
      {
        buildTag: "before-native-change",
        state: "known-good",
        provenOn: APP,
      },
      {
        buildTag: "built-for-next-app",
        state: "known-good",
        provenOn: APP,
      },
    ]
    expect(selectRollbackTarget(skewed, APP)).toBe("built-for-next-app")
  })

  it("returns null — the embedded bundle — only when there is nothing else", () => {
    expect(selectRollbackTarget([], APP)).toBeNull()
  })
})

describe("selectPrunableBundles — never delete what rollback needs", () => {
  const bundles: Bundle[] = [
    { buildTag: "v1", state: "known-good", provenOn: APP },
    { buildTag: "v2", state: "known-good", provenOn: APP },
    { buildTag: "v3", state: "active", provenOn: APP },
  ]

  it("keeps the active bundle and one known-good behind it", () => {
    //retention is not tidiness — it is the thing rollback rolls back TO.
    //Pruning it turns a bad deploy into a bricked app with no recovery path.
    expect(selectPrunableBundles(bundles, "v3", APP)).toEqual(["v1"])
  })

  it("keeps more when asked", () => {
    expect(selectPrunableBundles(bundles, "v3", APP, 2)).toEqual([])
  })

  it("never prunes the active bundle, even at keep=0", () => {
    expect(selectPrunableBundles(bundles, "v3", APP, 0)).not.toContain(
      "v3",
    )
  })

  it("🔴 retains what booted on THIS app, not what was built for it", () => {
    //Read the other way round, an app that has been taking skewed bundles keeps
    //the one from before the native change and deletes everything since — so
    //every rollback lands years back and every launch re-downloads the current
    //build. The device only finds out the next time it is offline.
    const mixed: Bundle[] = [
      { buildTag: "stale", state: "known-good", provenOn: APP_BEFORE },
      { buildTag: "current", state: "known-good", provenOn: APP },
    ]
    expect(selectPrunableBundles(mixed, "active", APP)).toEqual(["stale"])
  })

  it("prunes a bundle that never booted anywhere", () => {
    //Staged, then the process died. It is not a cushion — nothing knows it runs.
    const staged: Bundle[] = [{ buildTag: "never-ran", state: "pending" }]
    expect(selectPrunableBundles(staged, "active", APP)).toEqual([
      "never-ran",
    ])
  })
})

describe("decideFirstLaunch — the one place waiting is right", () => {
  const install = {
    action: "install",
    reason: "",
    nativeSkew: false,
  } as const
  const budgetMs = 5000

  it("waits when nothing runnable is cached", () => {
    //If store releases only happen when native changes, the embedded bundle can
    //be arbitrarily old. Booting it means showing a brand-new user the year-old
    //onboarding and then changing the app under them on launch two.
    const plan = decideFirstLaunch({
      decision: install,
      runnableCachedBundles: 0,
      budgetMs,
    })
    expect(plan.action).toBe("wait")
  })

  it("never waits once anything runnable is on disk", () => {
    //The narrowness IS the safety: true exactly once per install.
    expect(
      decideFirstLaunch({
        decision: install,
        runnableCachedBundles: 1,
        budgetMs,
      }).action,
    ).toBe("boot-now")
  })

  it("boots immediately when the update needs a store release", () => {
    //Whoever installs during the review window: the binary is the old
    //fingerprint, the channel already advertises the new one. Waiting cannot
    //produce anything this device is allowed to run.
    expect(
      decideFirstLaunch({
        decision: { action: "needs-store-release", reason: "" },
        runnableCachedBundles: 0,
        budgetMs,
      }).action,
    ).toBe("boot-now")
  })

  it("boots immediately when there is no update at all", () => {
    expect(
      decideFirstLaunch({
        decision: { action: "skip", reason: "already running this build" },
        runnableCachedBundles: 0,
        budgetMs,
      }).action,
    ).toBe("boot-now")
  })
})
