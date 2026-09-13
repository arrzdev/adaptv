// @vitest-environment node
import { execFileSync } from "node:child_process"
import { createRequire } from "node:module"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { ADAPTV_ROOT, loadAdaptvModule } from "./load-ts.mjs"

/**
 * The Android SDK levels adaptv ships, held against the REAL scaffold template.
 *
 * `src/native/android-sdk.ts` is the one place the numbers live, and this reads the
 * template adaptv's pinned native CLI actually unpacks into `.adaptv/android` — not a
 * fixture — so two things are pinned at once. The template's own level is known-good
 * today; if a bump of that dependency ever regresses it, the stamp would quietly raise
 * it again on the next prepare and nobody would learn the template moved, so (a) fails
 * the build instead. And (b) is the reason `doctor` reads `variables.gradle`: the old
 * check was fed `app/build.gradle`, whose only mention of the level is
 * `targetSdkVersion rootProject.ext.targetSdkVersion` — a reference, no digits — so it
 * parsed `null`, stayed quiet, and was dead on every real project for as long as it
 * existed. Its tests only ever fed it synthetic strings, which is how it passed.
 */

const TEMPLATE = path.join(
  path.dirname(
    createRequire(path.join(ADAPTV_ROOT, "package.json")).resolve(
      "@capacitor/cli/package.json",
    ),
  ),
  "assets/android-template.tar.gz",
)

const fromTemplate = (name) =>
  execFileSync("tar", ["-xzOf", TEMPLATE, name], { encoding: "utf8" })

const variables = fromTemplate("variables.gradle")
const appBuildGradle = fromTemplate("app/build.gradle")

const { ANDROID_SDK_LEVELS, readAndroidTargetSdk, stampAndroidSdkLevels } =
  await loadAdaptvModule("native/android-sdk.ts")

describe("the scaffold template, as adaptv's pinned native CLI ships it", () => {
  it("carries the level adaptv requires — a dependency bump that regresses it fails here", () => {
    expect(readAndroidTargetSdk(variables)).toBeGreaterThanOrEqual(
      ANDROID_SDK_LEVELS.target,
    )
  })

  it("keeps the number in variables.gradle and only a reference in app/build.gradle", () => {
    //the file the old check was fed. It answers null, which is why that check never fired.
    expect(appBuildGradle).toContain("rootProject.ext.targetSdkVersion")
    expect(readAndroidTargetSdk(appBuildGradle)).toBeNull()
  })

  it("comes back as the same string from the stamp — nothing to raise, nothing rewritten", () => {
    expect(stampAndroidSdkLevels(variables)).toBe(variables)
  })

  it("has both levels restored, and nothing else touched, when lowered to 35", () => {
    const lowered = variables
      .replace(/compileSdkVersion = \d+/, "compileSdkVersion = 35")
      .replace(/targetSdkVersion = \d+/, "targetSdkVersion = 35")
    //the rewrite really lowered the template, so the stamp has work to do
    expect(readAndroidTargetSdk(lowered)).toBe(35)
    expect(lowered).not.toBe(variables)

    const stamped = stampAndroidSdkLevels(lowered)
    expect(stamped).toContain(
      `compileSdkVersion = ${ANDROID_SDK_LEVELS.compile}`,
    )
    expect(stamped).toContain(
      `targetSdkVersion = ${ANDROID_SDK_LEVELS.target}`,
    )
    //byte-identical to the template: the other thirteen lines are the template's own
    expect(stamped).toBe(variables)
  })
})
