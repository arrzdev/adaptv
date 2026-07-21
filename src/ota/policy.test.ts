import { describe, expect, it } from "vitest"
import type { Bundle, UpdateManifest } from "#nativ/ota/policy"
import {
  decideUpdate,
  hasProvenItself,
  selectBootBundle,
  selectPrunableBundles,
} from "#nativ/ota/policy"

const SHA = "a".repeat(64)

function manifest(extra: Partial<UpdateManifest> = {}): UpdateManifest {
  return {
    buildTag: "app-newbuild",
    url: "https://example.com/b.zip",
    sha256: SHA,
    nativeFingerprint: "fp-1",
    signature: "sig",
    ...extra,
  }
}

const base = {
  currentBuildTag: "app-oldbuild",
  nativeFingerprint: "fp-1",
  requireSignature: true,
}

describe("decideUpdate — the native fingerprint gate", () => {
  it("installs a newer, compatible, signed bundle", () => {
    expect(decideUpdate({ manifest: manifest(), ...base }).action).toBe(
      "install",
    )
  })

  it("REFUSES a bundle built against different native code", () => {
    //Not a version check — a compatibility check. A JS bundle calling a plugin
    //this binary does not contain crashes on a user's device, and no JS-side
    //error handling can prevent it. OTA bundles skip review and staged rollout,
    //so there is no safety net upstream of this.
    const decision = decideUpdate({
      manifest: manifest({ nativeFingerprint: "fp-2" }),
      ...base,
    })
    expect(decision.action).toBe("skip")
    expect(decision.reason).toContain("fingerprint")
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

  it("allows an unsigned manifest only when the app opted out", () => {
    expect(
      decideUpdate({
        manifest: manifest({ signature: undefined }),
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

describe("hasProvenItself — the boot watchdog", () => {
  it("is proven only when a pending bundle actually pinged", () => {
    expect(
      hasProvenItself({ state: "pending", readyPingReceived: true }),
    ).toBe(true)
  })

  it("is NOT proven when the ping never arrived", () => {
    //a bundle that cannot boot cannot update itself out of that state, so
    //silence must be read as failure
    expect(
      hasProvenItself({ state: "pending", readyPingReceived: false }),
    ).toBe(false)
  })
})

describe("selectBootBundle", () => {
  const good: Bundle = {
    buildTag: "v1",
    state: "known-good",
    nativeFingerprint: "fp-1",
  }

  it("gives a pending bundle its one chance", () => {
    const pending: Bundle = {
      buildTag: "v2",
      state: "pending",
      nativeFingerprint: "fp-1",
    }
    expect(selectBootBundle([good, pending])?.buildTag).toBe("v2")
  })

  it("falls back to known-good when a bundle has failed", () => {
    const failed: Bundle = {
      buildTag: "v2",
      state: "failed",
      nativeFingerprint: "fp-1",
    }
    expect(selectBootBundle([good, failed])?.buildTag).toBe("v1")
  })

  it("returns null when nothing is installed — boot the built-in bundle", () => {
    //never "nothing": the binary always contains a bundle
    expect(selectBootBundle([])).toBeNull()
  })
})

describe("selectPrunableBundles — never delete what rollback needs", () => {
  const bundles: Bundle[] = [
    { buildTag: "v1", state: "known-good", nativeFingerprint: "fp" },
    { buildTag: "v2", state: "known-good", nativeFingerprint: "fp" },
    { buildTag: "v3", state: "active", nativeFingerprint: "fp" },
  ]

  it("keeps the active bundle and one known-good behind it", () => {
    //retention is not tidiness — it is the thing rollback rolls back TO.
    //Pruning it turns a bad deploy into a bricked app with no recovery path.
    expect(selectPrunableBundles(bundles, "v3")).toEqual(["v1"])
  })

  it("keeps more when asked", () => {
    expect(selectPrunableBundles(bundles, "v3", 2)).toEqual([])
  })

  it("never prunes the active bundle, even at keep=0", () => {
    expect(selectPrunableBundles(bundles, "v3", 0)).not.toContain("v3")
  })
})
