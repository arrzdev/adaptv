import { describe, expect, it } from "vitest"
import {
  ANDROID_SDK_LEVELS,
  readAndroidTargetSdk,
  stampAndroidSdkLevels,
} from "#adaptv/native/android-sdk.ts"

//The scaffold's `variables.gradle` as the pinned template ships it (no trailing
//newline is the template's own). The bin-side test reads the real tarball; this
//copy is here so the pure rules are asserted without touching disk.
const TEMPLATE = `ext {
    minSdkVersion = 24
    compileSdkVersion = 36
    targetSdkVersion = 36
    androidxActivityVersion = '1.11.0'
    androidxAppCompatVersion = '1.7.1'
    androidxCoordinatorLayoutVersion = '1.3.0'
    androidxCoreVersion = '1.17.0'
    androidxFragmentVersion = '1.8.9'
    coreSplashScreenVersion = '1.2.0'
    androidxWebkitVersion = '1.14.0'
    junitVersion = '4.13.2'
    androidxJunitVersion = '1.3.0'
    androidxEspressoCoreVersion = '3.7.0'
    cordovaAndroidVersion = '14.0.1'
}`

const lowered = (level: number) =>
  TEMPLATE.replace(
    "compileSdkVersion = 36",
    `compileSdkVersion = ${level}`,
  ).replace("targetSdkVersion = 36", `targetSdkVersion = ${level}`)

describe("stampAndroidSdkLevels", () => {
  it("raises both levels when the file is below what adaptv ships", () => {
    const out = stampAndroidSdkLevels(lowered(34))
    expect(out).toContain(
      `compileSdkVersion = ${ANDROID_SDK_LEVELS.compile}`,
    )
    expect(out).toContain(
      `targetSdkVersion = ${ANDROID_SDK_LEVELS.target}`,
    )
    //and nothing else moved: the other lines are the file's, not adaptv's
    expect(out).toBe(TEMPLATE)
  })

  it("returns the very same string when already at the level", () => {
    //identity, not equality: the caller's up-to-date check is `===` on the
    //file's bytes, and a rewrite of an identical file invalidates the native
    //build's cache for nothing
    expect(stampAndroidSdkLevels(TEMPLATE)).toBe(TEMPLATE)
  })

  it("leaves a HIGHER level alone — it only ever raises", () => {
    const ahead = lowered(37)
    expect(stampAndroidSdkLevels(ahead)).toBe(ahead)
  })

  it("invents nothing into a file without the keys", () => {
    const unknown = "ext {\n    minSdkVersion = 24\n}\n"
    expect(stampAndroidSdkLevels(unknown)).toBe(unknown)
  })

  it("keeps the file's own whitespace around the key", () => {
    const tabbed =
      "ext {\n\ttargetSdkVersion=33\n\tcompileSdkVersion  =  33\n}"
    expect(stampAndroidSdkLevels(tabbed)).toBe(
      "ext {\n\ttargetSdkVersion=36\n\tcompileSdkVersion  =  36\n}",
    )
  })

  it("raises one level without touching the other", () => {
    const only = TEMPLATE.replace(
      "targetSdkVersion = 36",
      "targetSdkVersion = 35",
    )
    expect(stampAndroidSdkLevels(only)).toBe(TEMPLATE)
  })
})

describe("readAndroidTargetSdk", () => {
  it("reads the number the scaffold writes", () => {
    expect(readAndroidTargetSdk(TEMPLATE)).toBe(36)
    expect(readAndroidTargetSdk(lowered(35))).toBe(35)
  })

  it("is null on app/build.gradle's shape, which names the variable and never the number", () => {
    //the file `doctor` used to be fed. This is why its check never fired.
    expect(
      readAndroidTargetSdk(
        "android {\n    compileSdk = rootProject.ext.compileSdkVersion\n" +
          "    defaultConfig {\n        targetSdkVersion rootProject.ext.targetSdkVersion\n    }\n}",
      ),
    ).toBeNull()
  })

  it("is null when the key is absent", () => {
    expect(
      readAndroidTargetSdk("ext {\n    minSdkVersion = 24\n}"),
    ).toBeNull()
  })
})
