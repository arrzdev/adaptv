import { describe, expect, it } from "vitest"
import { versionHint } from "./devices.mjs"

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
