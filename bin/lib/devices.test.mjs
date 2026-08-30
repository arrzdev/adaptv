import { describe, expect, it } from "vitest"
import { dedupeTargets, versionHint } from "./devices.mjs"

/*
 * R60. The hint is the only thing separating two identically-named devices, so what it says
 * has to be the same KIND of fact on both platforms. Upstream it is not: `iOS 26.1` beside
 * `API 34` puts a version next to an SDK level.
 */
describe("the picker's version hint", () => {
  it("passes iOS through, because it already reads like a version", () => {
    expect(versionHint({ api: "iOS 26.1" })).toBe("iOS 26.1")
    expect(versionHint({ api: "iOS 18.0" })).toBe("iOS 18.0")
  })

  it("says the Android version rather than the SDK level", () => {
    expect(versionHint({ api: "API 34" })).toBe("Android 14")
    expect(versionHint({ api: "API 36" })).toBe("Android 16")
    expect(versionHint({ api: "API 28" })).toBe("Android 9")
  })

  it("reads a minor SDK version as the release it belongs to", () => {
    //Google ships minor levels inside a release, so `36.1` is still Android 16. Whole-number
    //matching left a real emulator in this repo's own picker reading `· API 37.1`.
    expect(versionHint({ api: "API 36.1" })).toBe("Android 16")
    expect(versionHint({ api: "API 34.0" })).toBe("Android 14")
  })

  it("keeps the level it cannot name, instead of inventing a version", () => {
    //a release adaptv has never seen still has to tell two rows apart
    expect(versionHint({ api: "API 99" })).toBe("API 99")
    expect(versionHint({ api: "API 37.1" })).toBe("API 37.1")
  })

  it("gives no hint at all when there is nothing to disambiguate", () => {
    expect(versionHint({})).toBeUndefined()
    expect(versionHint({ api: "" })).toBeUndefined()
  })
})

/*
 * R62. Captured from this machine right after `xcodebuild -downloadPlatform iOS` put iOS 26.1
 * build 23B86 alongside 23B80: two runtimes, one identifier, and the listing walked both.
 * 59 rows for 36 devices, every 26.1 simulator twice under the same id.
 */
describe("one row per device", () => {
  it("drops a device the listing collected twice", () => {
    const listed = [
      {
        name: "iPhone 16 Pro (simulator)",
        api: "iOS 18.0",
        id: "27DF56D5-CE71-4E64-BF48-24A586C9A64C",
      },
      {
        name: "iPhone 16 Pro (simulator)",
        api: "iOS 26.1",
        id: "76A2C5CD-BF8D-4415-B1DA-E5ADF289DD1E",
      },
      {
        name: "iPhone 16 Pro (simulator)",
        api: "iOS 26.1",
        id: "76A2C5CD-BF8D-4415-B1DA-E5ADF289DD1E",
      },
    ]
    expect(dedupeTargets(listed).map((t) => t.api)).toEqual([
      "iOS 18.0",
      "iOS 26.1",
    ])
  })

  it("keeps two devices that only LOOK the same", () => {
    //The R60 case must survive untouched: same name, same version, different device.
    const listed = [
      { name: "iPhone 16 Pro (simulator)", api: "iOS 26.1", id: "aaa" },
      { name: "iPhone 16 Pro (simulator)", api: "iOS 26.1", id: "bbb" },
    ]
    expect(dedupeTargets(listed)).toHaveLength(2)
  })

  it("keeps the first, so the listing's own order stands", () => {
    const listed = [
      { name: "booted one", id: "x" },
      { name: "the repeat", id: "x" },
      { name: "another", id: "y" },
    ]
    expect(dedupeTargets(listed).map((t) => t.name)).toEqual([
      "booted one",
      "another",
    ])
  })
})
