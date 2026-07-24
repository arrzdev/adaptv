import { describe, expect, it } from "vitest"
import {
  renderPrivacyManifest,
  resolveRequiredReasons,
} from "#adaptv/native/privacy-manifest"

describe("resolveRequiredReasons", () => {
  //The obligation is derivable from the dependency list, currently satisfied by
  //hand-editing XML, and fails SILENTLY at App Store submission — a generic
  //rejection days after the code was written. Deriving it is the whole point.
  it("declares UserDefaults for @capacitor/preferences", () => {
    //its own README pushes this onto the app: category
    //NSPrivacyAccessedAPICategoryUserDefaults, reason CA92.1
    const apis = resolveRequiredReasons(["@capacitor/preferences"])
    expect(apis).toHaveLength(1)
    expect(apis[0]?.category).toBe(
      "NSPrivacyAccessedAPICategoryUserDefaults",
    )
    expect(apis[0]?.reasons).toEqual(["CA92.1"])
  })

  it("declares both APIs filesystem touches", () => {
    const categories = resolveRequiredReasons([
      "@capacitor/filesystem",
    ]).map((a) => a.category)
    expect(categories).toContain(
      "NSPrivacyAccessedAPICategoryFileTimestamp",
    )
    expect(categories).toContain("NSPrivacyAccessedAPICategoryDiskSpace")
  })

  it("merges a category two plugins both require, never duplicating it", () => {
    //Apple expects one entry per CATEGORY; a duplicated category is a malformed
    //manifest, and both these plugins hit UserDefaults
    const apis = resolveRequiredReasons([
      "@capacitor/preferences",
      "@aparajita/capacitor-secure-storage",
    ])
    const userDefaults = apis.filter(
      (a) => a.category === "NSPrivacyAccessedAPICategoryUserDefaults",
    )
    expect(userDefaults).toHaveLength(1)
    expect(userDefaults[0]?.reasons).toEqual(["CA92.1"])
  })

  it("ignores dependencies with no privacy obligation", () => {
    expect(
      resolveRequiredReasons(["react", "@capacitor/haptics"]),
    ).toEqual([])
  })

  it("is stable-ordered, so sync does not churn the file", () => {
    const a = resolveRequiredReasons([
      "@capacitor/filesystem",
      "@capacitor/preferences",
    ])
    const b = resolveRequiredReasons([
      "@capacitor/preferences",
      "@capacitor/filesystem",
    ])
    expect(a).toEqual(b)
  })
})

describe("renderPrivacyManifest", () => {
  it("emits a valid plist skeleton even with no obligations", () => {
    const xml = renderPrivacyManifest([])
    expect(xml).toContain("<?xml")
    expect(xml).toContain("<!DOCTYPE plist")
    expect(xml).toContain("NSPrivacyAccessedAPITypes")
  })

  it("emits the category and its reasons", () => {
    const xml = renderPrivacyManifest(
      resolveRequiredReasons(["@capacitor/preferences"]),
    )
    expect(xml).toContain(
      "<string>NSPrivacyAccessedAPICategoryUserDefaults</string>",
    )
    expect(xml).toContain("<string>CA92.1</string>")
  })

  it("declares no tracking — adaptv never adds any", () => {
    expect(renderPrivacyManifest([])).toContain(
      "<key>NSPrivacyTracking</key>\n\t<false/>",
    )
  })

  it("leaves data collection EMPTY and says why", () => {
    //adaptv cannot know what the app does with analytics or accounts. A guessed
    //declaration is worse than none: it is a false statement to Apple and users.
    const xml = renderPrivacyManifest([])
    expect(xml).toContain(
      "<key>NSPrivacyCollectedDataTypes</key>\n\t<array/>",
    )
    expect(xml).toContain("declared by you")
  })
})
