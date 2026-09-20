// @vitest-environment node
import { describe, expect, it } from "vitest"
import { explainFailure } from "./explain.mjs"
import { errorTail } from "./tool-log.mjs"

/**
 * Two different things are "locked" in an iOS run, and they have opposite fixes.
 *
 * A locked iPhone is unlocked by the dev. A locked build database is held by another build
 * writing into the same build folder, which no phone has anything to do with. The recogniser
 * for the first matched a bare `is locked`, and xcodebuild's line for the second says
 * `database is locked`, so a simulator build that collided with another one printed `the
 * device is locked` and told the dev to unlock a device that has no lock screen.
 */

/**
 * Captured from Xcode 26.1.1 (17B100), 2026-09-13: two `xcodebuild build` runs started two
 * seconds apart against one `-derivedDataPath`. The second fails with this. Only the build
 * folder's path is replaced, since the capture's own was a throwaway directory.
 */
const DB_LOCKED = [
  "note: Building targets in dependency order",
  "note: Target dependency graph (1 target)",
  "    Target 'Probe' in project 'Probe' (no dependencies)",
  "",
  "GatherProvisioningInputs",
  "",
  "CreateBuildDescription",
  "",
  'error: unable to attach DB: error: accessing build database "/path/to/app/.adaptv/ios/DerivedData/build/Build/Intermediates.noindex/XCBuildData/build.db": database is locked Possibly there are two concurrent builds running in the same filesystem location.',
  "** BUILD FAILED **",
  "",
  "",
  "The following build commands failed:",
  "\tBuilding workspace pkg with scheme Probe",
  "(1 failure)",
]

/** What `exec` hands the explainer: the captured stream, narrowed by `errorTail`. */
const failed = (captured) => {
  const err = new Error("xcodebuild exited with code 65")
  err.tail = errorTail(captured).join("\n")
  return err
}

describe("a build that collides with another build is not a locked device", () => {
  it("says another build holds the build folder", () => {
    const { reason, detail } = explainFailure("ios")(failed(DB_LOCKED))
    expect(reason).toBe(
      "another build is using this app's iOS build folder",
    )
    expect(detail).toEqual([
      "An 'adaptv preview' or 'adaptv build' of this app is still building.",
      "Wait for it to finish or stop it, then run again.",
    ])
  })

  it("never mentions unlocking anything", () => {
    const { reason, detail } = explainFailure("ios")(failed(DB_LOCKED))
    for (const line of [reason, ...detail])
      expect(line).not.toMatch(/unlock|device is locked/i)
  })
})

describe("a locked iPhone still reads as one", () => {
  //The runner's own words, from its iOS install path: it prints the first while it retries,
  //and throws the second after a minute. The lockdown service's error is the third.
  it.each([
    "Please unlock your device. Waiting 5 seconds...",
    "Device still locked after 1 minute. Aborting.",
    "Device is currently locked.",
    "The device is locked.",
  ])("%s", (line) => {
    const err = new Error("run ios exited with code 1")
    err.tail = line
    const { reason, detail } = explainFailure("ios")(err)
    expect(reason).toBe("the device is locked")
    expect(detail).toEqual([
      "Unlock it and keep it unlocked while installing.",
    ])
  })
})

/**
 * Xcode's own wording for a locked phone, from the strings in Xcode 26.1.1's IDEFoundation
 * and IDEiOSSupportCore. xcodebuild prints the first pair inside a destination record, the
 * same `{ …, error:… }` shape as the missing-platform inventory in `explain.test.mjs`, under
 * a headline that names no lock at all. The records are assembled from those strings, not
 * captured from a locked phone.
 */
const LOCKED_DESTINATION = [
  "xcodebuild: error: Timed out waiting for all destinations matching the provided destination specifier to become available",
  '\tIneligible destinations for the "App" scheme:',
  "\t\t{ platform:iOS, arch:arm64e, id:00008140-001615581A10801C, name:iPhone de arrz, error:iPhone de arrz is locked. To use iPhone de arrz with Xcode, unlock it. }",
].join("\n")

/** The same phone, paired but not trusting this Mac: unlocking is half the fix, not all of it. */
const UNTRUSTED_DESTINATION = [
  "xcodebuild: error: Timed out waiting for all destinations matching the provided destination specifier to become available",
  '\tIneligible destinations for the "App" scheme:',
  "\t\t{ platform:iOS, arch:arm64e, id:00008140-001615581A10801C, name:iPhone de arrz, error:iPhone de arrz does not trust this Mac. To use iPhone de arrz with Xcode, unlock it and choose to trust this Mac when prompted. }",
].join("\n")

describe("Xcode's own words for a locked phone read as one", () => {
  const explained = (tail) => {
    const err = new Error("xcodebuild exited with code 70")
    err.tail = tail
    return explainFailure("ios")(err)
  }

  it("under a destination time-out that names no lock", () => {
    const { reason, detail } = explained(LOCKED_DESTINATION)
    expect(reason).toBe("the device is locked")
    expect(detail).toEqual([
      "Unlock it and keep it unlocked while installing.",
    ])
  })

  it("while Xcode waits for the unlock", () => {
    const { reason } = explained(
      "iPhone de arrz is locked, waiting for unlock",
    )
    expect(reason).toBe("the device is locked")
  })

  it("but a phone that does not trust this Mac is not only locked", () => {
    const { reason } = explained(UNTRUSTED_DESTINATION)
    expect(reason).not.toBe("the device is locked")
  })
})
